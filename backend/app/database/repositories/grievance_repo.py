"""Grievance repository encapsulating parameterized grievance queries across SQLite and PostgreSQL."""
from __future__ import annotations

from typing import Any


class GrievanceRepository:
    def __init__(self, conn: Any):
        self.conn = conn

    def get_by_id(self, ticket_id: str):
        return self.conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()

    def get_by_id_or_uuid(self, identifier: str):
        return self.conn.execute(
            "SELECT * FROM grievances WHERE id = ? OR external_uuid = ?",
            (identifier, identifier.lower()),
        ).fetchone()

    def list_all_ordered(self):
        return self.conn.execute("SELECT * FROM grievances ORDER BY created_at DESC").fetchall()

    def list_comments(self) -> dict[str, list[dict]]:
        rows = self.conn.execute("SELECT * FROM grievance_comments ORDER BY created_at ASC").fetchall()
        out: dict[str, list[dict]] = {}
        for c in rows:
            out.setdefault(c["grievance_id"], []).append(
                {
                    "id": c["id"],
                    "authorName": c["author_name"],
                    "isInternal": bool(c["is_internal"]),
                    "body": c["body"],
                    "createdAt": c["created_at"],
                }
            )
        return out

    def delete_by_id(self, ticket_id: str) -> int:
        cur = self.conn.execute("DELETE FROM grievances WHERE id = ?", (ticket_id,))
        return int(cur.rowcount or 0)
