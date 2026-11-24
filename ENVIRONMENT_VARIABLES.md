# Environment Variables

All non-secret defaults are documented in `.env.example`.

| Variable | Required in Production | Default (Dev) | Description |
|---|---|---|---|
| `APP_ENV` | Yes (`production`) | `development` | Controls fail-fast secret checks and disables `/api/staff/maintenance/reset` in production. |
| `PANCHAYAT_SESSION_SECRET` | **Yes** (min 32 chars, strong) | Auto-generated 48-byte CSPRNG saved to `backend/data/.session_secret` (`0600`) | HMAC key for session tokens, CSRF tokens, and tracking verification hashes. |
| `PANCHAYAT_SECRETARY_PASSCODE` | Recommended | Unset (uses one-time `bootstrap-claim` UI/API) | Pre-provisions Secretary (`admin_test`) credentials without exposing secrets in code. |
| `PANCHAYAT_ALLOWED_ORIGINS` | Recommended | Same-origin `Host` / `X-Forwarded-Host` | Comma-separated allowlist of trusted browser origins (`https://...`). |
| `PANCHAYAT_SQLITE_PATH` | Optional | `backend/data/panchayat.db` | Override path for SQLite WAL database file. |
| `DATABASE_URL` | Optional (for Postgres/Alembic) | `sqlite:///backend/data/panchayat.db` | Target connection string for PostgreSQL Alembic migrations (`postgresql+psycopg://...`). |
| `PANCHAYAT_BACKUP_KEY` | Yes if using `--encrypt` | Unset (falls back to session secret for HMAC) | Passphrase used for OpenSSL AES-256-CBC PBKDF2 backup encryption and HMAC verification. |
| `PANCHAYAT_MAINTENANCE_KEY` | Optional | Unset | Secondary key required alongside `SUPER_ADMIN` auth for non-prod maintenance reset. |
| `PANCHAYAT_LOG_LEVEL` | Optional | `INFO` | Structured JSON logger level (`DEBUG`, `INFO`, `WARNING`, `ERROR`). |
| `CC` | Optional | Auto-detect (`gcc`, `clang`, `cc`) | Preferred C compiler binary for `backend/c_engine/build.py`. |
