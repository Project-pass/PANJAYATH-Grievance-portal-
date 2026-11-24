"""SQLite WAL database adapter implementing DbConnection and DatabaseAdapter."""
from __future__ import annotations

from contextlib import contextmanager
import os
import sqlite3
import threading
from typing import Any, Sequence

from app.database.interface import DatabaseAdapter, DbConnection, DbCursor

SQLITE_WRITE_LOCK = threading.Lock()


class SQLiteCursorWrapper(DbCursor):
    def __init__(self, cur: sqlite3.Cursor):
        self._cur = cur

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    def fetchone(self) -> Any:
        return self._cur.fetchone()

    def fetchall(self) -> list[Any]:
        return self._cur.fetchall()


class SQLiteConnectionWrapper(DbConnection):
    backend_name = "sqlite"

    def __init__(self, raw: sqlite3.Connection):
        self.raw = raw

    @property
    def in_transaction(self) -> bool:
        return self.raw.in_transaction

    def execute(self, sql: str, params: Sequence[Any] | dict[str, Any] = ()) -> DbCursor:
        cur = self.raw.execute(sql, params)
        return SQLiteCursorWrapper(cur)

    def executescript(self, sql: str) -> None:
        self.raw.executescript(sql)

    def backup(self, target: sqlite3.Connection) -> None:
        self.raw.backup(target)

    def close(self) -> None:
        self.raw.close()


class SQLiteAdapter(DatabaseAdapter):
    backend_name = "sqlite"

    def __init__(self, db_path: str):
        self.db_path = db_path

    def connect(self) -> SQLiteConnectionWrapper:
        parent = os.path.dirname(os.path.abspath(self.db_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=15.0, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        return SQLiteConnectionWrapper(conn)

    @contextmanager
    def transaction(self, conn: DbConnection):
        raw = conn.raw if isinstance(conn, SQLiteConnectionWrapper) else conn
        with SQLITE_WRITE_LOCK:
            raw.execute("BEGIN IMMEDIATE;")
            try:
                yield conn
                if raw.in_transaction:
                    raw.execute("COMMIT;")
            except Exception:
                if raw.in_transaction:
                    raw.execute("ROLLBACK;")
                raise

    def health_check(self) -> bool:
        conn = self.connect()
        try:
            row = conn.execute("SELECT 1").fetchone()
            return bool(row and row[0] == 1)
        finally:
            conn.close()

    def list_audit_triggers(self, conn: DbConnection) -> list[str]:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_logs'"
        ).fetchall()
        return [r["name"] for r in rows]
