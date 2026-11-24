# Security Summary

**Reviewed Areas**: Backend API, C SLA/RBAC Engine, Authentication & Session Transport, Input Validation, Database Migrations & Backups, Frontend Portals, and Cloud Rules
**Status**: Hardened & Verified (30 automated Python tests passing, live runtime endpoints verified, Firestore rules deployed cleanly, frontend built and linted)

### Issues Resolved
| Area | File(s) | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|
| C Engine Packaging & Permissions | `backend/c_engine/build.py`, `run_dev.py` | Missing executable bits or stale precompiled binaries could raise `PermissionError` or run outdated C logic. | High | Fixed | Implemented deterministic C builder (`needs_rebuild`, `build_c_engine`, `verify_c_engine`) checking file existence, `os.X_OK`, and source `mtime` (`-O2 -Wall -Wextra -Werror`) automatically on startup. |
| Plaintext Credentials & Secret Fallback | `backend/app/core/config.py`, `backend/seed_data.py`, `backend/security_utils.py` | Plaintext passcodes/defaults and weak runtime secret fallbacks risked credential exposure. | High | Fixed | Removed all plaintext credentials; enforced `hashlib.scrypt` per-user salted hashes, one-time Secretary `bootstrap-claim` or env var, `APP_ENV=production` fail-fast check for `PANCHAYAT_SESSION_SECRET` (>= 32 chars), and `0600` `.session_secret` in dev. |
| Token Exposure, Session Fixation & CSRF | `backend/server.py`, `src/store.js` | Session tokens returned in JSON or missing session-bound CSRF validation risked hijacking and cross-site actions. | High | Fixed | Enforced cookie-only `HttpOnly; Secure; SameSite=None; Partitioned` transport (`panchayat_sid`), deleted raw JSON `token` output, rotated sessions on login (`_issue_session`), revoked prior sessions on password change/reset/suspension, and verified `X-CSRF-Token` against `csrf_token_hash`. |
| Unauthenticated State & Spoofing Headers | `backend/server.py` | Legacy state/reset paths and header-based identity spoofing threatened confidentiality and integrity. | High | Fixed | Removed legacy state/reset endpoints, blocked unauthenticated `X-Staff-Id` / `Authorization: Bearer` attempts with `401` and `HIGH` `SPOOFED_AUTH_HEADER` alerts, and restricted maintenance reset to non-production `SUPER_ADMIN` with confirmation phrase. |
| Incomplete RBAC & Horizontal/Vertical Access | `backend/app/policies/rbac.py`, `backend/server.py` | Staff routes needed deny-by-default enforcement across ward, department, role, and permission flags. | High | Fixed | Routed every view, intake, update, assignment, verification, certificate approval, user update, SLA change, audit export, and deletion through deny-by-default RBAC policies with field-level mobile masking for Ward Officers. |
| Weak Grievance Lifecycle & Fake Stats | `backend/app/policies/rbac.py`, `backend/app/services/sla.py`, `backend/app/services/workflow.py`, `src/citizenPortal.js` | Synthetic `+142` offsets skewed metrics and status/SLA logic lacked pause tracking, holidays, and transition guards. | Medium | Fixed | Implemented 10-state canonical workflow FSM with mandatory remarks, category+priority SLA deadlines excluding Sundays/holidays, `ON_HOLD` clock pausing, auto-escalation sweeps, and exact database-backed statistics. |
| Predictable Tracking Enumeration & PII Leakage | `backend/server.py`, `backend/security_utils.py` | Sequential ticket IDs alone could leak citizen details. | High | Fixed | Issued high-entropy `TK-*` verification tokens stored via HMAC-SHA256, verified alongside `mobileLast4` using `hmac.compare_digest`, and isolated public/staff DTOs (`passcode_hash`, `tracking_token_hash`, `csrf_token_hash` excluded). |
| Injection, Traversal, SSRF & Size Caps | `backend/security_utils.py`, `backend/server.py` | Payloads needed strict allowlists, traversal blocking, safe URL checks, and body caps. | Medium | Fixed | Enforced `ensure_allowed_keys`, control-char normalization, filename traversal rejection, `is_safe_external_https_url`, `validate_photo_url`, parameterized SQL queries, and 2 MB `413` limits. |
| Brute-Force Lockout, Headers & Immutable Audit | `backend/server.py`, `backend/db.py`, `vite.config.js` | Missing progressive lockouts, CSP headers, and tamper-resistant audit retention. | High | Fixed | Added sliding-window rate limits (`429`), 5-attempt / 15-minute account lockouts (`423`), strict CSP & security headers, and `BEFORE UPDATE`/`BEFORE DELETE` SQLite abort triggers on `audit_logs` and `security_alerts`. |
| Unverified Backups & Single-File Monolith | `backend/maintenance.py`, `scripts/*.sh`, `backend/app/` | Missing encrypted backup manifests, restore verification drills, and modular backend separation. | Medium | Fixed | Split backend into `core`, `policies`, `services`, `api`, and `database` packages; added PostgreSQL/Alembic schema; and verified online backups with SHA-256/HMAC manifests and `PRAGMA integrity_check` restore drills. |

