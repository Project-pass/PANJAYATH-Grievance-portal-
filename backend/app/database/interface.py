"""Database abstraction contracts, portable row proxy, SQL parameter translator, and retry policy."""
from __future__ import annotations

from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
import re
import time
from typing import Any, Callable, Iterable, Sequence, TypeVar

T = TypeVar("T")

_TRANSIENT_MARKERS = (
    "database is locked",
    "database table is locked",
    "deadlock detected",
    "could not serialize access",
    "connection reset",
    "server closed the connection unexpectedly",
    "terminating connection due to administrator command",
    "connection refused",
    "too many connections",
)


class RowProxy:
    """Mapping + positional sequence wrapper unifying sqlite3.Row and SQLAlchemy RowMapping."""

    __slots__ = ("_keys", "_values", "_map")

    def __init__(self, keys: Sequence[str], values: Sequence[Any]):
        self._keys = tuple(keys)
        self._values = tuple(values)
        self._map = dict(zip(self._keys, self._values))

    def keys(self) -> tuple[str, ...]:
        return self._keys

    def __getitem__(self, key: str | int) -> Any:
        if isinstance(key, int):
            return self._values[key]
        return self._map[key]

    def __contains__(self, key: object) -> bool:
        return key in self._map

    def __iter__(self):
        return iter(self._keys)

    def __len__(self) -> int:
        return len(self._values)

    def get(self, key: str, default: Any = None) -> Any:
        return self._map.get(key, default)

    def items(self):
        return self._map.items()

    def to_dict(self) -> dict[str, Any]:
        return dict(self._map)

    def __repr__(self) -> str:
        return f"RowProxy({self._map!r})"


def translate_qmark_sql(sql: str, params: Sequence[Any] | dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
    """Tokenize SQL and safely rewrite positional `?` placeholders to `:pN` without touching literals/comments."""
    if isinstance(params, dict):
        return sql, dict(params)

    param_list = list(params or ())
    out: list[str] = []
    idx = 0
    n = len(sql)
    p_idx = 0

    while idx < n:
        ch = sql[idx]
        # Single-quoted string literal (with '' escaping)
        if ch == "'":
            start = idx
            idx += 1
            while idx < n:
                if sql[idx] == "'":
                    if idx + 1 < n and sql[idx + 1] == "'":
                        idx += 2
                        continue
                    idx += 1
                    break
                idx += 1
            out.append(sql[start:idx])
            continue

        # Double-quoted identifier (with "" escaping)
        if ch == '"':
            start = idx
            idx += 1
            while idx < n:
                if sql[idx] == '"':
                    if idx + 1 < n and sql[idx + 1] == '"':
                        idx += 2
                        continue
                    idx += 1
                    break
                idx += 1
            out.append(sql[start:idx])
            continue

        # Line comment --
        if ch == "-" and idx + 1 < n and sql[idx + 1] == "-":
            end = sql.find("\n", idx)
            if end == -1:
                out.append(sql[idx:])
                break
            out.append(sql[idx : end + 1])
            idx = end + 1
            continue

        # Block comment /* ... */
        if ch == "/" and idx + 1 < n and sql[idx + 1] == "*":
            end = sql.find("*/", idx + 2)
            if end == -1:
                out.append(sql[idx:])
                break
            out.append(sql[idx : end + 2])
            idx = end + 2
            continue

        if ch == "?":
            out.append(f":p{p_idx}")
            p_idx += 1
            idx += 1
            continue

        out.append(ch)
        idx += 1

    if p_idx != len(param_list):
        raise ValueError(
            f"SQL parameter count mismatch: query has {p_idx} placeholder(s) but {len(param_list)} parameter(s) were supplied."
        )

    bound = {f"p{i}": val for i, val in enumerate(param_list)}
    return "".join(out), bound


def is_transient_db_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    if any(m in msg for m in _TRANSIENT_MARKERS):
        return True
    sqlstate = getattr(exc, "sqlstate", None) or getattr(getattr(exc, "orig", None), "sqlstate", None)
    if sqlstate in {"40001", "40P01", "55P03", "08006", "08001", "08003"}:
        return True
    return False


def with_db_retry(fn: Callable[[], T], max_attempts: int = 3, base_delay: float = 0.05) -> T:
    last_exc: BaseException | None = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if attempt + 1 >= max_attempts or not is_transient_db_error(exc):
                raise
            time.sleep(base_delay * (2 ** attempt))
    assert last_exc is not None
    raise last_exc


def detect_database_backend(database_url: str | None) -> str:
    url = (database_url or "").strip().lower()
    if url.startswith("postgresql") or url.startswith("postgres://"):
        return "postgresql"
    return "sqlite"


def normalize_postgres_url(database_url: str) -> str:
    url = database_url.strip()
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class DbCursor(ABC):
    @property
    @abstractmethod
    def rowcount(self) -> int:
        ...

    @abstractmethod
    def fetchone(self) -> Any:
        ...

    @abstractmethod
    def fetchall(self) -> list[Any]:
        ...


class DbConnection(ABC):
    backend_name: str = "sqlite"

    @abstractmethod
    def execute(self, sql: str, params: Sequence[Any] | dict[str, Any] = ()) -> DbCursor:
        ...

    @abstractmethod
    def executescript(self, sql: str) -> None:
        ...

    @abstractmethod
    def close(self) -> None:
        ...


class DatabaseAdapter(ABC):
    backend_name: str

    @abstractmethod
    def connect(self) -> DbConnection:
        ...

    @abstractmethod
    def transaction(self, conn: DbConnection) -> AbstractContextManager[DbConnection]:
        ...

    @abstractmethod
    def health_check(self) -> bool:
        ...

    @abstractmethod
    def list_audit_triggers(self, conn: DbConnection) -> list[str]:
        ...

    def dispose(self) -> None:
        return None
