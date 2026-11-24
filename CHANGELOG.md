# Changelog

## [3.1.0] - 2026-11-24 (Second-Stage Production Remediation)
### Package Management & CI/CD
- Removed mismatched `bun.lock`, pinned Node `22` via `.nvmrc` and `package.json`, aligned `esbuild` to `^0.28.0`, and generated `package-lock.json` (`npm ci` verified).
- Expanded `.github/workflows/ci.yml` to 5 jobs (`python-backend-and-postgres`, `frontend-quality-and-build`, `firebase-emulator-security`, `docker-proxy-acceptance`, `security-and-supply-chain`).

### Docker Production Proxy & PostgreSQL Runtime
- Added `Dockerfile.web` and hardened unprivileged `nginx/nginx.conf` serving Vite `dist/` at `/` with SPA fallback and `/api/` proxying to internal `api:3001`.
- Added `scripts/docker-entrypoint.sh`, hardened `Dockerfile` (non-root `panchayat`), `docker-compose.yml`, and secret-enforced `docker-compose.prod.yml` (`internal: true` Postgres network, zero default passwords).
- Implemented `DATABASE_URL`-driven `DatabaseAdapter` abstraction (`backend/app/database/interface.py`, `sqlite_adapter.py`, `postgres_adapter.py` using SQLAlchemy 2.x `QueuePool`, `connection.py`, `transactions.py`, and domain repositories).
- Completed 18-table SQLAlchemy ORM models (`postgres_models.py`) and Alembic migration `0002_complete_schema_and_audit_chain.py` with PostgreSQL `prevent_append_only_mutation()` triggers.
- Optimized `/api/staff/grievances` with SQL-level `WHERE`/`LIMIT`/`OFFSET` pushdown and `/api/public/overview` with SQL aggregates (reducing 5,000-row paginated latency from `~9.5s` to `P50 62.5ms` / `P95 99.3ms`).

### Cryptographic Audit Integrity, Frontend Type Safety, Firestore Emulator & E2E
- Added HMAC-SHA256 hash chaining (`seq_no`, `prev_hash`, `event_hash`) in Schema v4 and Alembic `0002`, external HMAC key management, signed checkpoints (`audit_checkpoints` + `audit_checkpoints.jsonl`), `/api/staff/audit/verify`, `maintenance.py audit-checkpoint` / `audit-verify`, and 7 tamper-detection tests (`test_audit_integrity.py`).
- Enabled `checkJs: true` + `strictNullChecks: true` in `tsconfig.json`, created `src/types.js` JSDoc schemas + runtime validators, and configured security ESLint rules in `eslint.config.js` (`npm run lint` passes with `0` errors).
- Created genuine `@firebase/rules-unit-testing` suite (`firebase.json`, `firestore.rules.test.mjs`) and Playwright E2E suite (`playwright.config.js`, `tests/e2e/portal.spec.js`), plus configurable `benchmark_runner.py`.

## [3.0.0] - 2026-11-24
### Security & Architecture
- Upgraded session transport to strictly cookie-only (`panchayat_sid`) paired with server-bound `X-CSRF-Token` verification, session fixation rotation, `scrypt` hashing, fail-fast production secret enforcement, structured JSON logging, CSP headers, and SQLite v3 canonical 10-state FSM + working-day SLA engine.
