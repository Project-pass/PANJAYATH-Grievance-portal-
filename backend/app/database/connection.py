"""Runtime database adapter factory driven by DATABASE_URL and configuration settings."""
from __future__ import annotations

import os
import threading
from typing import Optional

from app.core.config import load_settings
from app.database.interface import DatabaseAdapter, DbConnection, detect_database_backend
from app.database.postgres_adapter import PostgresAdapter
from app.database.sqlite_adapter import SQLiteAdapter

_ADAPTER_LOCK = threading.Lock()
_ADAPTER_CACHE: dict[str, DatabaseAdapter] = {}


def resolve_database_url(explicit_sqlite_path: Optional[str] = None) -> str:
    env_url = os.environ.get("DATABASE_URL", "").strip()
    if env_url:
        return env_url
    if explicit_sqlite_path:
        return f"sqlite:///{explicit_sqlite_path}"
    return load_settings().database_url


def _sqlite_path_from_url(url: str) -> str:
    if url.startswith("sqlite:////"):
        return "/" + url[len("sqlite:////"):]
    if url.startswith("sqlite:///"):
        return url[len("sqlite:///"):]
    return str(load_settings().sqlite_path)


def get_adapter(explicit_sqlite_path: Optional[str] = None) -> DatabaseAdapter:
    url = resolve_database_url(explicit_sqlite_path)
    backend = detect_database_backend(url)
    cache_key = f"{backend}:{url}"
    with _ADAPTER_LOCK:
        adapter = _ADAPTER_CACHE.get(cache_key)
        if adapter is None:
            if backend == "postgresql":
                adapter = PostgresAdapter(url)
            else:
                adapter = SQLiteAdapter(_sqlite_path_from_url(url))
            _ADAPTER_CACHE[cache_key] = adapter
        return adapter


def get_db_connection(explicit_sqlite_path: Optional[str] = None) -> DbConnection:
    return get_adapter(explicit_sqlite_path).connect()


def dispose_all_adapters() -> None:
    with _ADAPTER_LOCK:
        for adapter in _ADAPTER_CACHE.values():
            adapter.dispose()
        _ADAPTER_CACHE.clear()
