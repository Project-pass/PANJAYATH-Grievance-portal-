# Security Controls & Architecture

## 1. Authentication & Session Hardening
- **Cookie-Only Staff Sessions**: Authenticated sessions use server-issued opaque 256-bit tokens stored hashed (`HMAC-SHA256`) in `sessions.token_hash` and delivered strictly via `HttpOnly; Secure; SameSite=None; Partitioned` cookie (`panchayat_sid`). Raw session tokens are never returned in JSON bodies or stored in `localStorage`.
- **Session Fixation Protection**: `_issue_session` deletes any prior `panchayat_sid` presented during login/bootstrap before issuing a fresh token and CSRF secret.
- **Session Rotation on Credential Changes**:
  - `POST /api/staff/account/change-password` revokes all other active sessions for that user.
  - `POST /api/staff/users/{id}/reset-password` and account suspension revoke all active sessions for the target account.
- **Expiration**: 8-hour absolute TTL (`SESSION_TTL_SECONDS`) and 30-minute idle timeout (`SESSION_IDLE_SECONDS`).
- **Spoofing Rejection**: Presenting `X-Staff-Id` or `Authorization: Bearer` without a valid `panchayat_sid` cookie returns `401 Unauthorized` and writes a `HIGH` `SPOOFED_AUTH_HEADER` alert.

## 2. CSRF & Cross-Origin Defense
- All authenticated `POST`, `PUT`, `PATCH`, and `DELETE` endpoints require `X-CSRF-Token` matching the session's bound `csrf_token_hash` (`hmac.compare_digest`), returning `403 Forbidden` on missing/invalid tokens.
- Mutating requests validate `Origin` against `PANCHAYAT_ALLOWED_ORIGINS` or the same-origin `Host` / `X-Forwarded-Host` header (forwarded cleanly by Nginx `nginx/nginx.conf`).

## 3. Password & Secret Management
- Staff passcodes are hashed with `hashlib.scrypt` (`n=16384, r=8, p=1, dklen=32`) and a unique 16-byte CSPRNG salt per user (`security_utils.py`).
- Passcode complexity requires 8–128 characters combining at least two character classes (letters, digits, symbols).
- Production mode (`APP_ENV=production`) fails fast on startup if `PANCHAYAT_SESSION_SECRET` is absent, shorter than 32 characters, or matches weak marker patterns.
- Production Docker deployments (`docker-compose.prod.yml`) require explicit `POSTGRES_PASSWORD`, `PANCHAYAT_SESSION_SECRET`, and `PANCHAYAT_AUDIT_HMAC_KEY` with zero default fallback passwords.

## 4. Role-Based Access Control (RBAC) & Data Isolation
- **Deny-by-Default**: `backend/app/policies/rbac.py` enforces role, active status, ward jurisdiction (1–15), department match, and granular permission flags (`canApproveCertificates`, `canAssignTickets`, `canManageUsers`, `canDeleteRecords`, `canVerifyDocuments`).
- **Field-Level Masking**: Ward Officers see masked citizen mobile numbers (`******1234`); public tracking requires Tracking ID + high-entropy `TK-*` token (`hmac.compare_digest`) + mobile last 4 digits and returns masked citizen display names without internal remarks.
- **Strict Response DTOs**: DTO serializers strip `passcode_hash`, `tracking_token_hash`, and `csrf_token_hash`; frontend `src/types.js` validates payload structures at runtime boundaries.

## 5. Input Validation, Abuse Protection & Frontend Security
- Backend enforces strict key allowlists (`ensure_allowed_keys`), control-character normalization, filename traversal checks, `data:image/*` / local asset validation, SSRF URL guard, parameterized SQL across SQLite & PostgreSQL, and 2 MB `413` caps.
- Sliding-window per-IP rate limiting (`429`), exponential login delay, and 5-failure / 15-minute account lockout (`423` + `CRITICAL` `ACCOUNT_LOCKED` alert).
- Nginx (`nginx/nginx.conf`) and backend emit `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cache-Control: no-store`, and `X-Request-ID`.
- Frontend ESLint (`eslint.config.js`) explicitly blocks `localStorage`, `sessionStorage`, `eval`, `implied-eval`, `new Function`, `javascript:` URLs, and `alert`/`confirm`/`prompt`.

## 6. Cryptographic Audit Integrity & Cloud Rules
- **Database Triggers**: SQLite (`BEFORE UPDATE`/`BEFORE DELETE` abort triggers) and PostgreSQL (`prevent_append_only_mutation()` PL/pgSQL triggers) block row mutation or deletion on `audit_logs` and `security_alerts`.
- **HMAC-SHA256 Hash Chain (`backend/app/services/audit_integrity.py`)**: Every audit entry receives monotonic `seq_no`, links `prev_hash`, and stores `event_hash = HMAC_SHA256(key, canonical_payload)`. The HMAC key is stored externally via `PANCHAYAT_AUDIT_HMAC_KEY` (or `0600` `.audit_hmac.key` file outside the DB).
- **Signed External Checkpoints & Verification**: `maintenance.py audit-checkpoint` writes signed checkpoint anchors (`audit_checkpoints` + `audit_checkpoints.jsonl`) to detect silent tail truncation or row deletion; `maintenance.py audit-verify` (exit code `1` on tamper) and `GET /api/staff/audit/verify` verify the full chain and checkpoints.
- **Firestore Security Rules**: `firestore.rules` enforces default-deny, `email_verified == true`, strict schemas, terminal-state locks, and immutable audit collections, backed by `firestore.rules.test.mjs` (`@firebase/rules-unit-testing`) and `npx eslint firestore.rules`.
