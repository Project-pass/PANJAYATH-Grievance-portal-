from __future__ import annotations

import json
import sqlite3
import time
import uuid
from datetime import datetime, timezone

from app.policies.rbac import CLOSED_OR_DONE_GRIEVANCE_STATUSES, normalize_grievance_status
from app.services.sla import compute_sla_metrics, parse_utc_iso, resolve_effective_sla_limit


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_holidays(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT holiday_date FROM holidays").fetchall()
    return {r["holiday_date"] for r in rows}


def load_category_sla_policies(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute("SELECT name, default_sla_days FROM grievance_categories").fetchall()
    return {r["name"]: int(r["default_sla_days"]) for r in rows}


def resolve_sla_days_for_ticket(
    conn: sqlite3.Connection,
    category: str,
    priority: str,
    base_limit_days: int,
) -> int:
    row = conn.execute(
        "SELECT deadline_days FROM sla_policies WHERE category = ? AND priority = ?",
        (category, (priority or "NORMAL").upper()),
    ).fetchone()
    if row:
        return int(row["deadline_days"])
    cat_policies = load_category_sla_policies(conn)
    return resolve_effective_sla_limit(category, priority, base_limit_days, cat_policies)


def find_potential_duplicate_grievances(
    conn: sqlite3.Connection,
    ward: int,
    category: str,
    description: str,
    *,
    exclude_id: str | None = None,
) -> list[dict]:
    """Identify recent open grievances in the same ward/category with overlapping keywords."""
    rows = conn.execute(
        """
        SELECT id, ward, category, landmark, description, status, created_at
        FROM grievances
        WHERE ward = ? AND category = ?
          AND status NOT IN ('RESOLVED','CLOSED','REJECTED')
        ORDER BY created_at DESC
        LIMIT 25
        """,
        (int(ward), category),
    ).fetchall()
    words = {w for w in description.lower().split() if len(w) >= 4}
    matches = []
    for r in rows:
        if exclude_id and r["id"] == exclude_id:
            continue
        hay_words = {w for w in f"{r['landmark']} {r['description']}".lower().split() if len(w) >= 4}
        overlap = len(words & hay_words)
        if overlap >= 2 or (len(words) <= 3 and overlap >= 1):
            matches.append(
                {
                    "id": r["id"],
                    "ward": r["ward"],
                    "category": r["category"],
                    "landmark": r["landmark"],
                    "status": r["status"],
                    "createdAt": r["created_at"],
                    "keywordOverlap": overlap,
                }
            )
    return matches[:5]


def record_notification(
    conn: sqlite3.Connection,
    recipient_role: str,
    recipient_ref: str,
    target_id: str,
    message: str,
    channel: str = "IN_APP",
) -> str:
    nid = f"ntf-{uuid.uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO notifications(id, recipient_role, recipient_ref, target_id, channel, message, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'SENT', ?)
        """,
        (nid, recipient_role, recipient_ref, target_id, channel, message, _utc_now_iso()),
    )
    return nid


def record_status_history(
    conn: sqlite3.Connection,
    grievance_id: str,
    from_status: str | None,
    to_status: str,
    actor_id: str,
    actor_name: str,
    actor_role: str,
    remark: str,
) -> str:
    hid = f"gsh-{uuid.uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO grievance_status_history(
            id, grievance_id, from_status, to_status, actor_id, actor_name, actor_role, remark, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (hid, grievance_id, from_status, to_status, actor_id, actor_name, actor_role, remark, _utc_now_iso()),
    )
    return hid


def record_assignment(
    conn: sqlite3.Connection,
    grievance_id: str,
    officer_id: str | None,
    officer_name: str | None,
    assigned_by_id: str,
) -> str:
    aid = f"asg-{uuid.uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO grievance_assignments(id, grievance_id, officer_id, officer_name, assigned_by_id, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (aid, grievance_id, officer_id, officer_name, assigned_by_id, _utc_now_iso()),
    )
    return aid


def calculate_hold_transition_fields(
    row,
    next_status: str,
    now_dt: datetime | None = None,
) -> tuple[int, str | None]:
    curr = normalize_grievance_status(row["status"])
    nxt = normalize_grievance_status(next_status)
    cur_dt = now_dt or datetime.now(timezone.utc)
    paused = max(0, int(row["paused_seconds"] or 0))
    hold_started = row["hold_started_at"]

    if curr != "ON_HOLD" and nxt == "ON_HOLD":
        return paused, cur_dt.isoformat().replace("+00:00", "Z")
    if curr == "ON_HOLD" and nxt != "ON_HOLD":
        if hold_started:
            start_dt = parse_utc_iso(hold_started)
            paused += max(0, int((cur_dt - start_dt).total_seconds()))
        return paused, None
    return paused, hold_started


def escalate_overdue_grievances(
    conn: sqlite3.Connection,
    actor: dict,
    *,
    now_dt: datetime | None = None,
    base_sla_days: int = 7,
) -> list[str]:
    cur_dt = now_dt or datetime.now(timezone.utc)
    cur_iso = cur_dt.isoformat().replace("+00:00", "Z")
    holidays = load_holidays(conn)

    rows = conn.execute(
        "SELECT * FROM grievances WHERE status NOT IN ('RESOLVED','CLOSED','REJECTED','ON_HOLD','ESCALATED')"
    ).fetchall()
    escalated_ids: list[str] = []
    for row in rows:
        limit_days = int(row["sla_limit_days"] or base_sla_days)
        sla = compute_sla_metrics(
            row["created_at"],
            row["status"],
            limit_days,
            now_dt=cur_dt,
            resolved_at_iso=row["resolved_at"],
            paused_seconds=int(row["paused_seconds"] or 0),
            hold_started_at_iso=row["hold_started_at"],
            holidays=holidays,
        )
        if not sla["isBreached"]:
            continue

        timeline = json.loads(row["timeline_json"])
        timeline.append(
            {
                "id": f"tl-esc-{int(time.time() * 1000)}-{row['id'][-3:]}",
                "timestamp": cur_iso,
                "stepTitle": "SLA Breach Auto-Escalation",
                "actor": f"{actor['name']} ({actor['designation']})",
                "remark": f"Escalated automatically after exceeding {limit_days}-day SLA ({sla['ageDays']} working days).",
                "statusLabel": "ESCALATED",
            }
        )
        next_level = int(row["escalation_level"] or 0) + 1
        conn.execute(
            """
            UPDATE grievances
            SET status = 'ESCALATED', escalated_at = ?, escalation_level = ?, updated_at = ?, timeline_json = ?
            WHERE id = ?
            """,
            (cur_iso, next_level, cur_iso, json.dumps(timeline), row["id"]),
        )
        record_status_history(
            conn,
            row["id"],
            row["status"],
            "ESCALATED",
            actor["id"],
            actor["name"],
            actor["role"],
            f"Auto-escalated due to SLA breach ({sla['ageDays']} working days > {limit_days}d).",
        )
        record_notification(
            conn,
            "SUPER_ADMIN",
            "stf-secretary",
            row["id"],
            f"Grievance {row['id']} (Ward {row['ward']}) escalated to Level {next_level} due to SLA breach.",
        )
        escalated_ids.append(row["id"])
    return escalated_ids
