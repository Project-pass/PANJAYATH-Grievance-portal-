"""Audit log and security alert repository encapsulating hash-chained queries."""
from __future__ import annotations

from typing import Any


class AuditRepository:
    def __init__(self, conn: Any):
        self.conn = conn

    def get_latest_chain_head(self) -> tuple[int, str]:
        row = self.conn.execute(
            "SELECT seq_no, event_hash FROM audit_logs WHERE seq_no IS NOT NULL ORDER BY seq_no DESC LIMIT 1"
        ).fetchone()
        if not row or not row["event_hash"]:
            return 0, "0" * 64
        return int(row["seq_no"]), str(row["event_hash"])

    def list_ordered_ascending(self):
        return self.conn.execute(
            "SELECT * FROM audit_logs ORDER BY COALESCE(seq_no, 0) ASC, timestamp ASC, id ASC"
        ).fetchall()

    def list_security_alerts(self, limit: int = 100):
        return self.conn.execute(
            "SELECT * FROM security_alerts ORDER BY timestamp DESC LIMIT ?",
            (max(1, min(500, int(limit))),),
        ).fetchall()
