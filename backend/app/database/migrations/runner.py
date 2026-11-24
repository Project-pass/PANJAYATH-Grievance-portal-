"""Unified schema migration runner supporting both SQLite WAL and PostgreSQL 16."""
from __future__ import annotations

import os
from pathlib import Path

from app.core.config import BACKEND_DIR, ConfigurationError


def run_alembic_upgrade(database_url: str) -> None:
    """Execute Alembic migrations against PostgreSQL when SQLAlchemy + Alembic are installed."""
    try:
        from alembic import command
        from alembic.config import Config
    except ImportError as exc:
        raise ConfigurationError(
            "Alembic is required to initialize/migrate PostgreSQL databases. Install requirements.txt."
        ) from exc

    alembic_ini = BACKEND_DIR / "alembic.ini"
    alembic_dir = BACKEND_DIR / "alembic"
    cfg = Config(str(alembic_ini) if alembic_ini.exists() else None)
    cfg.set_main_option("script_location", str(alembic_dir))
    cfg.set_main_option("sqlalchemy.url", database_url)
    os.environ["DATABASE_URL"] = database_url
    command.upgrade(cfg, "head")
