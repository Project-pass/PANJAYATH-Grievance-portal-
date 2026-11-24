# System Architecture

## 1. High-Level Component Topology

```
Browser (Citizen / Staff)
   │  HTTPS / Same-Origin Cookies (panchayat_sid HttpOnly + panchayat_csrf)
   ▼
Nginx Production Reverse Proxy (:8080, Dockerfile.web) / Vite Dev Proxy (:3000)
   ├── Static Built SPA Bundle (dist/, try_files -> /index.html, Security & CSP Headers)
   └── /api/* & /api/v1/* ──▶ Internal Python 3.11 HTTP API (backend/server.py :3001)
                                  ├── Core: config.py, logging.py, exceptions.py
                                  ├── Policies: rbac.py (deny-by-default & 10-state FSM)
                                  ├── Services: sla.py, workflow.py, audit.py, audit_integrity.py
                                  ├── Security: security_utils.py (scrypt, HMAC-SHA256, allowlists)
                                  ├── Native C Engine: backend/c_engine/sla_rbac
                                  └── DatabaseAdapter Layer (app/database/)
                                        ├── SQLiteAdapter (WAL mode + BEGIN IMMEDIATE)
                                        └── PostgresAdapter (SQLAlchemy 2.x QueuePool + psycopg3 + Alembic)
```

## 2. Backend Module Responsibilities
- **`backend/server.py`**: Threading HTTP server with graceful `SIGTERM`/`SIGINT` adapter disposal, `X-Request-ID` correlation, structured JSON access logs, origin/CSRF validation, cookie session management, strict DTO serialization, SQL-level filtered grievance pagination, and REST routing (`/api/*` & `/api/v1/*`).
- **`backend/app/database/`**:
  - `interface.py`: `DatabaseAdapter` contract, `RowProxy`, safe SQL tokenizer translating `?` placeholders to `:pN` (`translate_qmark_sql`), transient error detection (`is_transient_db_error`), and retry helper (`with_db_retry`).
  - `sqlite_adapter.py`: Thread-safe SQLite WAL adapter with `PRAGMA foreign_keys = ON` and serialized write lock.
  - `postgres_adapter.py`: SQLAlchemy 2.x engine with `QueuePool` (`pool_size=10`, `max_overflow=20`, `pool_pre_ping=True`, `pool_recycle=1800`).
  - `connection.py` & `transactions.py`: `DATABASE_URL`-driven adapter resolver, `get_db_connection()`, `run_transaction()`, and `dispose_all_adapters()`.
  - `repositories/`: Parameterized data access repositories (`GrievanceRepository`, `StaffRepository`, `ServiceRepository`, `AuditRepository`).
  - `postgres_models.py` & `migrations/runner.py`: Complete 18-table SQLAlchemy ORM metadata and programmatic Alembic upgrade runner.
- **`backend/app/services/audit_integrity.py`**: Cryptographic HMAC-SHA256 hash chaining (`seq_no`, `prev_hash`, `event_hash`), signed external checkpoints (`audit_checkpoints.jsonl`), key separation (`PANCHAYAT_AUDIT_HMAC_KEY`), and chain tamper verification (`/api/staff/audit/verify`, `maintenance.py audit-verify`).
- **`backend/app/core/config.py`, `logging.py`, `exceptions.py`**: Environment resolution, fail-fast secret checks, `[REDACTED]` log scrubbing, and typed `AppError` JSON responses.
- **`backend/app/policies/rbac.py`**: Authoritative Python RBAC evaluator (`evaluate_rbac`) and canonical 10-state grievance finite-state machine.
- **`backend/app/services/sla.py` & `workflow.py`**: Category + priority SLA resolver, working-day calculation excluding Sundays and Panchayat holidays, `ON_HOLD` clock pause tracking, duplicate detection, and overdue escalation sweeps.
- **`backend/c_engine/build.py` & `sla_rbac.c`**: Deterministic C compiler/verifier checking existence, `os.X_OK`, and source `mtime` (`-O2 -Wall -Wextra -Werror`).

## 3. Canonical Grievance Lifecycle
1. `SUBMITTED` -> Initial public or walk-in intake when no ward officer is auto-matched.
2. `ASSIGNED` -> Auto-routed at intake or explicitly assigned to an active `WARD_OFFICER`.
3. `ACKNOWLEDGED` -> Desk verification / acknowledgment by CSC or Secretary.
4. `IN_PROGRESS` -> Active field inspection or engineering remediation.
5. `ON_HOLD` -> Pauses SLA working-day timer until moved back to active work (mandatory remark >= 5 chars).
6. `ESCALATED` -> Flagged manually or via `/api/staff/grievances/escalate-overdue` when SLA working days exceed limit.
7. `RESOLVED` -> Redressal complete (`resolved_at` recorded; enables 1–5 star citizen feedback).
8. `CLOSED` -> Final closure after resolution (Super Admin).
9. `REJECTED` -> Closed as invalid/out-of-scope (mandatory remark >= 5 chars).
10. `REOPENED` -> Reopened by verified citizen (`POST /api/public/grievances/{id}/reopen`) or Super Admin from `RESOLVED`/`CLOSED`/`REJECTED` (clears `resolved_at`, mandatory reason >= 5 chars).

## 4. Frontend Module Structure
- `tsconfig.json` (`checkJs: true`, `strictNullChecks: true`, `noUnusedLocals`, `noUnusedParameters`) + `eslint.config.js` (`@eslint/js` + security restrictions banning `localStorage`, `sessionStorage`, `eval`, `alert`).
- `src/types.js`: Centralized JSDoc `@typedef` domain schemas and runtime API response validators (`parsePublicOverviewPayload`, `parseStaffDashboardPayload`, `parseTrackedRecordPayload`).
- `src/main.js`, `src/store.js`, `src/citizenPortal.js`, `src/adminPortal.js`, `src/i18n.js`, `src/icons.js`, `src/firebase.js`: Pure in-memory ES module portal (`credentials: 'same-origin'`, `X-CSRF-Token` header injection).
