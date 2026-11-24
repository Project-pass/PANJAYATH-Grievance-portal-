# Testing & Verification Guide

## 1. Automated Python Test Suites (30 Tests)
All backend suites live under `backend/tests/` and run against isolated temporary SQLite databases and ephemeral `ThreadingHTTPServer` ports:

| Suite | File | Scope |
|---|---|---|
| **Unit** | `backend/tests/unit/test_core_and_c_engine.py` | 6 C-engine lifecycle scenarios (missing, non-executable `0o644`, outdated `mtime`, up-to-date skip, syntax error diagnostic, corrupt runtime self-test), prod fail-fast vs dev `0600` secret, log redaction, Python RBAC matrix, canonical workflow transitions, SLA working-day & `ON_HOLD` pause math, seed cleanliness. |
| **Integration** | `backend/tests/integration/test_api_and_migrations.py` | `/api/health`, `/api/ready`, `/api/v1/openapi.json`, real DB `/api/public/overview` stats, cookie-only auth & session fixation rotation, self password change session revocation, admin password reset, pagination, CSV/JSON audit export, escalation sweep, backup + restore-drill + OpenSSL encryption, v1/v2 -> v3 SQLite migration upgrade. |
| **Security** | `backend/tests/security/test_security_suite.py` | Security headers & CSP, `X-Staff-Id`/`Bearer` `401` spoofing alert, CSRF token & cross-origin `403`, horizontal IDOR & vertical privilege escalation, SQLi parameterization, path traversal `400`, SSRF URL guard, `413` size cap, zero credential/PII DTO leakage, 5-failure `423` lockout & `429` rate limit, SQLite audit/alert immutability triggers, prod reset block. |
| **E2E** | `backend/tests/e2e/test_full_journeys.py` | Full journey: bootstrap claim -> officer creation -> citizen grievance (`HIGH`, consent) -> duplicate warning -> officer `IN_PROGRESS` -> `ON_HOLD` -> comment -> `RESOLVED` -> citizen tracking + 5-star feedback -> citizen `REOPENED` -> DB status history audit. |
| **Performance** | `backend/tests/performance/test_benchmarks.py` | 500-grievance transactional bulk insert + paginated ward-filtered query latency budget. |

Run all suites:
```bash
python3 -m unittest discover -s backend/tests -p "test_*.py" -v
```

## 2. Frontend, Rules & Operational Drills
```bash
npm run lint
npm run build
npx eslint firestore.rules
python3 -m compileall -q backend run_dev.py
bash scripts/backup.sh
python3 backend/maintenance.py retention-check --days 365
```

## 3. Verification Scope Note
- **Executed & Verified in Environment**: All 30 Python tests, C-engine rebuild/self-test, live HTTP checks on `:3000`/`:3001`, `scripts/backup.sh`, `scripts/restore.sh`, `retention-check`, `npx eslint firestore.rules`, `npm run lint`, and `npm run build`.
- **Not Executed in Sandbox** (tooling unavailable locally): Docker image build (`docker`), live PostgreSQL daemon (`psql`/Alembic runtime), Playwright headless browser UI runner, and Firebase Emulator Suite (`firebase emulators:exec`).