---

## PoC Verification

### 1. C Engine Deterministic Build & Non-Executable Recovery
| Field | Value |
|---|---|
| Issue Type | Missing / Non-Executable / Stale Compiled Policy Binary |
| Affected File | `backend/c_engine/build.py` |
| Test Scenario | `test_02_non_executable_binary_detected_and_rebuilt` (`chmod 0644` on binary) and `test_03_outdated_binary_detected_via_mtime_and_rebuilt` |
| Outcome | `needs_rebuild` detects missing `os.X_OK` or newer source `mtime`, recompiles with `-O2 -Wall -Wextra -Werror`, restores `0755`, and verifies output via `verify_c_engine`. |

### 2. Cookie-Only Session, Fixation Protection & CSRF Rejection
| Field | Value |
|---|---|
| Issue Type | Session Fixation / Cross-Site Request Forgery / Header Spoofing |
| Affected File | `backend/server.py` |
| Test Scenario | `test_03_bootstrap_cookie_only_auth_and_session_regeneration`, `test_02_spoofed_staff_and_bearer_headers_without_cookie_return_401`, and `test_03_csrf_token_and_origin_enforcement` |
| Outcome | Login/bootstrap return no `token` in JSON, rotate away any prior `panchayat_sid` cookie (`401` on reuse), reject `X-Staff-Id` / `Bearer` without cookie (`401` + `HIGH` alert), and reject missing/invalid `X-CSRF-Token` or foreign `Origin` (`403`). |

### 3. Horizontal/Vertical Access Control & Citizen Tracking Isolation
| Field | Value |
|---|---|
| Issue Type | Cross-Jurisdiction Access & Predictable Record Enumeration |
| Affected File | `backend/app/policies/rbac.py`, `backend/server.py` |
| Test Scenario | `test_04_rbac_idor_horizontal_and_vertical_escalation_blocked` and `test_full_civic_and_staff_lifecycle` |
| Outcome | Ward 1 Water Officer receives `403` attempting to modify a Ward 4 Roads grievance, approve a certificate, export audit CSV, or delete records; verified citizen tracking requires valid `TK-*` token + `mobileLast4`. |

### 4. SQLi Parameterization, Path Traversal & Oversized Payload Rejection
| Field | Value |
|---|---|
| Issue Type | Query Injection / Path Traversal / Unbounded Payload |
| Affected File | `backend/security_utils.py`, `backend/server.py` |
| Test Scenario | `test_05_sqli_path_traversal_ssrf_and_oversized_payload_guards` |
| Outcome | SQLi string in `?q=` executes safely via parameterized queries (`0` matched rows), `../../etc/passwd` filename returns `400`, internal/non-HTTPS URLs fail `is_safe_external_https_url`, and `Content-Length: 3MB` returns `413`. |

### 5. Brute-Force Lockout, Immutable Audit & Backup Integrity Drill
| Field | Value |
|---|---|
| Issue Type | Credential Guessing / Audit Tampering / Backup Integrity |
| Affected File | `backend/server.py`, `backend/db.py`, `backend/maintenance.py` |
| Test Scenario | `test_07_bruteforce_lockout_and_rate_limit`, `test_08_audit_immutability_and_prod_maintenance_reset_block`, and `scripts/backup.sh` |
| Outcome | 5 failed logins trigger 15-minute `423 Locked` + `Retry-After` + `CRITICAL` alert; SQLite `UPDATE`/`DELETE` on `audit_logs` and `security_alerts` raise `DatabaseError`; backup manifest + `restore-drill` passes `PRAGMA integrity_check` (`ok`). |

---

### Automated Verification Runs
- `python3 backend/c_engine/build.py --force` -> **Exited 0 (`compiled_now=True, compiler=gcc`)**
- `python3 -m unittest discover -s backend/tests -p "test_*.py" -v` -> **30 tests passed (`OK`)**
- `bash scripts/backup.sh` & `bash scripts/restore.sh` -> **`"ok": true, "integrity": "ok"`**
- `python3 backend/maintenance.py retention-check --days 365` -> **`"immutableTriggersActive": true`**
- `npx eslint firestore.rules` -> **Exited 0 (0 errors, 0 warnings)** & Firestore rules deployed via `DeployRules`
- `npm run lint` (`tsc --noEmit`) & `npm run build` (`vite build`) -> **Compiled and linted cleanly**
- Live `GET http://127.0.0.1:3000` (`/api/health`, `/api/ready`, `/api/v1/docs`, `/api/auth/status`, `/api/public/overview`, `/`) -> **All returned `200 OK` with CSP headers and exact DB counts**
