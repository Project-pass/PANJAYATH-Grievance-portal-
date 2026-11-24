"""Service application repository encapsulating parameterized citizen e-service queries."""
from __future__ import annotations

from typing import Any


class ServiceRepository:
    def __init__(self, conn: Any):
        self.conn = conn

    def get_by_id(self, app_id: str):
        return self.conn.execute("SELECT * FROM services WHERE id = ?", (app_id,)).fetchone()

    def get_by_id_or_uuid(self, identifier: str):
        return self.conn.execute(
            "SELECT * FROM services WHERE id = ? OR external_uuid = ?",
            (identifier, identifier.lower()),
        ).fetchone()

    def list_all_ordered(self):
        return self.conn.execute("SELECT * FROM services ORDER BY created_at DESC").fetchall()

    def delete_by_id(self, app_id: str) -> int:
        cur = self.conn.execute("DELETE FROM services WHERE id = ?", (app_id,))
        return int(cur.rowcount or 0)
