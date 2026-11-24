from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
SECRET_FILE_PATH = DATA_DIR / ".session_secret"

_WEAK_SECRET_MARKERS = {
    "changeme",
    "secret",
    "default",
    "password",
    "admin_test",
    "panchayat",
    "1234567890",
    "test-secret",
    "dev-secret",
}


class ConfigurationError(RuntimeError):
    """Raised when required security or environment configuration is invalid."""


def get_app_env() -> str:
    env = (os.environ.get("APP_ENV") or os.environ.get("NODE_ENV") or "development").strip().lower()
    return env or "development"


def is_production_env() -> bool:
    return get_app_env() == "production"


def validate_session_secret_strength(secret: str) -> None:
    if not isinstance(secret, str):
        raise ConfigurationError("PANCHAYAT_SESSION_SECRET must be a string.")
    s = secret.strip()
    if len(s) < 32:
        raise ConfigurationError(
            "PANCHAYAT_SESSION_SECRET must be at least 32 characters long."
        )
    low = s.lower()
    if low in _WEAK_SECRET_MARKERS or len(set(s)) < 8:
        raise ConfigurationError(
            "PANCHAYAT_SESSION_SECRET is too weak or uses a disallowed default pattern."
        )


def load_or_create_session_secret(
    secret_file: Path = SECRET_FILE_PATH,
    production: bool | None = None,
) -> bytes:
    """Resolve persistent HMAC/session secret.

    - In production: PANCHAYAT_SESSION_SECRET MUST be set and strong; fail fast otherwise.
    - In non-production: uses env var if set (and validates strength); otherwise generates once
      with CSPRNG and persists with 0600 permissions so sessions and tracking tokens survive restarts.
    """
    is_prod = is_production_env() if production is None else production
    env_val = os.environ.get("PANCHAYAT_SESSION_SECRET", "").strip()

    if is_prod:
        if not env_val:
            raise ConfigurationError(
                "PANCHAYAT_SESSION_SECRET is required in production mode and cannot be auto-generated."
            )
        validate_session_secret_strength(env_val)
        return env_val.encode("utf-8")

    if env_val:
        validate_session_secret_strength(env_val)
        return env_val.encode("utf-8")

    secret_file.parent.mkdir(parents=True, exist_ok=True)
    if secret_file.exists():
        stored = secret_file.read_text(encoding="utf-8").strip()
        if len(stored) >= 32 and len(set(stored)) >= 8:
            return stored.encode("utf-8")

    generated = secrets.token_urlsafe(48)
    fd = os.open(str(secret_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, generated.encode("utf-8"))
    finally:
        os.close(fd)
    return generated.encode("utf-8")


@dataclass(frozen=True)
class Settings:
    app_env: str
    is_production: bool
    database_url: str
    sqlite_path: Path
    backup_dir: Path
    audit_jsonl_path: Path
    allowed_origins: tuple[str, ...]
    max_body_bytes: int = 2 * 1024 * 1024
    session_ttl_seconds: int = 8 * 3600
    session_idle_seconds: int = 30 * 60
    lockout_threshold: int = 5
    lockout_duration_seconds: int = 15 * 60
    log_level: str = "INFO"


def load_settings() -> Settings:
    app_env = get_app_env()
    sqlite_path = Path(os.environ.get("PANCHAYAT_SQLITE_PATH", str(DATA_DIR / "panchayat.db")))
    db_url = os.environ.get("DATABASE_URL", "").strip() or f"sqlite:///{sqlite_path}"
    origins_raw = os.environ.get("PANCHAYAT_ALLOWED_ORIGINS", "").strip()
    allowed_origins = tuple(o.strip().lower() for o in origins_raw.split(",") if o.strip())
    return Settings(
        app_env=app_env,
        is_production=(app_env == "production"),
        database_url=db_url,
        sqlite_path=sqlite_path,
        backup_dir=BACKEND_DIR / "backups",
        audit_jsonl_path=DATA_DIR / "audit_log.jsonl",
        allowed_origins=allowed_origins,
        log_level=os.environ.get("PANCHAYAT_LOG_LEVEL", "INFO").strip().upper() or "INFO",
    )
