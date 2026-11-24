# Testing & Verification Guide

## 1. Automated Python Test Suites (46 Tests)
All backend suites live under `backend/tests/` and run against isolated temporary SQLite databases, ephemeral `ThreadingHTTPServer` ports, and optional live PostgreSQL 16 (`TEST_POSTGRES_URL`):

| Suite | File | Scope |
|---|---|---|
| **Unit** | `backend/tests/unit/test_core_and_c_engine.py` | 6 C-engine lifecycle scenarios, prod fail-fast vs dev `0600` secret, log redaction, Python RBAC matrix, canonical workflow transitions, SLA working-day & `ON_HOLD` pause math, seed cleanliness. |
| **Integration** | `backend/tests/integration/test_api_and_migrations.py` | `/api/health`, `/api/ready`, `/api/v1/openapi.json`, real DB `/api/public/overview` stats, cookie-only auth & session fixation rotation, self password change session revocation, admin password reset, SQL pagination, CSV/JSON audit export, escalation sweep, backup + restore-drill + encryption, v1/v2/v3 -> v4 SQLite migration upgrade. |
| **Postgres Runtime** | `backend/tests/integration/test_postgres_runtime.py` | SQLite/PostgreSQL dialect detection, URL normalization, safe SQL `?` -> `:pN` tokenizer (`translate_qmark_sql`), transient DB retry logic, `DatabaseAdapter` contract, plus live PostgreSQL 16 Alembic + CRUD + trigger test (`TEST_POSTGRES_URL`). |
| **Reverse Proxy Headers** | `backend/tests/integration/test_reverse_proxy_headers.py` | `X-Forwarded-Host`, `Host`, and `Origin` parity across Nginx reverse-proxy boundaries and `nginx/nginx.conf` security directives. |
| **Security** | `backend/tests/security/test_security_suite.py` | Security headers & CSP, `X-Staff-Id`/`Bearer` `401` spoofing alert, CSRF token & cross-origin `403`, IDOR & privilege escalation, SQLi parameterization, traversal `400`, SSRF guard, `413` size cap, zero PII/secret DTO leakage, `423` lockout & `429` rate limit, audit immutability triggers, prod reset block. |
| **Audit Integrity** | `backend/tests/security/test_audit_integrity.py` | 7 tamper-detection tests: valid chain + API/CLI verify, modified row detection, middle-row deletion, tail deletion via signed checkpoint, row reordering, forged checkpoint signature, direct SQL UPDATE/DELETE blocking. |
| **E2E (API)** | `backend/tests/e2e/test_full_journeys.py` | Full lifecycle: bootstrap -> officer creation -> citizen grievance -> duplicate warning -> officer transitions + `ON_HOLD` + comment + `RESOLVED` -> tracking + 5-star feedback -> `REOPENED` -> DB status history audit. |
| **Performance** | `backend/tests/performance/test_benchmarks.py` & `benchmark_runner.py` | 500 & 5,000-row transactional inserts, SQL-filtered paginated queries, public overview, 8-worker concurrency spike, and graceful shutdown P50/P95/P99 latency budgets. |

## 2. Observed SQLite WAL Benchmark Results (`benchmark_runner.py --counts 500 5000`)
| Scale | Bulk Insert | Paginated Query (`P50 / P95 / P99`) | Public Overview (`P50 / P95 / P99`) |
|---|---|---|---|
| `500` rows | `24.93 ms` (`19,735 rows/s`) | `22.31 / 53.78 / 55.95 ms` | `18.42 / 37.13 / 37.14 ms` |
| `5,000` rows | `225.68 ms` (`19,940 rows/s`) | `62.52 / 99.34 / 124.90 ms` | `25.47 / 55.98 / 70.04 ms` |

8-worker concurrency spike (`24` mixed read/write requests): `0` HTTP 5xx errors (`P50 399.07 ms`, `P95 696.32 ms`, `P99 734.65 ms`). Graceful shutdown + adapter disposal: `224.03 ms`.

## 3. Frontend, Firestore Rules & Playwright Commands
```bash
npm ci
npm run lint          # tsc --noEmit (checkJs: true) && eslint .
npm run build         # Vite production bundle -> dist/
npx eslint firestore.rules
npx firebase emulators:exec --only firestore "npm run test:firestore"
npx playwright test   # Browser E2E (tests/e2e/portal.spec.js)
```

## 4. Verification Scope (Sandbox vs CI)
- **Executed & Verified in Sandbox**: `npm ci`, `npm run lint` (`tsc --noEmit` + security ESLint), `npm run build`, `npx eslint firestore.rules`, `python3 backend/c_engine/build.py --force`, `45` passed Python tests (`1` live-PostgreSQL test skipped without `TEST_POSTGRES_URL`), `benchmark_runner.py --counts 500 5000`, `maintenance.py` (`audit-checkpoint`, `audit-verify`, `backup`, `restore-drill`, `retention-check`), and `npx playwright test --list` (`6` tests discovered).
- **Blocked in Sandbox (Missing Binaries — Executed in CI `.github/workflows/ci.yml`)**: Docker daemon (`docker`), live PostgreSQL 16 (`psql`/Alembic runtime), Java JRE (`firebase emulators:exec`), Chromium browser (`playwright test`), and Python `ruff`/`mypy`/`pip-audit`.
