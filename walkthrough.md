# Security Summary

**Reviewed Files**: 17
**Issues Resolved**: 11

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Unauthenticated State & Reset Exposure | `backend/server.py` | 483 | Legacy state and reset routes exposed all citizen/staff records and allowed unauthenticated database wipes. | High | Fixed | Removed legacy `/api/state` and `/api/reset`; split `/api/public/*` vs `/api/staff/*` routes and gated maintenance resets behind `SUPER_ADMIN` auth, explicit confirmation phrase, optional `PANCHAYAT_MAINTENANCE_KEY`, and non-production check (`backend/server.py:1456`). |
| Plaintext PIN Storage & UI Leakage | `backend/seed_data.py` | 1 | Seed accounts and API/UI responses stored and displayed plaintext staff PINs and autofill buttons. | High | Fixed | Removed all plaintext PINs from `backend/seed_data.py`, `backend/db.py`, API DTOs, and `src/adminPortal.js`; hashed staff passcodes with `hashlib.scrypt` + per-user random salt (`backend/security_utils.py:72`) and added a first-run one-time Secretary setup claim (`POST /api/auth/bootstrap-claim`). |
| Spoofable Staff Header Authentication | `backend/server.py` | 395 | Raw `X-Staff-Id` header or client-side role switcher could impersonate privileged staff accounts. | High | Fixed | Replaced with server-issued opaque session tokens + `HttpOnly; Secure; SameSite=None; Partitioned` cookies (`backend/server.py:437`); unauthenticated `X-Staff-Id` requests return `401` and trigger a `HIGH` `SPOOFED_AUTH_HEADER` alert (`backend/server.py:550`). |
| Client Token & Cache Exposure | `src/store.js` | 38 | Session identity and cached portal state were stored in `localStorage`. | Medium | Fixed | Removed all `localStorage` session/record storage and role impersonation switching (`src/main.js`); keeps short-lived bearer token only in JavaScript memory alongside `HttpOnly` cookie transport. |
| Sequential Citizen Tracking PII Leakage | `backend/server.py` | 900 | Predictable sequential IDs (`ABC-GRV-2026-101`) allowed anonymous lookup of citizen names, mobile numbers, and remarks. | High | Fixed | Generated per-ticket high-entropy verification tokens (`TK-*`, HMAC-SHA256 stored hashed in DB) requiring Tracking ID + Verification Token + Mobile Last 4 on `POST /api/public/track` (`backend/server.py:900`), returning masked citizen names (`mask_name`) and zero mobile/internal remarks. |
| Missing Per-Record & Field-Level Authorization | `backend/server.py` | 567 | Staff queries and mutations needed strict server-side principal, ward, department, and permission-bit validation. | High | Fixed | Routed every view, walk-in, update, assignment, verification, certificate approval, user management, SLA update, and deletion through the compiled C RBAC matrix (`backend/c_engine/sla_rbac.c`) via `call_c_rbac` (`backend/server.py:118`) and applied field-level mobile masking for Ward Officers. |
| Credential Fields in Response Objects | `backend/server.py` | 165 | Raw database rows risked leaking credential hashes or internal tokens if serialized directly. | Medium | Fixed | Introduced explicit response DTOs (`staff_self_dto`, `staff_directory_min_dto`, `public_grievance_summary_dto`, `citizen_tracked_grievance_dto`, `staff_grievance_dto`, `staff_service_dto`) excluding `passcode_hash` and `tracking_token_hash`. |
| Missing Input Allowlists, Normalization & Size Caps | `backend/security_utils.py` | 163 | Payloads lacked strict unknown-field allowlists, control-character normalization, safe image URI filtering, and body size limits. | Medium | Fixed | Enforced strict key allowlists (`ensure_allowed_keys`), control-character stripping (`normalize_text`), strict `data:image/*` / local asset validation (`validate_photo_url`), and a 2 MB request body limit (`413 Payload Too Large`). |
| Flat JSON Storage & Missing Constraints | `backend/db.py` | 25 | State persisted in an unindexed JSON file without schema constraints, migrations, backups, or append-only enforcement. | High | Fixed | Migrated to transactional SQLite WAL (`PRAGMA foreign_keys = ON`, `BEGIN IMMEDIATE`, schema migrations, `CHECK` constraints), deleted legacy `portal_db.json`, added `backend/maintenance.py` backup/restore-drill/retention CLI, and provisioned hardened Cloud Firestore rules (`firestore.rules`). |
| Missing Brute-Force Lockout & Rate Limiting | `backend/server.py` | 448 | Auth and public submission endpoints lacked sliding-window throttling, progressive backoff, and account lockouts. | Medium | Fixed | Added per-IP sliding-window rate limits (`429 Too Many Requests` + `Retry-After`), exponential failure delay, and 5-attempt / 15-minute account lockouts (`423 Locked`) logged to `security_alerts`. |
| Mutable Audit Trail & Missing HTTP Security Headers | `backend/db.py` | 156 | Audit events lacked database-level immutability, session prefixes, and hardened browser/CORS response headers. | Medium | Fixed | Added `BEFORE UPDATE`/`BEFORE DELETE` SQLite triggers (`trg_audit_no_update`, `trg_audit_no_delete`) + JSONL mirror, strict same-origin `Origin` checks (`403`), and `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, and `Cache-Control: no-store` headers. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Firebase & Firestore Security Rules | `firestore.rules` | Enforces default-deny catch-all (`allow read, write: if false`), verified email gates (`request.auth.token.email_verified == true`), strict field `hasAll`/`hasOnly` allowlists, `request.time` timestamp immutability, PII split collections (`grievance_summaries` vs `grievances_private`), terminal-state locks, and immutable `audit_logs`/`security_alerts`. Lint-verified cleanly with `@firebase/eslint-plugin-security-rules`. |
| Transactional Persistence & Backups | `backend/db.py`, `backend/maintenance.py` | Uses parameterized SQL queries exclusively (`?` placeholders), `BEGIN IMMEDIATE` write transactions, `CHECK` constraints, SHA-256 backup manifests, and verified test-restore integrity (`PRAGMA integrity_check` = `ok`). |
| C SLA & RBAC Policy Engine | `backend/c_engine/sla_rbac.c` | Validates CLI integer bounds strictly with `strtol` (no `atoi`) and evaluates role bitmasks, ward bitmasks, department match, and explicit action codes (`VIEW`, `CREATE_WALKIN`, `UPDATE`, `ASSIGN`, `VERIFY`, `APPROVE_CERT`, `MANAGE_USERS`, `DELETE`, `MANAGE_SLA`, `MAINTENANCE_RESET`). |
| Dependency Audit | `package.json`, `bun.lock` | `bun audit` found zero direct vulnerabilities in application packages (`1 high`, `1 low` advisory only in transitive `@grpc/grpc-js@1.9.16` under `@firebase/firestore-compat`, unused by browser Web SDK / Python API). Status: `Needs Follow-Up` only if Node gRPC Firestore compat were later enabled on server. |

---

## PoC Verification

### 1. Spoofed `X-Staff-Id` Header & Unauthenticated Staff Access Blocked
#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Authentication / Header Spoofing |
| Impact | High |
| Affected File | `backend/server.py:395-403, 547-561` |
| Test Scenario | `GET /api/staff/dashboard` sent with forged header `X-Staff-Id: stf-secretary` and no valid session token (`test_03_spoofed_staff_header_rejected_and_alert_logged`). |

#### How It Was Fixed
Authentication ignores `X-Staff-Id` completely, requires an HMAC-SHA256-hashed opaque session token via `Authorization: Bearer` or `HttpOnly` cookie `panchayat_sid`, and raises a `HIGH` severity security alert when raw `X-Staff-Id` spoofing is attempted.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Forged request arrives at `do_GET` (`backend/server.py:547`). | Enters `/api/staff/dashboard` handler |
| 2 | `_authenticate(conn)` detects `X-Staff-Id` with no Bearer/cookie token (`backend/server.py:397-400`). | Returns `(None, "spoof_header", "none")` |
| 3 | Handler records `SPOOFED_AUTH_HEADER` in `security_alerts` (`backend/server.py:550-559`) and returns `401`. | **Handled Safely (`401 Unauthorized`)** |

#### Conclusion
**Fix Verified** - Raw staff IDs cannot establish or spoof an authenticated staff session.

---

### 2. Cross-Ward / Cross-Department & Certificate Privilege Escalation Blocked
#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Per-Record & Action Authorization |
| Impact | High |
| Affected File | `backend/server.py:118-160, 1522-1533, 1648-1662`, `backend/c_engine/sla_rbac.c` |
| Test Scenario | Authenticated `WARD_OFFICER` (Ward 1, `Water & Sanitation`, `canApproveCertificates=false`) attempts `PATCH /api/staff/grievances/ABC-GRV-2026-101` (Ward 4 Roads), `PATCH /api/staff/services/ABC-SRV-2026-201` (`status="Approved"`), `POST /api/staff/users`, `PUT /api/staff/config/sla`, and `DELETE` (`test_07_rbac_ward_and_dept_isolation_and_negative_tests`). |

#### How It Was Fixed
Every staff read and write operation checks the server-verified principal's role, permission bitmask, assigned ward bitmask, and department match against the C RBAC matrix before returning data or mutating SQLite rows.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `WARD_OFFICER` sends `PATCH /api/staff/grievances/ABC-GRV-2026-101` (`backend/server.py:1508`). | Authenticated principal loaded |
| 2 | Server loads target Ward 4 ticket and invokes `call_c_rbac(actor, 4, False, "UPDATE")` (`backend/server.py:1526`). | C engine rejects ward & department mismatch |
| 3 | Handler logs `FORBIDDEN_RECORD_UPDATE` (`backend/server.py:1528`) and returns `403`. | **Handled Safely (`403 Forbidden`)** |

#### Conclusion
**Fix Verified** - Staff members cannot view or mutate grievances outside their assigned ward/department or approve certificates without explicit authority.

---

### 3. Predictable Citizen Tracking ID Enumeration Blocked
#### Summary
| Field | Value |
|---|---|
| Issue Type | Insecure Direct Record Enumeration & PII Disclosure |
| Impact | High |
| Affected File | `backend/server.py:900-944` |
| Test Scenario | `POST /api/public/track` called with valid `ABC-GRV-2026-109` and valid `mobileLast4`, but an invalid tracking token `TK-wrongtokenvalue123` (`test_09_citizen_tracking_requires_high_entropy_token_and_last4`). |

#### How It Was Fixed
Citizen receipts now issue a cryptographically random `TK-*` verification token stored hashed with HMAC-SHA256; lookup requires constant-time (`hmac.compare_digest`) matches on both the token hash and the 4-digit mobile suffix, and returns only masked citizen display names.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Tracking query enters `POST /api/public/track` (`backend/server.py:900`). | Passes rate limit & schema check |
| 2 | `hmac.compare_digest(row["tracking_token_hash"], hash_token(token))` evaluates false (`backend/server.py:915`). | Constant-time token mismatch |
| 3 | Logs `TRACKING_VERIFICATION_FAILED` alert (`backend/server.py:931`) and returns `404`. | **Handled Safely (`404 Not Found`)** |

#### Conclusion
**Fix Verified** - Guessing sequential tracking IDs no longer exposes citizen personal details or remarks.

---

### 4. Unexpected Shadow Fields, Script URIs & Oversized Payloads Rejected
#### Summary
| Field | Value |
|---|---|
| Issue Type | Mass Assignment / Unsafe URI / Unbounded Payload |
| Impact | Medium |
| Affected File | `backend/security_utils.py:148-208`, `backend/server.py:355-365` |
| Test Scenario | `POST /api/public/grievances` sent with extra `{"isAdmin": true}`, `{"ward": 99}`, `{"beforePhotoUrl": "javascript:alert(1)"}`, and `Content-Length: 3145728` (`test_08_schema_allowlist_xss_url_and_size_caps`). |

#### How It Was Fixed
Payload decoders enforce a 2 MB `Content-Length` cap (`413`), strict key allowlists rejecting any unrecognized fields (`400`), range/enum validation, and strict `data:image/*` or allowlisted local asset URI matching.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Extra `isAdmin` or `javascript:alert(1)` enters `validate_grievance_create` (`backend/security_utils.py:175`). | Strict schema validation invoked |
| 2 | `ensure_allowed_keys` / `validate_photo_url` raises `ValueError` (`backend/security_utils.py:167, 160`). | Handler returns `400 Bad Request` |
| 3 | `3 MB` `Content-Length` hits `_read_json()` guard (`backend/server.py:362`). | **Handled Safely (`413 Payload Too Large`)** |

#### Conclusion
**Fix Verified** - Extra privilege fields, unsafe URI schemes, out-of-range wards, and oversized payloads are rejected prior to database access.

---

### 5. Brute-Force Account Lockout, Cross-Origin Rejection & Immutable Audit Triggers
#### Summary
| Field | Value |
|---|---|
| Issue Type | Credential Brute-Force / Cross-Origin State Mutation / Audit Tampering |
| Impact | High |
| Affected File | `backend/server.py:325-330, 740-819`, `backend/db.py:156-189` |
| Test Scenario | (a) 5 wrong logins followed by a 6th login with valid passcode (`test_10`); (b) `POST /api/public/track` with `Origin: https://evil.example` (`test_12`); (c) SQLite `UPDATE`/`DELETE` executed against `audit_logs` (`test_11`). |

#### How It Was Fixed
Failed logins increment per-account failure counters with exponential backoff and trigger a 15-minute `423 Locked` state + `CRITICAL` alert after 5 failures; mutating endpoints verify same-origin headers (`403`); SQLite enforces `BEFORE UPDATE` and `BEFORE DELETE` abort triggers on `audit_logs` and `security_alerts`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | 5th failed login sets `locked_until = now + 900` (`backend/server.py:770`) and emits `ACCOUNT_LOCKED`. | 6th attempt returns `423 Locked` |
| 2 | Cross-origin `POST` fails `_check_csrf_and_origin()` (`backend/server.py:327`). | Returns `403 Forbidden` |
| 3 | Direct `UPDATE` or `DELETE` on `audit_logs` hits `trg_audit_no_update` / `trg_audit_no_delete` (`backend/db.py:156-166`). | **Handled Safely (`SQLite ABORT`)** |

#### Conclusion
**Fix Verified** - Repeated credential guessing locks accounts with security alerts, foreign origins cannot mutate state, and audit records cannot be altered or purged.

---

### Automated Verification Runs
- `python3 -m unittest -v backend/tests/test_security_hardening.py` -> **13 tests passed (`OK`)**
- `python3 backend/maintenance.py backup` & `restore-drill` -> **`"ok": true, "integrity": "ok"`**
- `python3 backend/maintenance.py retention-check --days 365` -> **`"immutableTriggersActive": true`**
- `npx eslint firestore.rules` -> **Exited 0 (0 errors, 0 warnings)**
- `npm run build` & `tsc --noEmit` -> **Compiled and linted cleanly**
