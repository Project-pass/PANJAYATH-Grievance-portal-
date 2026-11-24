# System Architecture

## 1. High-Level Component Topology

```
Browser (Citizen / Staff)
   │  HTTPS / Same-Origin Cookies (panchayat_sid HttpOnly + panchayat_csrf)
   ▼
Vite Dev Proxy / Production Reverse Proxy (:3000)
   ├── Static ES Modules + Tailwind Assets (src/, dist/)
   └── /api/* & /api/v1/* ──▶ Python 3.11 HTTP Server (backend/server.py :3001)
                                  ├── Core: config.py, logging.py, exceptions.py
                                  ├── Policies: rbac.py (deny-by-default & workflow FSM)
                                  ├── Services: sla.py, workflow.py, audit.py
                                  ├── Security: security_utils.py (scrypt, HMAC-SHA256, allowlists)
                                  ├── Native C Engine: backend/c_engine/sla_rbac
                                  └── Persistence: SQLite WAL (backend/db.py) / Postgres ORM + Alembic
```

## 2. Backend Module Responsibilities
- **`backend/server.py`**: Request lifecycle (`X-Request-ID`, structured JSON access logs), origin/CSRF validation, rate limiting, cookie session management, strict response DTO serialization, and REST routing (`/api/*` & `/api/v1/*`).
- **`backend/app/core/config.py`**: Environment resolution (`APP_ENV`), production fail-fast validation of `PANCHAYAT_SESSION_SECRET`, and `0600` `.session_secret` generation in development.
- **`backend/app/core/logging.py`**: Context-local `requestId` propagation and automatic `[REDACTED]` masking of secrets, passcodes, cookies, and tokens in structured logs.
- **`backend/app/core/exceptions.py`**: Typed exception hierarchy (`ValidationError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `PayloadTooLargeError`, `RateLimitError`, `LockedAccountError`) mapped to consistent JSON error envelopes.
- **`backend/app/policies/rbac.py`**: Authoritative Python RBAC evaluator (`evaluate_rbac`) and canonical grievance finite-state machine (`CANONICAL_GRIEVANCE_STATUSES`, `GRIEVANCE_TRANSITIONS`, `validate_grievance_transition`).
- **`backend/app/services/sla.py`**: Category + priority SLA resolver (`DEFAULT_CATEGORY_SLA_DAYS`, `PRIORITY_ADJUSTMENTS`), UTC working-day counter (`count_working_days` excluding Sundays and Panchayat `holidays`), and `ON_HOLD` clock pause calculation.
- **`backend/app/services/workflow.py`**: Duplicate grievance detection, `ON_HOLD` pause/resume accumulation, auto-escalation sweep (`escalate_overdue_grievances`), status history, assignments, and in-app notifications.
- **`backend/app/services/audit.py`**: Paginated audit querying, CSV/JSON streaming exports, and audit retention inspection.
- **`backend/c_engine/build.py` & `sla_rbac.c`**: Deterministic compiler/verifier checking existence, `os.X_OK`, and source `mtime` against `-O2 -Wall -Wextra -Werror` builds.

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
- `src/main.js`: Bootstraps state, renders portals, binds global `Escape` modal/drawer dismissal.
- `src/store.js`: Pure in-memory state (`credentials: 'same-origin'`, `X-CSRF-Token` header injection, `isSubmitting` guard, zero `localStorage` PII/tokens).
- `src/citizenPortal.js`: Citizen home (real DB stats), grievance submission (priority, consent, duplicate warnings), e-service catalog/application, verified citizen tracker + feedback + reopen flow.
- `src/adminPortal.js`: Staff sign-in / first-run bootstrap claim, ward/dept/priority/SLA filtered dashboard, detail drawer with comments & SLA breakdown, escalation sweep, user/RBAC management, password change & admin reset, and CSV/JSON audit export.
- `src/i18n.js` & `src/icons.js`: English/Malayalam translations and accessible status/priority badges.
