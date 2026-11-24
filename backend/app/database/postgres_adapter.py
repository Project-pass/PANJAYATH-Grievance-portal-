"""PostgreSQL 16 runtime adapter powered by SQLAlchemy 2.x QueuePool and psycopg3."""
from __future__ import annotations

from contextlib import contextmanager
import os
import threading
from typing import Any, Sequence

from app.core.config import ConfigurationError
from app.database.interface import (
    DatabaseAdapter,
    DbConnection,
    DbCursor,
    RowProxy,
    normalize_postgres_url,
    translate_qmark_sql,
)

try:
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import Connection, Engine
    from sqlalchemy.pool import QueuePool
except ImportError:  # pragma: no cover - optional when running stdlib-only SQLite
    create_engine = None  # type: ignore[assignment]
    text = None  # type: ignore[assignment]
    Connection = object  # type: ignore[assignment]
    Engine = object  # type: ignore[assignment]
    QueuePool = object  # type: ignore[assignment]


class PostgresCursorWrapper(DbCursor):
    def __init__(self, keys: Sequence[str], rows: list[tuple[Any, ...]], rowcount: int):
        self._keys = tuple(keys)
        self._rows = [RowProxy(self._keys, vals) for vals in rows]
        self._idx = 0
        self._rowcount = rowcount

    @property
    def rowcount(self) -> int:
        return self._rowcount

    def fetchone(self) -> RowProxy | None:
        if self._idx >= len(self._rows):
            return None
        row = self._rows[self._idx]
        self._idx += 1
        return row

    def fetchall(self) -> list[RowProxy]:
        if self._idx == 0:
            self._idx = len(self._rows)
            return list(self._rows)
        rem = self._rows[self._idx :]
        self._idx = len(self._rows)
        return rem


class PostgresConnectionWrapper(DbConnection):
    backend_name = "postgresql"

    def __init__(self, sa_conn: Any):
        self.raw = sa_conn
        self._tx: Any = None
        self._tx_depth = 0

    @property
    def in_transaction(self) -> bool:
        return self._tx is not None and self._tx.is_active

    def begin_tx(self) -> None:
        if self._tx_depth == 0:
            self._tx = self.raw.begin()
        self._tx_depth += 1

    def commit_tx(self) -> None:
        if self._tx_depth > 0:
            self._tx_depth -= 1
            if self._tx_depth == 0 and self._tx is not None:
                self._tx.commit()
                self._tx = None

    def rollback_tx(self) -> None:
        if self._tx is not None:
            self._tx.rollback()
            self._tx = None
        self._tx_depth = 0

    def execute(self, sql: str, params: Sequence[Any] | dict[str, Any] = ()) -> PostgresCursorWrapper:
        if text is None:
            raise ConfigurationError("SQLAlchemy is required for PostgreSQL runtime execution.")
        translated_sql, bound = translate_qmark_sql(sql, params)
        # Ensure autocommit behavior for standalone reads/writes outside explicit transaction()
        if not self.raw.in_transaction():
            with self.raw.begin():
                result = self.raw.execute(text(translated_sql), bound)
                if result.returns_rows:
                    keys = list(result.keys())
                    rows = [tuple(r) for r in result.fetchall()]
                    return PostgresCursorWrapper(keys, rows, result.rowcount)
                return PostgresCursorWrapper([], [], result.rowcount)

        result = self.raw.execute(text(translated_sql), bound)
        if result.returns_rows:
            keys = list(result.keys())
            rows = [tuple(r) for r in result.fetchall()]
            return PostgresCursorWrapper(keys, rows, result.rowcount)
        return PostgresCursorWrapper([], [], result.rowcount)

    def executescript(self, sql: str) -> None:
        if text is None:
            raise ConfigurationError("SQLAlchemy is required for PostgreSQL runtime execution.")
        statements = [s.strip() for s in sql.split(";") if s.strip()]
        for stmt in statements:
            self.execute(stmt)

    def close(self) -> None:
        if self._tx is not None:
            try:
                self._tx.rollback()
            except Exception:
                pass
            self._tx = None
        self.raw.close()


class PostgresAdapter(DatabaseAdapter):
    backend_name = "postgresql"

    def __init__(self, database_url: str):
        self.database_url = normalize_postgres_url(database_url)
        self._engine: Any = None
        self._engine_lock = threading.Lock()

    def _get_engine(self) -> Any:
        if create_engine is None:
            raise ConfigurationError(
                "PostgreSQL DATABASE_URL configured, but SQLAlchemy / psycopg[binary] packages are not installed. "
                "Install requirements.txt or set DATABASE_URL to sqlite:///..."
            )
        with self._engine_lock:
            if self._engine is None:
                pool_size = int(os.environ.get("PG_POOL_SIZE", "10"))
                max_overflow = int(os.environ.get("PG_MAX_OVERFLOW", "20"))
                pool_timeout = int(os.environ.get("PG_POOL_TIMEOUT", "15"))
                pool_recycle = int(os.environ.get("PG_POOL_RECYCLE", "1800"))
                self._engine = create_engine(
                    self.database_url,
                    poolclass=QueuePool,
                    pool_size=pool_size,
                    max_overflow=max_overflow,
                    pool_timeout=pool_timeout,
                    pool_recycle=pool_recycle,
                    pool_pre_ping=True,
                    future=True,
                )
            return self._engine

    def connect(self) -> PostgresConnectionWrapper:
        engine = self._get_engine()
        return PostgresConnectionWrapper(engine.connect())

    @contextmanager
    def transaction(self, conn: DbConnection):
        if not isinstance(conn, PostgresConnectionWrapper):
            raise TypeError("PostgresAdapter.transaction requires a PostgresConnectionWrapper.")
        conn.begin_tx()
        try:
            yield conn
            conn.commit_tx()
        except Exception:
            conn.rollback_tx()
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
            """
            SELECT t.tgname AS name
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            WHERE c.relname = 'audit_logs' AND NOT t.tgisinternal
            ORDER BY t.tgname
            """
        ).fetchall()
        return [r["name"] for r in rows]

    def dispose(self) -> None:
        with self._engine_lock:
            if self._engine is not None:
                self._engine.dispose()
                self._engine = None
