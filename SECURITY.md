# Security Controls & Architecture

## 1. Authentication & Session Hardening
- **Cookie-Only Staff Sessions**: Authenticated sessions use server-issued opaque 256-bit tokens stored hashed (`HMAC-SHA256`) in SQLite `sessions.token_hash` and delivered strictly via `HttpOnly; Secure; SameSite=None; Partitioned` cookie (`panchayat_sid`). Raw session tokens are never returned in JSON bodies or stored in `localStorage`.
- **Session Fixation Protection**: `_issue_session` deletes any prior `panchayat_sid` presented during login/bootstrap before issuing a fresh token and CSRF secret.
- **Session Rotation on Credential Changes**:
  - `POST /api/staff/account/change-password` revokes all other active sessions for that user.
  - `POST /api/staff/users/{id}/reset-password` and account suspension revoke all active sessions for the target account.
- **Expiration**: 8-hour absolute TTL (`SESSION_TTL_SECONDS`) and 30-minute idle timeout (`SESSION_IDLE_SECONDS`).
- **Spoofing Rejection**: Presenting `X-Staff-Id` or `Authorization: Bearer` without a valid `panchayat_sid` cookie returns `401 Unauthorized` and writes a `HIGH` `SPOOFED_AUTH_HEADER` alert.

## 2. CSRF & Cross-Origin Defense
- All authenticated `POST`, `PUT`, `PATCH`, and `DELETE` endpoints require `X-CSRF-Token` matching the session's bound `csrf_token_hash` (`hmac.compare_digest`), returning `403 Forbidden` on missing/invalid tokens.
- Mutating requests validate `Origin` against `PANCHAYAT_ALLOWED_ORIGINS` or the same-origin `Host` / `X-Forwarded-Host` header.

## 3. Password & Secret Management
- Staff passcodes are hashed with `hashlib.scrypt` (`n=16384, r=8, p=1, dklen=32`) and a unique 16-byte CSPRNG salt per user (`security_utils.py`).
- Passcode complexity requires 8–128 characters combining at least two character classes (letters, digits, symbols).
- Production mode (`APP_ENV=production`) fails fast on startup if `PANCHAYAT_SESSION_SECRET` is absent, shorter than 32 characters, or matches weak marker patterns.
- Development mode persists a 48-byte CSPRNG secret to `backend/data/.session_secret` with `0o600` file permissions.

## 4. Role-Based Access Control (RBAC) & Data Isolation
- **Deny-by-Default**: `backend/app/policies/rbac.py` enforces role, active status, ward jurisdiction (1–15), department match, and granular permission flags (`canApproveCertificates`, `canAssignTickets`, `canManageUsers`, `canDeleteRecords`, `canVerifyDocuments`).
- **Field-Level Masking**: Ward Officers see masked citizen mobile numbers (`******1234`); public tracking requires Tracking ID + high-entropy `TK-*` token (`hmac.compare_digest`) + mobile last 4 digits and returns masked citizen display names without internal remarks.
- **Strict Response DTOs**: `staff_self_dto`, `staff_directory_min_dto`, `public_grievance_summary_dto`, `citizen_tracked_grievance_dto`, `staff_grievance_dto`, and `staff_service_dto` strip `passcode_hash`, `tracking_token_hash`, and `csrf_token_hash`.

## 5. Input Validation, Abuse Protection & HTTP Headers
- Strict key allowlists (`ensure_allowed_keys`) reject unexpected shadow fields.
- Control character stripping (`normalize_text`), strict enums, filename traversal checks (`/` `\` `..`), `data:image/*` / local asset validation (`validate_photo_url`), SSRF URL guard (`is_safe_external_https_url`), and a 2 MB `Content-Length` cap (`413 Payload Too Large`).
- Sliding-window per-IP rate limiting (`429 Too Many Requests` + `Retry-After`), exponential login failure delay, and 5-failure / 15-minute account lockout (`423 Locked` + `CRITICAL` `ACCOUNT_LOCKED` alert).
- Response headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Strict-Transport-Security`, `Cache-Control: no-store`, and `X-Request-ID`.

## 6. Immutable Audit Trail & Cloud Rules
- SQLite enforces `BEFORE UPDATE` and `BEFORE DELETE` `RAISE(ABORT, ...)` triggers on both `audit_logs` and `security_alerts`, mirrored to `backend/data/audit_log.jsonl`.
- Firestore (`firestore.rules`) enforces default-deny, `email_verified == true`, strict schema validation, terminal-state locks, and immutable audit/alert collections (`npx eslint firestore.rules` clean, deployed via `DeployRules`).
