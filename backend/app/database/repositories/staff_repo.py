"""Staff and session repository encapsulating parameterized staff/RBAC lookups."""
from __future__ import annotations

from typing import Any


class StaffRepository:
    def __init__(self, conn: Any):
        self.conn = conn

    def get_by_id(self, staff_id: str):
        return self.conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()

    def find_by_identifier(self, identifier: str):
        ident = identifier.strip().lower()
        return self.conn.execute(
            "SELECT * FROM staff WHERE lower(email) = ? OR lower(username) = ?",
            (ident, ident),
        ).fetchone()

    def list_all(self):
        return self.conn.execute("SELECT * FROM staff ORDER BY created_at ASC").fetchall()

    def list_active_ward_officers_by_dept(self, department: str):
        return self.conn.execute(
            "SELECT * FROM staff WHERE is_active = TRUE AND role = 'WARD_OFFICER' AND department = ?",
            (department,),
        ).fetchall()

    def count_claimed(self) -> int:
        row = self.conn.execute("SELECT COUNT(*) AS c FROM staff WHERE is_claimed = TRUE").fetchone()
        return int(row["c"]) if row else 0
