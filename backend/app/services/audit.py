from __future__ import annotations

import csv
import io
import json
import sqlite3
from datetime import datetime, timedelta, timezone


def query_audit_logs(
    conn: sqlite3.Connection,
    actor: dict,
    *,
    search: str = "",
    action: str = "",
    outcome: str = "",
    page: int = 1,
    page_size: int = 50,
) -> dict:
    safe_page = max(1, int(page))
    safe_size = max(1, min(200, int(page_size)))
    offset = (safe_page - 1) * safe_size

    where = []
    params: list = []

    if actor["role"] != "SUPER_ADMIN":
        where.append("actor_id = ?")
        params.append(actor["id"])
    if action:
        where.append("action = ?")
        params.append(action)
    if outcome:
        where.append("outcome = ?")
        params.append(outcome)
    if search:
        like = f"%{search.strip().lower()}%"
        where.append("(lower(actor_name) LIKE ? OR lower(action) LIKE ? OR lower(target_id) LIKE ? OR lower(details) LIKE ?)")
        params.extend([like, like, like, like])

    clause = ("WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS c FROM audit_logs {clause}", params).fetchone()["c"]
    rows = conn.execute(
        f"SELECT * FROM audit_logs {clause} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        [*params, safe_size, offset],
    ).fetchall()

    items = [
        {
            "id": a["id"],
            "timestamp": a["timestamp"],
            "requestId": a["request_id"] if "request_id" in a.keys() else "-",
            "actorName": a["actor_name"],
            "actorRole": a["actor_role"],
            "sessionPrefix": a["session_prefix"],
            "action": a["action"],
            "targetId": a["target_id"],
            "outcome": a["outcome"],
            "details": a["details"],
        }
        for a in rows
    ]
    return {
        "items": items,
        "total": total,
        "page": safe_page,
        "pageSize": safe_size,
        "totalPages": max(1, (total + safe_size - 1) // safe_size),
    }


def export_audit_logs_csv(conn: sqlite3.Connection, limit: int = 5000) -> str:
    rows = conn.execute(
        "SELECT id, timestamp, request_id, actor_id, actor_name, actor_role, session_prefix, ip_hash, action, target_id, outcome, details "
        "FROM audit_logs ORDER BY timestamp DESC LIMIT ?",
        (max(1, min(20000, int(limit))),),
    ).fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "id",
            "timestamp",
            "request_id",
            "actor_id",
            "actor_name",
            "actor_role",
            "session_prefix",
            "ip_hash",
            "action",
            "target_id",
            "outcome",
            "details",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r["id"],
                r["timestamp"],
                r["request_id"],
                r["actor_id"],
                r["actor_name"],
                r["actor_role"],
                r["session_prefix"],
                r["ip_hash"],
                r["action"],
                r["target_id"],
                r["outcome"],
                r["details"],
            ]
        )
    return buf.getvalue()


def export_audit_logs_json(conn: sqlite3.Connection, limit: int = 5000) -> str:
    rows = conn.execute(
        "SELECT id, timestamp, request_id, actor_id, actor_name, actor_role, session_prefix, action, target_id, outcome, details "
        "FROM audit_logs ORDER BY timestamp DESC LIMIT ?",
        (max(1, min(20000, int(limit))),),
    ).fetchall()
    return json.dumps([dict(r) for r in rows], indent=2)


def get_audit_retention_summary(conn: sqlite3.Connection, retention_days: int = 365) -> dict:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat().replace("+00:00", "Z")
    total = conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0]
    active_window = conn.execute(
        "SELECT COUNT(*) FROM audit_logs WHERE timestamp >= ?", (cutoff,)
    ).fetchone()[0]
    triggers = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_logs'"
    ).fetchall()
    return {
        "retentionDays": retention_days,
        "totalRecords": total,
        "withinWindow": active_window,
        "archiveEligible": max(0, total - active_window),
        "immutableTriggers": [t["name"] for t in triggers],
    }
