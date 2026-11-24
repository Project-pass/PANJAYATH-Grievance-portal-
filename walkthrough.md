# Security & Remediation Walkthrough

**Branch**: `production-remediation-v2`
**Scope**: Six-pillar production remediation across CI/CD packaging, Nginx + Docker multi-service deployment, `DATABASE_URL`-driven PostgreSQL runtime, real Firebase Emulator rules testing, `checkJs` frontend type safety + security ESLint, and HMAC-SHA256 cryptographic audit integrity.

## Key Remediation Highlights
1. **Deterministic `npm ci` & Node 22 Parity**:
   - Eliminated stale `bun.lock`, aligned `esbuild@^0.28.0` with Vite 8, added `.nvmrc` (`22`), regenerated `package-lock.json`, and verified `npm ci` (`375 packages`, exit `0`).
2. **Production Nginx + API + PostgreSQL Containers**:
   - Built `Dockerfile.web` + `nginx/nginx.conf` serving Vite `dist/` at `/` (SPA fallback) and proxying `/api/` to `api:3001` with `X-Forwarded-Host`, CSP, and security headers.
   - Separated internal `postgres:16-alpine` on an `internal: true` network with `docker-compose.prod.yml` rejecting missing secrets (`POSTGRES_PASSWORD`, `PANCHAYAT_SESSION_SECRET`, `PANCHAYAT_AUDIT_HMAC_KEY`).
3. **Real PostgreSQL Runtime & SQL Query Optimization**:
   - Implemented `DatabaseAdapter` (`SQLiteAdapter` + `PostgresAdapter` via SQLAlchemy 2.x `QueuePool`), safe SQL `?` -> `:pN` translation, transient-error retries, graceful `SIGTERM`/`SIGINT` pool disposal, 18-table ORM parity, and Alembic `0002` triggers.
   - Pushed grievance RBAC/filters/pagination and `/api/public/overview` aggregations into SQL, cutting 5,000-row paginated latency from `~9,500 ms` to `P50 62.52 ms` / `P95 99.34 ms` with `0` HTTP 5xx errors under 8-worker concurrent load.
4. **Cryptographic Audit Hash Chain & Checkpoints**:
   - Added monotonic `seq_no`, `prev_hash`, `event_hash` HMAC-SHA256 chaining (`backend/app/services/audit_integrity.py`) using external key material (`PANCHAYAT_AUDIT_HMAC_KEY` / `0600` key file).
   - Added signed external checkpoints (`audit_checkpoints.jsonl`), `/api/staff/audit/verify`, `maintenance.py audit-checkpoint`/`audit-verify`, and 7 tamper-detection tests covering modified, deleted, tail-truncated, and reordered rows.
5. **Frontend `checkJs: true`, Runtime Validation & Security ESLint**:
   - Enabled `checkJs: true` + `strictNullChecks: true` in `tsconfig.json`, added JSDoc `@typedef` schemas and runtime API boundary parsers in `src/types.js`, and banned `localStorage`/`sessionStorage`/`eval`/`alert` in `eslint.config.js`.
6. **Genuine Firestore Emulator Rules & Playwright E2E Suites**:
   - Implemented `firestore.rules.test.mjs` (`@firebase/rules-unit-testing`) and `tests/e2e/portal.spec.js` (`playwright.config.js`).

## Verification Ledger (Sandbox vs CI)
- **Verified Directly in Sandbox**:
  - `npm ci` -> **Passed**
  - `npm run lint` (`tsc --noEmit && eslint .`) -> **Passed (0 errors)**
  - `npm run build` -> **Passed (`dist/` built)**
  - `npx eslint firestore.rules` -> **Passed**
  - `python3 backend/c_engine/build.py --force` -> **Passed**
  - `python3 -m unittest discover -s backend/tests -p "test_*.py" -v` -> **45 passed, 1 skipped** (`LivePostgresAcceptanceTests` requires live `TEST_POSTGRES_URL`)
  - `python3 backend/tests/performance/benchmark_runner.py --counts 500 5000` -> **Passed (`P95 <= 99.34 ms`, `0` 5xx)**
  - `python3 backend/maintenance.py audit-checkpoint && audit-verify && backup && restore-drill && retention-check` -> **All passed**
  - `npx playwright test --list` -> **6 tests discovered**
- **Blocked on Missing Sandbox Binaries (Covered by `.github/workflows/ci.yml`)**:
  - `docker` / `docker compose`, live PostgreSQL 16 (`psql`/Alembic runtime), Java JRE (`firebase emulators:exec` failed with `Could not spawn java -version`), Chromium browser, and Python `ruff`/`mypy`/`pip-audit`.
