"""Transaction helpers supporting SQLite and PostgreSQL connections transparently."""
from __future__ import annotations

from contextlib import contextmanager
import sqlite3

from app.database.interface import DbConnection
from app.database.postgres_adapter import PostgresConnectionWrapper
from app.database.sqlite_adapter import SQLITE_WRITE_LOCK, SQLiteConnectionWrapper


@contextmanager
def run_transaction(conn: DbConnection | sqlite3.Connection):
    if isinstance(conn, PostgresConnectionWrapper):
        conn.begin_tx()
        try:
            yield conn
            conn.commit_tx()
        except Exception:
            conn.rollback_tx()
            raise
        return

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
