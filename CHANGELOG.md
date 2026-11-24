# Changelog

## [3.0.0] - 2026-11-24
### Security & Architecture
- Upgraded session transport to strictly cookie-only (`panchayat_sid` `HttpOnly; Secure; SameSite=None; Partitioned`) paired with server-bound `X-CSRF-Token` (`panchayat_csrf`) verification on all authenticated mutations.
- Added session fixation rotation in `_issue_session` and automatic session revocation on password change, admin password reset, and account suspension.
- Implemented production fail-fast validation for `PANCHAYAT_SESSION_SECRET` (`>= 32` chars) and `0600` auto-generation in development (`backend/app/core/config.py`).
- Added structured JSON request logging with `X-Request-ID` correlation and secret redaction (`backend/app/core/logging.py`), plus typed `AppError` exceptions (`backend/app/core/exceptions.py`).
- Added Content-Security-Policy (CSP) headers on both Python API responses and Vite dev server.
- Added optional AES-256-CBC OpenSSL encryption and HMAC-SHA256 verification to `backend/maintenance.py` and shell scripts (`scripts/backup.sh`, `scripts/restore.sh`).

### Workflow, SLA & Database
- Introduced SQLite schema v3 migrations (`external_uuid`, `csrf_token_hash`, `request_id`, `wards`, `departments`, `grievance_categories`, `sla_policies`, `holidays`, `grievance_status_history`, `grievance_assignments`, `grievance_comments`, `attachments`, `notifications`).
- Implemented canonical 10-state grievance finite-state machine (`SUBMITTED`..`REOPENED`) with mandatory remarks on key transitions (`backend/app/policies/rbac.py`), synced to `firestore.rules` and `firebase-blueprint.json`.
- Replaced raw wall-clock SLA math with category + priority deadlines, Sunday/holiday exclusion, and `ON_HOLD` clock pause/resume tracking (`backend/app/services/sla.py`, `workflow.py`).
- Removed synthetic `+142` / hardcoded stat offsets from `/api/public/overview` and `src/citizenPortal.js` so metrics reflect real database rows.
- Added PostgreSQL 16 SQLAlchemy ORM models and Alembic baseline migration (`backend/app/database/postgres_models.py`, `backend/alembic/`).
- Built deterministic C-engine builder (`backend/c_engine/build.py`) checking existence, executable bits, and source `mtime`.
- Organized automated test suite across `unit`, `integration`, `security`, `e2e`, and `performance` modules (30 tests).
