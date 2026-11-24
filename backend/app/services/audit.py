from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone

from app.database.connection import get_adapter


def query_audit_logs(
    conn,
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
        where.append(
            "(lower(actor_name) LIKE ? OR lower(action) LIKE ? OR lower(target_id) LIKE ? OR lower(details) LIKE ?)"
        )
        params.extend([like, like, like, like])

    clause = ("WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS c FROM audit_logs {clause}", params).fetchone()["c"]
    rows = conn.execute(
        f"SELECT * FROM audit_logs {clause} ORDER BY COALESCE(seq_no, 0) DESC, timestamp DESC LIMIT ? OFFSET ?",
        [*params, safe_size, offset],
    ).fetchall()

    items = [
        {
            "id": a["id"],
            "seqNo": a["seq_no"] if "seq_no" in a.keys() else None,
            "prevHash": a["prev_hash"] if "prev_hash" in a.keys() else None,
            "eventHash": a["event_hash"] if "event_hash" in a.keys() else None,
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


def export_audit_logs_csv(conn, limit: int = 5000) -> str:
    rows = conn.execute(
        "SELECT id, seq_no, prev_hash, event_hash, timestamp, request_id, actor_id, actor_name, actor_role, "
        "session_prefix, ip_hash, action, target_id, outcome, details "
        "FROM audit_logs ORDER BY COALESCE(seq_no, 0) DESC, timestamp DESC LIMIT ?",
        (max(1, min(20000, int(limit))),),
    ).fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "id",
            "seq_no",
            "prev_hash",
            "event_hash",
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
        keys = r.keys()
        writer.writerow(
            [
                r["id"],
                r["seq_no"] if "seq_no" in keys else "",
                r["prev_hash"] if "prev_hash" in keys else "",
                r["event_hash"] if "event_hash" in keys else "",
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


def export_audit_logs_json(conn, limit: int = 5000) -> str:
    rows = conn.execute(
        "SELECT id, seq_no, prev_hash, event_hash, timestamp, request_id, actor_id, actor_name, actor_role, "
        "session_prefix, ip_hash, action, target_id, outcome, details "
        "FROM audit_logs ORDER BY COALESCE(seq_no, 0) DESC, timestamp DESC LIMIT ?",
        (max(1, min(20000, int(limit))),),
    ).fetchall()
    out = [{k: r[k] for k in r.keys()} for r in rows]
    return json.dumps(out, indent=2)


def get_audit_retention_summary(conn, retention_days: int = 365) -> dict:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat().replace("+00:00", "Z")
    total = conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0]
    active_window = conn.execute(
        "SELECT COUNT(*) FROM audit_logs WHERE timestamp >= ?", (cutoff,)
    ).fetchone()[0]
    if getattr(conn, "backend_name", "sqlite") == "postgresql":
        triggers = get_adapter().list_audit_triggers(conn)
    else:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_logs'"
        ).fetchall()
        triggers = [t["name"] for t in rows]
    return {
        "retentionDays": retention_days,
        "totalRecords": total,
        "withinWindow": active_window,
        "archiveEligible": max(0, total - active_window),
        "immutableTriggers": triggers,
    }
