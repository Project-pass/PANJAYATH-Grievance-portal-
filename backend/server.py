from __future__ import annotations

import argparse
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import parse_qs, urlparse
import uuid

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.api.openapi import build_openapi_spec  # noqa: E402
from app.core.config import load_or_create_session_secret, load_settings  # noqa: E402
from app.core.exceptions import (  # noqa: E402
    AppError,
    AuthenticationError,
    AuthorizationError,
    LockedAccountError,
    NotFoundError,
    PayloadTooLargeError,
    RateLimitError,
    ValidationError,
)
from app.core.logging import get_logger, get_request_id, set_request_id  # noqa: E402
from app.policies.rbac import (  # noqa: E402
    CLOSED_OR_DONE_GRIEVANCE_STATUSES,
    evaluate_rbac,
    normalize_grievance_status,
    validate_grievance_transition,
)
from app.services.audit import (  # noqa: E402
    export_audit_logs_csv,
    export_audit_logs_json,
    get_audit_retention_summary,
    query_audit_logs,
)
from app.services.sla import compute_sla_metrics  # noqa: E402
from app.services.workflow import (  # noqa: E402
    calculate_hold_transition_fields,
    escalate_overdue_grievances,
    find_potential_duplicate_grievances,
    load_category_sla_policies,
    load_holidays,
    record_assignment,
    record_notification,
    record_status_history,
    resolve_sla_days_for_ticket,
)
from c_engine.build import CEngineError, default_binary_path, ensure_c_engine_ready, verify_c_engine  # noqa: E402
from db import (  # noqa: E402
    SQLITE_PATH,
    append_audit_event,
    append_security_alert,
    get_connection,
    init_db,
    now_iso,
    reset_database_with_audit,
    transaction,
)
from security_utils import (  # noqa: E402
    SlidingWindowRateLimiter,
    ensure_allowed_keys,
    generate_opaque_token,
    generate_tracking_token,
    generate_uuid_v4,
    get_session_secret_bytes,
    hash_ip,
    hash_passcode,
    hash_token,
    mask_mobile,
    mask_name,
    normalize_text,
    validate_grievance_create,
    validate_grievance_patch,
    validate_passcode_strength,
    validate_service_create,
    validate_service_patch,
    validate_staff_payload,
    validate_tracking_query,
    verify_passcode,
)
from seed_data import CATEGORY_DEPARTMENT_MAP, DEFAULT_ROLE_PERMISSIONS, SERVICE_CATALOG  # noqa: E402

LOGGER = get_logger("panchayat.api")
SETTINGS = load_settings()
C_ENGINE_BIN = default_binary_path()
REFERENCE_MIN_NOW = datetime(2026, 11, 23, 23, 59, 0, tzinfo=timezone.utc).timestamp()

MAX_BODY_BYTES = SETTINGS.max_body_bytes
SESSION_TTL_SECONDS = SETTINGS.session_ttl_seconds
SESSION_IDLE_SECONDS = SETTINGS.session_idle_seconds
LOCKOUT_THRESHOLD = SETTINGS.lockout_threshold
LOCKOUT_DURATION_SECONDS = SETTINGS.lockout_duration_seconds
COOKIE_NAME = "panchayat_sid"
CSRF_COOKIE_NAME = "panchayat_csrf"

CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data: https:; "
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'self' https://aistudio.google.com https://*.googleusercontent.com"
)

RATE_LIMITER = SlidingWindowRateLimiter()


def effective_now_ts() -> float:
    return max(time.time(), REFERENCE_MIN_NOW)


def effective_now_dt() -> datetime:
    return datetime.fromtimestamp(effective_now_ts(), tz=timezone.utc)


def is_production_env() -> bool:
    return (
        os.environ.get("APP_ENV", "").strip().lower() == "production"
        or os.environ.get("NODE_ENV", "").strip().lower() == "production"
    )


def compute_grievance_sla(row, base_sla_limit: int, holidays: set[str]) -> dict:
    keys = row.keys() if hasattr(row, "keys") else ()
    limit_days = int(row["sla_limit_days"]) if "sla_limit_days" in keys and row["sla_limit_days"] else int(base_sla_limit)
    paused_sec = int(row["paused_seconds"]) if "paused_seconds" in keys and row["paused_seconds"] else 0
    hold_started = row["hold_started_at"] if "hold_started_at" in keys else None
    c_bin = C_ENGINE_BIN if C_ENGINE_BIN.exists() and os.access(C_ENGINE_BIN, os.X_OK) else None
    return compute_sla_metrics(
        row["created_at"],
        row["status"],
        limit_days,
        now_dt=effective_now_dt(),
        resolved_at_iso=row["resolved_at"],
        paused_seconds=paused_sec,
        hold_started_at_iso=hold_started,
        holidays=holidays,
        c_engine_bin=c_bin,
    )


def compute_service_sla(row, sla_limit_days: int) -> dict:
    is_closed = row["status"] in ("Approved", "Rejected")
    c_bin = C_ENGINE_BIN if C_ENGINE_BIN.exists() and os.access(C_ENGINE_BIN, os.X_OK) else None
    return compute_sla_metrics(
        row["created_at"],
        "RESOLVED" if is_closed else "IN_PROGRESS",
        sla_limit_days,
        now_dt=effective_now_dt(),
        resolved_at_iso=row["updated_at"] if is_closed else None,
        c_engine_bin=c_bin,
    )


def row_to_staff_dict(row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "externalUuid": row["external_uuid"] if "external_uuid" in keys else None,
        "name": row["name"],
        "username": row["username"] if "username" in keys else None,
        "email": row["email"],
        "designation": row["designation"],
        "role": row["role"],
        "department": row["department"],
        "assignedWards": json.loads(row["assigned_wards_json"]),
        "isActive": bool(row["is_active"]),
        "permissions": json.loads(row["permissions_json"]),
        "isClaimed": bool(row["is_claimed"]),
    }


def check_rbac(staff_member: dict | None, target_ward: int, same_dept: bool, action: str) -> dict:
    dec = evaluate_rbac(staff_member, target_ward, same_dept, action)
    return {"allowed": dec.allowed, "reason": dec.reason}


# --- Strict Response DTOs (never leak passcode hashes, raw tokens, or unauthorized PII) ---

def staff_self_dto(staff: dict) -> dict:
    return {
        "id": staff["id"],
        "externalUuid": staff.get("externalUuid"),
        "name": staff["name"],
        "username": staff.get("username"),
        "email": staff["email"],
        "designation": staff["designation"],
        "role": staff["role"],
        "department": staff["department"],
        "assignedWards": staff["assignedWards"],
        "isActive": staff["isActive"],
        "permissions": staff["permissions"],
    }


def staff_directory_min_dto(staff: dict) -> dict:
    return {
        "id": staff["id"],
        "name": staff["name"],
        "designation": staff["designation"],
        "role": staff["role"],
        "department": staff["department"],
        "isActive": staff["isActive"],
    }


def public_grievance_summary_dto(row, sla_limit: int, holidays: set[str]) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "externalUuid": row["external_uuid"] if "external_uuid" in keys else None,
        "ward": row["ward"],
        "category": row["category"],
        "department": row["department"],
        "priority": row["priority"] if "priority" in keys else "NORMAL",
        "status": normalize_grievance_status(row["status"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "sla": compute_grievance_sla(row, sla_limit, holidays),
    }


def citizen_tracked_grievance_dto(row, sla_limit: int, holidays: set[str]) -> dict:
    keys = row.keys()
    return {
        "kind": "grievance",
        "id": row["id"],
        "externalUuid": row["external_uuid"] if "external_uuid" in keys else None,
        "citizenDisplay": mask_name(row["citizen_name"]),
        "ward": row["ward"],
        "category": row["category"],
        "department": row["department"],
        "priority": row["priority"] if "priority" in keys else "NORMAL",
        "slaLimitDays": int(row["sla_limit_days"]) if "sla_limit_days" in keys else sla_limit,
        "escalationLevel": int(row["escalation_level"]) if "escalation_level" in keys else 0,
        "landmark": row["landmark"],
        "description": row["description"],
        "status": normalize_grievance_status(row["status"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "resolvedAt": row["resolved_at"],
        "assignedOfficerName": row["assigned_officer_name"],
        "publicRemark": row["public_remark"],
        "beforePhotoUrl": row["before_photo_url"],
        "afterPhotoUrl": row["after_photo_url"],
        "rating": row["rating"],
        "feedbackComment": row["feedback_comment"],
        "timeline": json.loads(row["timeline_json"]),
        "sla": compute_grievance_sla(row, sla_limit, holidays),
    }


def citizen_tracked_service_dto(row, sla_limit: int) -> dict:
    keys = row.keys()
    return {
        "kind": "service",
        "id": row["id"],
        "externalUuid": row["external_uuid"] if "external_uuid" in keys else None,
        "serviceId": row["service_id"],
        "serviceName": row["service_name"],
        "applicantDisplay": mask_name(row["applicant_name"]),
        "ward": row["ward"],
        "department": row["department"],
        "feeInr": row["fee_inr"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "assignedOfficerName": row["assigned_officer_name"],
        "officialRemark": row["official_remark"],
        "checkedDocs": json.loads(row["checked_docs_json"]),
        "timeline": json.loads(row["timeline_json"]),
        "sla": compute_service_sla(row, sla_limit),
    }


def staff_grievance_dto(row, sla_limit: int, actor: dict, holidays: set[str], comments: list[dict] | None = None) -> dict:
    keys = row.keys()
    show_full_contact = actor["role"] in ("SUPER_ADMIN", "CSC_OPERATOR")
    return {
        "id": row["id"],
        "externalUuid": row["external_uuid"] if "external_uuid" in keys else None,
        "citizenName": row["citizen_name"],
        "mobile": row["mobile"] if show_full_contact else mask_mobile(row["mobile"]),
        "ward": row["ward"],
        "category": row["category"],
        "department": row["department"],
        "priority": row["priority"] if "priority" in keys else "NORMAL",
        "slaLimitDays": int(row["sla_limit_days"]) if "sla_limit_days" in keys else sla_limit,
        "escalationLevel": int(row["escalation_level"]) if "escalation_level" in keys else 0,
        "landmark": row["landmark"],
        "description": row["description"],
        "status": normalize_grievance_status(row["status"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "resolvedAt": row["resolved_at"],
        "assignedOfficerId": row["assigned_officer_id"],
        "assignedOfficerName": row["assigned_officer_name"],
        "filedByRole": row["filed_by_role"],
        "beforePhotoUrl": row["before_photo_url"],
        "afterPhotoUrl": row["after_photo_url"],
        "publicRemark": row["public_remark"],
        "internalRemark": row["internal_remark"],
        "rating": row["rating"],
        "feedbackComment": row["feedback_comment"],
        "timeline": json.loads(row["timeline_json"]),
        "comments": comments or [],
        "sla": compute_grievance_sla(row, sla_limit, holidays),
    }


def staff_service_dto(row, sla_limit: int, actor: dict) -> dict:
    keys = row.keys()
    show_full_contact = actor["role"] in ("SUPER_ADMIN", "CSC_OPERATOR")
    return {
        "id": row["id"],
        "externalUuid": row["external_uuid"] if "external_uuid" in keys else None,
        "serviceId": row["service_id"],
        "serviceName": row["service_name"],
        "applicantName": row["applicant_name"],
        "mobile": row["mobile"] if show_full_contact else mask_mobile(row["mobile"]),
        "ward": row["ward"],
        "address": row["address"],
        "department": row["department"],
        "feeInr": row["fee_inr"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "checkedDocs": json.loads(row["checked_docs_json"]),
        "uploadedDocNames": json.loads(row["uploaded_doc_names_json"]),
        "assignedOfficerId": row["assigned_officer_id"],
        "assignedOfficerName": row["assigned_officer_name"],
        "filedByRole": row["filed_by_role"],
        "officialRemark": row["official_remark"],
        "timeline": json.loads(row["timeline_json"]),
        "sla": compute_service_sla(row, sla_limit),
    }


def normalize_api_path(raw_path: str) -> str:
    if raw_path == "/api/v1":
        return "/api"
    if raw_path.startswith("/api/v1/"):
        return "/api/" + raw_path[len("/api/v1/"):]
    return raw_path


class PanchayatApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _begin_request(self) -> tuple[str, float]:
        hdr_rid = (self.headers.get("X-Request-ID") or "").strip()[:32]
        rid = set_request_id(hdr_rid or None)
        return rid, time.monotonic()

    def _finish_log(self, method: str, path: str, status_code: int, started: float):
        dur_ms = round((time.monotonic() - started) * 1000.0, 2)
        LOGGER.info(
            "http_request",
            extra={
                "structured_data": {
                    "method": method,
                    "path": path,
                    "status": status_code,
                    "durationMs": dur_ms,
                }
            },
        )

    def _client_ip(self) -> str:
        fwd = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        return fwd or (self.client_address[0] if self.client_address else "127.0.0.1")

    def _same_origin_header(self) -> str | None:
        origin = self.headers.get("Origin", "").strip()
        if not origin:
            return None
        if SETTINGS.allowed_origins and origin.lower() in SETTINGS.allowed_origins:
            return origin
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").strip()
        try:
            parsed = urlparse(origin)
            if parsed.netloc and host and parsed.netloc.lower() == host.lower():
                return origin
        except Exception:
            return None
        return None

    def _check_origin(self) -> bool:
        origin = self.headers.get("Origin", "").strip()
        if origin and not self._same_origin_header():
            return False
        return True

    def _send_security_headers(self):
        self.send_header("X-Request-ID", get_request_id())
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", CSP_POLICY)
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        self.send_header("Cache-Control", "no-store")
        allowed_origin = self._same_origin_header()
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Credentials", "true")

    def _send_json(self, status_code: int, payload: dict, extra_headers: list[tuple[str, str]] | None = None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_security_headers()
        if extra_headers:
            for k, v in extra_headers:
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_text(
        self,
        status_code: int,
        text_body: str,
        content_type: str = "text/plain; charset=utf-8",
        extra_headers: list[tuple[str, str]] | None = None,
    ):
        raw = text_body.encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self._send_security_headers()
        if extra_headers:
            for k, v in extra_headers:
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def _send_app_error(self, err: AppError):
        extra = []
        if isinstance(err, (RateLimitError, LockedAccountError)):
            extra.append(("Retry-After", str(err.retry_after)))
        self._send_json(
            err.status_code,
            {
                "ok": False,
                "error": err.message,
                "errorCode": err.error_code,
                "requestId": get_request_id(),
            },
            extra or None,
        )

    def _read_json(self) -> dict:
        raw_len = self.headers.get("Content-Length", "0").strip()
        try:
            length = int(raw_len)
        except ValueError:
            raise ValidationError("Invalid Content-Length header.")
        if length < 0 or length > MAX_BODY_BYTES:
            raise PayloadTooLargeError("Request payload exceeds maximum allowed size (2MB).")
        if length == 0:
            return {}
        try:
            raw = self.rfile.read(length).decode("utf-8")
            parsed = json.loads(raw)
        except Exception:
            raise ValidationError("Malformed JSON payload.")
        if not isinstance(parsed, dict):
            raise ValidationError("JSON payload must be an object.")
        return parsed

    def _extract_cookie_token(self) -> str | None:
        cookie_hdr = self.headers.get("Cookie", "")
        if not cookie_hdr:
            return None
        c = SimpleCookie()
        try:
            c.load(cookie_hdr)
            if COOKIE_NAME in c and c[COOKIE_NAME].value:
                return c[COOKIE_NAME].value.strip()
        except Exception:
            return None
        return None

    def _authenticate(self, conn) -> tuple[dict | None, str, str | None, str | None]:
        """Authenticate strictly via HttpOnly panchayat_sid cookie."""
        spoof_hdr = self.headers.get("X-Staff-Id", "").strip()
        auth_hdr = self.headers.get("Authorization", "").strip()
        token = self._extract_cookie_token()
        if (spoof_hdr or auth_hdr) and not token:
            return None, "spoof_or_bearer_rejected", None, None
        if not token:
            return None, "none", None, None

        tok_hash = hash_token(token)
        now = time.time()
        row = conn.execute(
            """
            SELECT s.token_hash, s.csrf_token_hash, s.expires_at, s.last_seen_at, s.token_prefix,
                   st.id, st.external_uuid, st.name, st.username, st.email, st.designation, st.role,
                   st.department, st.assigned_wards_json, st.is_active, st.permissions_json, st.is_claimed
            FROM sessions s
            JOIN staff st ON s.staff_id = st.id
            WHERE s.token_hash = ?
            """,
            (tok_hash,),
        ).fetchone()
        if not row:
            return None, "invalid", None, None
        if now > row["expires_at"] or (now - row["last_seen_at"]) > SESSION_IDLE_SECONDS:
            with transaction(conn):
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (tok_hash,))
            return None, "expired", None, None
        if not row["is_active"]:
            return None, "inactive", None, None

        with transaction(conn):
            conn.execute("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (now, tok_hash))
        return row_to_staff_dict(row), row["token_prefix"], row["csrf_token_hash"], tok_hash

    def _verify_csrf_for_session(self, expected_csrf_hash: str | None) -> None:
        provided = (self.headers.get("X-CSRF-Token") or "").strip()
        if not provided or not expected_csrf_hash:
            raise AuthorizationError("Missing CSRF verification token.")
        if not hmac.compare_digest(hash_token(provided), expected_csrf_hash):
            raise AuthorizationError("Invalid CSRF verification token.")

    def _bootstrap_required(self, conn) -> bool:
        env_sec = os.environ.get("PANCHAYAT_SECRETARY_PASSCODE", "").strip()
        if env_sec:
            return False
        claimed = conn.execute("SELECT COUNT(*) AS c FROM staff WHERE is_claimed = 1").fetchone()["c"]
        return claimed == 0

    def _cookie_headers(self, session_token: str, csrf_token: str = "", clear: bool = False) -> list[tuple[str, str]]:
        if clear:
            return [
                ("Set-Cookie", f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned"),
                ("Set-Cookie", f"{CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; SameSite=None; Partitioned"),
            ]
        return [
            (
                "Set-Cookie",
                f"{COOKIE_NAME}={session_token}; Path=/; Max-Age={SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned",
            ),
            (
                "Set-Cookie",
                f"{CSRF_COOKIE_NAME}={csrf_token}; Path=/; Max-Age={SESSION_TTL_SECONDS}; Secure; SameSite=None; Partitioned",
            ),
        ]

    def _issue_session(self, conn, staff_row, ip_h: str) -> tuple[str, str, str]:
        # Invalidate any prior session cookie presented on the request to prevent session fixation
        prev_tok = self._extract_cookie_token()
        if prev_tok:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(prev_tok),))

        raw_tok = generate_opaque_token(32)
        csrf_tok = generate_opaque_token(24)
        tok_hash = hash_token(raw_tok)
        csrf_hash = hash_token(csrf_tok)
        tok_prefix = raw_tok[:8]
        now = time.time()
        conn.execute(
            """
            INSERT INTO sessions(token_hash, csrf_token_hash, staff_id, role, created_at, expires_at, last_seen_at, ip_hash, token_prefix)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (tok_hash, csrf_hash, staff_row["id"], staff_row["role"], now, now + SESSION_TTL_SECONDS, now, ip_h, tok_prefix),
        )
        return raw_tok, csrf_tok, tok_prefix

    def _rate_limit_or_raise(self, bucket: str, max_req: int, window_sec: int, conn):
        ip_h = hash_ip(self._client_ip())
        ok, retry = RATE_LIMITER.check(f"{ip_h}:{bucket}", max_req, window_sec)
        if not ok:
            with transaction(conn):
                append_security_alert(
                    conn,
                    "MEDIUM",
                    "RATE_LIMIT_EXCEEDED",
                    bucket,
                    ip_h,
                    f"Rate limit triggered on {bucket}.",
                )
            raise RateLimitError("Too many requests. Please wait before trying again.", retry_after=retry)

    def _get_sla_limit(self, conn) -> int:
        row = conn.execute("SELECT value FROM config WHERE key = 'slaLimitDays'").fetchone()
        return int(row["value"]) if row else 7

    def do_OPTIONS(self):
        origin = self._same_origin_header()
        self.send_response(204 if origin else 403)
        self._send_security_headers()
        if origin:
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Requested-With")
        self.end_headers()

    def do_GET(self):
        _, started = self._begin_request()
        parsed_url = urlparse(self.path)
        path = normalize_api_path(parsed_url.path)
        qs = parse_qs(parsed_url.query)
        conn = get_connection(SQLITE_PATH)
        status_out = 200
        try:
            if path == "/api/health":
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "status": "healthy",
                        "backend": "Python 3 + SQLite WAL (PostgreSQL Schema Ready)",
                        "cEngineCompiled": C_ENGINE_BIN.exists() and os.access(C_ENGINE_BIN, os.X_OK),
                    },
                )
                return

            if path == "/api/ready":
                checks = {"database": False, "cEngine": False, "sessionSecret": False}
                try:
                    conn.execute("SELECT 1").fetchone()
                    checks["database"] = True
                except Exception:
                    checks["database"] = False
                try:
                    verify_c_engine(C_ENGINE_BIN)
                    checks["cEngine"] = True
                except CEngineError:
                    checks["cEngine"] = False
                try:
                    checks["sessionSecret"] = len(get_session_secret_bytes()) >= 32
                except Exception:
                    checks["sessionSecret"] = False
                ready = all(checks.values())
                status_out = 200 if ready else 503
                self._send_json(status_out, {"ok": ready, "status": "ready" if ready else "degraded", "checks": checks})
                return

            if path in ("/api/docs", "/api/openapi.json"):
                self._send_json(200, build_openapi_spec())
                return

            if path == "/api/auth/status":
                actor, _prefix, csrf_hash, _th = self._authenticate(conn)
                csrf_fresh = None
                extra_hdrs = None
                if actor and csrf_hash:
                    # Issue a refreshed CSRF cookie only when absent or return status cleanly without exposing session token
                    pass
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "bootstrapRequired": self._bootstrap_required(conn),
                        "authenticated": actor is not None,
                        "user": staff_self_dto(actor) if actor else None,
                        "envPasscodeConfigured": bool(os.environ.get("PANCHAYAT_SECRETARY_PASSCODE", "").strip()),
                    },
                    extra_hdrs,
                )
                return

            if path == "/api/public/overview":
                self._rate_limit_or_raise("public_overview", 60, 60, conn)
                sla_limit = self._get_sla_limit(conn)
                holidays = load_holidays(conn)
                cat_policies = load_category_sla_policies(conn)
                g_rows = conn.execute("SELECT * FROM grievances ORDER BY created_at DESC").fetchall()
                resolved = [r for r in g_rows if normalize_grievance_status(r["status"]) in ("RESOLVED", "CLOSED")]
                total_days = 0.0
                for r in resolved:
                    if r["resolved_at"]:
                        dt1 = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
                        dt2 = datetime.fromisoformat(r["resolved_at"].replace("Z", "+00:00"))
                        total_days += max(0.5, (dt2.timestamp() - dt1.timestamp()) / 86400.0)
                avg_days = round(total_days / len(resolved), 1) if resolved else 0.0
                rated = [r["rating"] for r in g_rows if r["rating"] is not None]
                avg_rating = round(sum(rated) / len(rated), 1) if rated else 0.0

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "slaLimitDays": sla_limit,
                        "categorySlaDays": cat_policies,
                        "stats": {
                            "resolvedCount": len(resolved),
                            "totalCount": len(g_rows),
                            "avgDays": f"{avg_days:.1f}",
                            "activeServicesCount": len(SERVICE_CATALOG),
                            "avgRating": f"{avg_rating:.1f}",
                            "ratingCount": len(rated),
                        },
                        "recentWorks": [public_grievance_summary_dto(r, sla_limit, holidays) for r in g_rows[:6]],
                        "serviceCatalog": SERVICE_CATALOG,
                    },
                )
                return

            if path == "/api/staff/dashboard":
                actor, sess_prefix, _csrf, _th = self._authenticate(conn)
                if not actor:
                    if sess_prefix == "spoof_or_bearer_rejected":
                        with transaction(conn):
                            append_security_alert(
                                conn,
                                "HIGH",
                                "SPOOFED_AUTH_HEADER",
                                "HeaderAuth",
                                hash_ip(self._client_ip()),
                                "Rejected unauthenticated request attempting header-based spoofing.",
                            )
                    raise AuthenticationError("Authentication required.")

                sla_limit = self._get_sla_limit(conn)
                holidays = load_holidays(conn)
                g_rows = conn.execute("SELECT * FROM grievances ORDER BY created_at DESC").fetchall()
                s_rows = conn.execute("SELECT * FROM services ORDER BY created_at DESC").fetchall()
                comments_rows = conn.execute("SELECT * FROM grievance_comments ORDER BY created_at ASC").fetchall()
                comments_map: dict[str, list[dict]] = {}
                for c in comments_rows:
                    comments_map.setdefault(c["grievance_id"], []).append(
                        {
                            "id": c["id"],
                            "authorName": c["author_name"],
                            "isInternal": bool(c["is_internal"]),
                            "body": c["body"],
                            "createdAt": c["created_at"],
                        }
                    )

                visible_grievances = []
                for g in g_rows:
                    same_dept = g["department"] == actor["department"] or g["assigned_officer_id"] == actor["id"]
                    if check_rbac(actor, g["ward"], same_dept, "VIEW")["allowed"]:
                        visible_grievances.append(
                            staff_grievance_dto(g, sla_limit, actor, holidays, comments_map.get(g["id"], []))
                        )

                visible_services = []
                for s in s_rows:
                    same_dept = s["department"] == actor["department"] or s["assigned_officer_id"] == actor["id"]
                    if check_rbac(actor, s["ward"], same_dept, "VIEW")["allowed"]:
                        visible_services.append(staff_service_dto(s, sla_limit, actor))

                all_staff = [row_to_staff_dict(r) for r in conn.execute("SELECT * FROM staff ORDER BY created_at ASC").fetchall()]
                if actor["role"] == "SUPER_ADMIN" and actor["permissions"].get("canManageUsers"):
                    staff_out = [staff_self_dto(st) for st in all_staff]
                else:
                    staff_out = [staff_directory_min_dto(st) for st in all_staff if st["isActive"]]

                audit_page = query_audit_logs(conn, actor, page=1, page_size=200)
                if actor["role"] == "SUPER_ADMIN":
                    alert_rows = conn.execute("SELECT * FROM security_alerts ORDER BY timestamp DESC LIMIT 100").fetchall()
                    notif_rows = conn.execute("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50").fetchall()
                    retention = get_audit_retention_summary(conn)
                else:
                    alert_rows = []
                    notif_rows = conn.execute(
                        "SELECT * FROM notifications WHERE recipient_ref = ? ORDER BY created_at DESC LIMIT 30",
                        (actor["id"],),
                    ).fetchall()
                    retention = None

                alerts_out = [
                    {
                        "id": al["id"],
                        "timestamp": al["timestamp"],
                        "severity": al["severity"],
                        "eventType": al["event_type"],
                        "actorHint": al["actor_hint"],
                        "details": al["details"],
                    }
                    for al in alert_rows
                ]
                notifs_out = [
                    {
                        "id": n["id"],
                        "targetId": n["target_id"],
                        "message": n["message"],
                        "status": n["status"],
                        "createdAt": n["created_at"],
                    }
                    for n in notif_rows
                ]

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "user": staff_self_dto(actor),
                        "slaLimitDays": sla_limit,
                        "grievances": visible_grievances,
                        "services": visible_services,
                        "staff": staff_out,
                        "auditLogs": audit_page["items"],
                        "securityAlerts": alerts_out,
                        "notifications": notifs_out,
                        "auditRetention": retention,
                    },
                )
                return

            if path == "/api/staff/grievances":
                actor, _, _, _ = self._authenticate(conn)
                if not actor:
                    raise AuthenticationError("Authentication required.")
                sla_limit = self._get_sla_limit(conn)
                holidays = load_holidays(conn)

                status_f = normalize_grievance_status(qs.get("status", [""])[0]) if qs.get("status") else ""
                ward_f = qs.get("ward", [""])[0]
                cat_f = qs.get("category", [""])[0]
                prio_f = qs.get("priority", [""])[0].upper()
                search_f = qs.get("q", [""])[0].strip().lower()
                overdue_only = qs.get("overdueOnly", ["false"])[0].lower() == "true"
                page = max(1, int(qs.get("page", ["1"])[0] or 1))
                page_size = max(1, min(100, int(qs.get("pageSize", ["25"])[0] or 25)))

                rows = conn.execute("SELECT * FROM grievances ORDER BY created_at DESC").fetchall()
                filtered = []
                for g in rows:
                    same_dept = g["department"] == actor["department"] or g["assigned_officer_id"] == actor["id"]
                    if not check_rbac(actor, g["ward"], same_dept, "VIEW")["allowed"]:
                        continue
                    dto = staff_grievance_dto(g, sla_limit, actor, holidays)
                    if status_f and dto["status"] != status_f:
                        continue
                    if ward_f and str(dto["ward"]) != str(ward_f):
                        continue
                    if cat_f and dto["category"] != cat_f:
                        continue
                    if prio_f and dto["priority"] != prio_f:
                        continue
                    if overdue_only and not dto["sla"]["isBreached"]:
                        continue
                    if search_f and search_f not in f"{dto['id']} {dto['citizenName']} {dto['landmark']} {dto['description']}".lower():
                        continue
                    filtered.append(dto)

                total = len(filtered)
                start = (page - 1) * page_size
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "items": filtered[start : start + page_size],
                        "total": total,
                        "page": page,
                        "pageSize": page_size,
                        "totalPages": max(1, (total + page_size - 1) // page_size),
                    },
                )
                return

            if path == "/api/staff/audit":
                actor, _, _, _ = self._authenticate(conn)
                if not actor:
                    raise AuthenticationError("Authentication required.")
                res = query_audit_logs(
                    conn,
                    actor,
                    search=qs.get("q", [""])[0],
                    action=qs.get("action", [""])[0],
                    outcome=qs.get("outcome", [""])[0],
                    page=int(qs.get("page", ["1"])[0] or 1),
                    page_size=int(qs.get("pageSize", ["50"])[0] or 50),
                )
                self._send_json(200, {"ok": True, **res})
                return

            if path == "/api/staff/audit/export":
                actor, sess_prefix, _, _ = self._authenticate(conn)
                if not actor:
                    raise AuthenticationError("Authentication required.")
                rbac = check_rbac(actor, 1, True, "EXPORT_AUDIT")
                if not rbac["allowed"]:
                    raise AuthorizationError(rbac["reason"])
                fmt = (qs.get("format", ["csv"])[0] or "csv").lower()
                ip_h = hash_ip(self._client_ip())
                with transaction(conn):
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "AUDIT_LOG_EXPORTED",
                        "AUDIT_LOGS",
                        "SUCCESS",
                        f"Audit logs exported in {fmt.upper()} format by {actor['name']}.",
                    )
                if fmt == "json":
                    self._send_text(
                        200,
                        export_audit_logs_json(conn),
                        "application/json; charset=utf-8",
                        [("Content-Disposition", 'attachment; filename="panchayat_audit_logs.json"')],
                    )
                else:
                    self._send_text(
                        200,
                        export_audit_logs_csv(conn),
                        "text/csv; charset=utf-8",
                        [("Content-Disposition", 'attachment; filename="panchayat_audit_logs.csv"')],
                    )
                return

            raise NotFoundError("Endpoint not found.")
        except AppError as ae:
            status_out = ae.status_code
            self._send_app_error(ae)
        except Exception as exc:
            status_out = 500
            LOGGER.error("unhandled_get_error", extra={"structured_data": {"error": str(exc), "path": path}})
            self._send_json(500, {"ok": False, "error": "Internal server error.", "requestId": get_request_id()})
        finally:
            conn.close()
            self._finish_log("GET", path, status_out, started)

    def do_POST(self):
        _, started = self._begin_request()
        path = normalize_api_path(urlparse(self.path).path)
        conn = get_connection(SQLITE_PATH)
        ip_h = hash_ip(self._client_ip())
        status_out = 200
        try:
            if not self._check_origin():
                raise AuthorizationError("Cross-origin state change rejected.")

            body = self._read_json()

            # --- Auth: One-Time First-Run Bootstrap Claim ---
            if path == "/api/auth/bootstrap-claim":
                self._rate_limit_or_raise("auth_bootstrap", 10, 60, conn)
                try:
                    ensure_allowed_keys(body, {"passcode"}, {"passcode"})
                    passcode = str(body["passcode"])
                    ok, err = validate_passcode_strength(passcode)
                    if not ok:
                        raise ValidationError(err)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                new_hash = hash_passcode(passcode)
                with transaction(conn):
                    if not self._bootstrap_required(conn):
                        raise AuthorizationError("Initial Secretary setup has already been claimed.")
                    sec = conn.execute("SELECT * FROM staff WHERE id = 'stf-secretary'").fetchone()
                    if not sec:
                        raise AppError("Secretary profile missing.", 500, "CONFIG_ERROR")
                    conn.execute(
                        "UPDATE staff SET passcode_hash = ?, is_claimed = 1, updated_at = ? WHERE id = 'stf-secretary'",
                        (new_hash, now_iso()),
                    )
                    raw_tok, csrf_tok, tok_prefix = self._issue_session(conn, sec, ip_h)
                    append_audit_event(
                        conn,
                        sec["id"],
                        sec["name"],
                        sec["role"],
                        tok_prefix,
                        ip_h,
                        "ADMIN_BOOTSTRAP_CLAIMED",
                        sec["id"],
                        "SUCCESS",
                        "First-run Panchayat Secretary credentials claimed and hashed with scrypt.",
                    )
                    sec_dict = row_to_staff_dict(
                        conn.execute("SELECT * FROM staff WHERE id = 'stf-secretary'").fetchone()
                    )

                self._send_json(
                    200,
                    {"ok": True, "csrfToken": csrf_tok, "user": staff_self_dto(sec_dict)},
                    self._cookie_headers(raw_tok, csrf_tok),
                )
                return

            # --- Auth: Staff Login ---
            if path == "/api/auth/login":
                self._rate_limit_or_raise("auth_login", 10, 60, conn)
                try:
                    ensure_allowed_keys(body, {"identifier", "email", "passcode"}, {"passcode"})
                    raw_ident = body.get("identifier") if body.get("identifier") is not None else body.get("email")
                    if raw_ident is None or str(raw_ident).strip() == "":
                        raise ValueError("Missing required field: identifier or email.")
                    ident = normalize_text(str(raw_ident), 160, 3, "identifier").lower()
                    passcode = str(body["passcode"])
                    if len(passcode) > 128:
                        raise ValueError("Invalid passcode length.")
                except ValueError as ve:
                    raise ValidationError(str(ve))

                row = conn.execute(
                    "SELECT * FROM staff WHERE lower(email) = ? OR lower(username) = ?",
                    (ident, ident),
                ).fetchone()
                email = row["email"] if row else ident
                now = time.time()
                if row and row["locked_until"] > now:
                    wait_sec = max(1, int(row["locked_until"] - now))
                    with transaction(conn):
                        append_security_alert(
                            conn,
                            "HIGH",
                            "LOCKED_LOGIN_ATTEMPT",
                            email,
                            ip_h,
                            f"Login attempted while account locked ({wait_sec}s remaining).",
                        )
                    raise LockedAccountError(
                        "Account temporarily locked due to repeated failed attempts. Try again later.",
                        retry_after=wait_sec,
                    )

                env_sec_pass = os.environ.get("PANCHAYAT_SECRETARY_PASSCODE", "").strip()
                valid = False
                if row:
                    if row["id"] == "stf-secretary" and env_sec_pass:
                        valid = hmac.compare_digest(passcode, env_sec_pass)
                    elif row["passcode_hash"]:
                        valid = verify_passcode(passcode, row["passcode_hash"])

                if not row or not valid:
                    if row:
                        fails = int(row["failed_attempts"]) + 1
                        locked_until = now + LOCKOUT_DURATION_SECONDS if fails >= LOCKOUT_THRESHOLD else 0
                        with transaction(conn):
                            conn.execute(
                                "UPDATE staff SET failed_attempts = ?, locked_until = ? WHERE id = ?",
                                (fails, locked_until, row["id"]),
                            )
                            append_audit_event(
                                conn,
                                row["id"],
                                row["name"],
                                row["role"],
                                "unauth",
                                ip_h,
                                "STAFF_LOGIN_FAILED",
                                row["id"],
                                "DENIED",
                                f"Failed sign-in attempt #{fails} for {email}.",
                            )
                            if locked_until > 0:
                                append_security_alert(
                                    conn,
                                    "CRITICAL",
                                    "ACCOUNT_LOCKED",
                                    email,
                                    ip_h,
                                    f"Account locked for 15 minutes after {fails} failed login attempts.",
                                )
                            else:
                                append_security_alert(
                                    conn,
                                    "MEDIUM",
                                    "FAILED_LOGIN",
                                    email,
                                    ip_h,
                                    f"Invalid passcode attempt #{fails}.",
                                )
                        time.sleep(min(1.5, 0.2 * (2 ** min(fails - 1, 3))))
                    else:
                        with transaction(conn):
                            append_security_alert(
                                conn,
                                "LOW",
                                "FAILED_LOGIN_UNKNOWN_EMAIL",
                                email,
                                ip_h,
                                "Sign-in attempted with unregistered identifier.",
                            )
                        time.sleep(0.25)
                    raise AuthenticationError("Invalid official credentials.")

                if not row["is_active"]:
                    with transaction(conn):
                        append_audit_event(
                            conn,
                            row["id"],
                            row["name"],
                            row["role"],
                            "unauth",
                            ip_h,
                            "SUSPENDED_LOGIN_BLOCKED",
                            row["id"],
                            "DENIED",
                            f"Suspended staff account {email} blocked from signing in.",
                        )
                    raise AuthorizationError("This staff account is suspended. Contact the Panchayat Secretary.")

                with transaction(conn):
                    conn.execute(
                        "UPDATE staff SET failed_attempts = 0, locked_until = 0 WHERE id = ?",
                        (row["id"],),
                    )
                    raw_tok, csrf_tok, tok_prefix = self._issue_session(conn, row, ip_h)
                    append_audit_event(
                        conn,
                        row["id"],
                        row["name"],
                        row["role"],
                        tok_prefix,
                        ip_h,
                        "STAFF_LOGIN",
                        row["id"],
                        "SUCCESS",
                        f"{row['name']} ({row['designation']}) signed in.",
                    )
                staff_dict = row_to_staff_dict(row)
                self._send_json(
                    200,
                    {"ok": True, "csrfToken": csrf_tok, "user": staff_self_dto(staff_dict)},
                    self._cookie_headers(raw_tok, csrf_tok),
                )
                return

            # --- Auth: Logout ---
            if path == "/api/auth/logout":
                tok = self._extract_cookie_token()
                actor, prefix, csrf_hash, _ = self._authenticate(conn)
                if actor and csrf_hash:
                    self._verify_csrf_for_session(csrf_hash)
                if tok:
                    with transaction(conn):
                        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(tok),))
                        if actor:
                            append_audit_event(
                                conn,
                                actor["id"],
                                actor["name"],
                                actor["role"],
                                prefix,
                                ip_h,
                                "STAFF_LOGOUT",
                                actor["id"],
                                "SUCCESS",
                                f"{actor['name']} signed out.",
                            )
                self._send_json(200, {"ok": True}, self._cookie_headers("", clear=True))
                return

            # --- Public: Track with high-entropy token + mobile last-4 verification ---
            if path == "/api/public/track":
                self._rate_limit_or_raise("public_track", 15, 60, conn)
                try:
                    tid, token, last4 = validate_tracking_query(body)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                sla_limit = self._get_sla_limit(conn)
                holidays = load_holidays(conn)
                tok_h = hash_token(token)
                row_grv = conn.execute(
                    "SELECT * FROM grievances WHERE id = ? OR external_uuid = ?",
                    (tid, tid.lower()),
                ).fetchone()
                if (
                    row_grv
                    and hmac.compare_digest(row_grv["tracking_token_hash"], tok_h)
                    and hmac.compare_digest(row_grv["mobile_last4"], last4)
                ):
                    self._send_json(
                        200,
                        {"ok": True, "record": citizen_tracked_grievance_dto(row_grv, sla_limit, holidays)},
                    )
                    return

                row_srv = conn.execute(
                    "SELECT * FROM services WHERE id = ? OR external_uuid = ?",
                    (tid, tid.lower()),
                ).fetchone()
                if (
                    row_srv
                    and hmac.compare_digest(row_srv["tracking_token_hash"], tok_h)
                    and hmac.compare_digest(row_srv["mobile_last4"], last4)
                ):
                    self._send_json(200, {"ok": True, "record": citizen_tracked_service_dto(row_srv, sla_limit)})
                    return

                with transaction(conn):
                    append_security_alert(
                        conn,
                        "LOW",
                        "TRACKING_VERIFICATION_FAILED",
                        tid,
                        ip_h,
                        f"Failed tracking verification lookup for {tid}.",
                    )
                time.sleep(0.2)
                raise NotFoundError("Record not found or verification credentials invalid.")

            # --- Public: Citizen Grievance Intake ---
            if path == "/api/public/grievances":
                self._rate_limit_or_raise("public_grievance_create", 10, 60, conn)
                try:
                    clean = validate_grievance_create(body)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                raw_tk = generate_tracking_token()
                tk_hash = hash_token(raw_tk)
                ts = now_iso()
                dept = CATEGORY_DEPARTMENT_MAP.get(clean["category"], "General Administration")
                ext_uuid = generate_uuid_v4()

                with transaction(conn):
                    base_sla = self._get_sla_limit(conn)
                    sla_days = resolve_sla_days_for_ticket(conn, clean["category"], clean["priority"], base_sla)
                    duplicates = find_potential_duplicate_grievances(
                        conn, clean["ward"], clean["category"], clean["description"]
                    )
                    ids = [r["id"] for r in conn.execute("SELECT id FROM grievances").fetchall()]
                    nums = [int(x.split("-")[-1]) for x in ids if x.split("-")[-1].isdigit()]
                    next_num = max([108] + nums) + 1
                    ticket_id = f"ABC-GRV-2026-{next_num}"

                    off_rows = conn.execute(
                        "SELECT * FROM staff WHERE is_active = 1 AND role = 'WARD_OFFICER' AND department = ?",
                        (dept,),
                    ).fetchall()
                    auto_off = None
                    for orow in off_rows:
                        if clean["ward"] in json.loads(orow["assigned_wards_json"]):
                            auto_off = row_to_staff_dict(orow)
                            break

                    init_status = "ASSIGNED" if auto_off else "SUBMITTED"
                    timeline = [
                        {
                            "id": f"tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": "Grievance Registered",
                            "actor": f"{clean['citizenName']} (Citizen)",
                            "remark": f"Filed for Ward {clean['ward']} ({clean['category']}, Priority: {clean['priority']}).",
                            "statusLabel": init_status,
                        }
                    ]
                    pub_remark = (
                        f"Auto-routed to {auto_off['name']} ({dept})."
                        if auto_off
                        else "Queued at Panchayat Grievance Desk for officer assignment."
                    )
                    conn.execute(
                        """
                        INSERT INTO grievances(
                            id, external_uuid, citizen_name, mobile, mobile_last4, ward, category, department,
                            priority, sla_limit_days, paused_seconds, hold_started_at, escalated_at,
                            escalation_level, consent_recorded, landmark, description, status,
                            created_at, updated_at, resolved_at, assigned_officer_id, assigned_officer_name,
                            filed_by_role, before_photo_url, after_photo_url, public_remark, internal_remark,
                            rating, feedback_comment, timeline_json, tracking_token_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'CITIZEN', ?, NULL, ?, NULL, NULL, NULL, ?, ?)
                        """,
                        (
                            ticket_id,
                            ext_uuid,
                            clean["citizenName"],
                            clean["mobile"],
                            clean["mobile"][-4:],
                            clean["ward"],
                            clean["category"],
                            dept,
                            clean["priority"],
                            sla_days,
                            1 if clean["consentAccepted"] else 0,
                            clean["landmark"],
                            clean["description"],
                            init_status,
                            ts,
                            ts,
                            auto_off["id"] if auto_off else None,
                            auto_off["name"] if auto_off else None,
                            clean["beforePhotoUrl"],
                            pub_remark,
                            json.dumps(timeline),
                            tk_hash,
                        ),
                    )
                    record_status_history(
                        conn,
                        ticket_id,
                        None,
                        init_status,
                        "citizen",
                        mask_name(clean["citizenName"]),
                        "CITIZEN",
                        pub_remark,
                    )
                    if auto_off:
                        record_assignment(conn, ticket_id, auto_off["id"], auto_off["name"], "system-autorouter")
                        record_notification(
                            conn,
                            "WARD_OFFICER",
                            auto_off["id"],
                            ticket_id,
                            f"New {clean['priority']} grievance {ticket_id} assigned in Ward {clean['ward']}.",
                        )
                    append_audit_event(
                        conn,
                        "citizen",
                        mask_name(clean["citizenName"]),
                        "CITIZEN",
                        "public",
                        ip_h,
                        "GRIEVANCE_SUBMITTED",
                        ticket_id,
                        "SUCCESS",
                        f"Citizen grievance {ticket_id} registered for Ward {clean['ward']} ({clean['category']}).",
                    )
                    created_row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    holidays = load_holidays(conn)

                receipt = citizen_tracked_grievance_dto(created_row, base_sla, holidays)
                receipt["citizenName"] = clean["citizenName"]
                receipt["mobileLast4"] = clean["mobile"][-4:]
                status_out = 201
                self._send_json(
                    201,
                    {
                        "ok": True,
                        "ticket": receipt,
                        "trackingToken": raw_tk,
                        "potentialDuplicates": duplicates,
                    },
                )
                return

            # --- Public: Citizen Feedback ---
            if path.startswith("/api/public/grievances/") and path.endswith("/feedback"):
                self._rate_limit_or_raise("public_feedback", 10, 60, conn)
                parts = path.strip("/").split("/")
                if len(parts) != 5:
                    raise ValidationError("Invalid grievance feedback path.")
                ticket_id = parts[3].upper()
                try:
                    ensure_allowed_keys(
                        body,
                        {"trackingToken", "mobileLast4", "rating", "comment"},
                        {"trackingToken", "mobileLast4", "rating"},
                    )
                    token = normalize_text(body["trackingToken"], 128, 8, "trackingToken")
                    last4 = normalize_text(str(body["mobileLast4"]), 4, 4, "mobileLast4")
                    rating = int(body["rating"])
                    if rating < 1 or rating > 5:
                        raise ValueError("Rating must be between 1 and 5.")
                    comment = normalize_text(body.get("comment") or "", 400, 0, "comment")
                except (ValueError, TypeError) as ve:
                    raise ValidationError(str(ve))

                row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                if (
                    not row
                    or not hmac.compare_digest(row["tracking_token_hash"], hash_token(token))
                    or not hmac.compare_digest(row["mobile_last4"], last4)
                ):
                    raise AuthorizationError("Verification failed for this grievance.")
                if normalize_grievance_status(row["status"]) not in ("RESOLVED", "CLOSED"):
                    raise ValidationError("Feedback can only be submitted once resolved.")

                with transaction(conn):
                    conn.execute(
                        "UPDATE grievances SET rating = ?, feedback_comment = ?, updated_at = ? WHERE id = ?",
                        (rating, comment or None, now_iso(), ticket_id),
                    )
                    append_audit_event(
                        conn,
                        "citizen",
                        "Verified Citizen",
                        "CITIZEN",
                        "public",
                        ip_h,
                        "FEEDBACK_SUBMITTED",
                        ticket_id,
                        "SUCCESS",
                        f"Citizen rated resolution {rating}/5 stars on {ticket_id}.",
                    )
                    updated_row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    sla_limit = self._get_sla_limit(conn)
                    holidays = load_holidays(conn)

                self._send_json(
                    200,
                    {"ok": True, "record": citizen_tracked_grievance_dto(updated_row, sla_limit, holidays)},
                )
                return

            # --- Public: Citizen Reopen Grievance ---
            if path.startswith("/api/public/grievances/") and path.endswith("/reopen"):
                self._rate_limit_or_raise("public_reopen", 10, 60, conn)
                parts = path.strip("/").split("/")
                if len(parts) != 5:
                    raise ValidationError("Invalid grievance reopen path.")
                ticket_id = parts[3].upper()
                try:
                    ensure_allowed_keys(
                        body,
                        {"trackingToken", "mobileLast4", "reason"},
                        {"trackingToken", "mobileLast4", "reason"},
                    )
                    token = normalize_text(body["trackingToken"], 128, 8, "trackingToken")
                    last4 = normalize_text(str(body["mobileLast4"]), 4, 4, "mobileLast4")
                    reason = normalize_text(body["reason"], 500, 5, "reason")
                except (ValueError, TypeError) as ve:
                    raise ValidationError(str(ve))

                row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                if (
                    not row
                    or not hmac.compare_digest(row["tracking_token_hash"], hash_token(token))
                    or not hmac.compare_digest(row["mobile_last4"], last4)
                ):
                    raise AuthorizationError("Verification failed for this grievance.")

                ok_tr, err_tr = validate_grievance_transition("CITIZEN", row["status"], "REOPENED", reason)
                if not ok_tr:
                    raise ValidationError(err_tr)

                ts = now_iso()
                timeline = json.loads(row["timeline_json"])
                timeline.append(
                    {
                        "id": f"tl-reopen-{int(time.time() * 1000)}",
                        "timestamp": ts,
                        "stepTitle": "Reopened by Verified Citizen",
                        "actor": "Verified Citizen",
                        "remark": reason,
                        "statusLabel": "REOPENED",
                    }
                )
                with transaction(conn):
                    conn.execute(
                        "UPDATE grievances SET status = 'REOPENED', public_remark = ?, updated_at = ?, timeline_json = ? WHERE id = ?",
                        (reason, ts, json.dumps(timeline), ticket_id),
                    )
                    record_status_history(
                        conn, ticket_id, row["status"], "REOPENED", "citizen", "Verified Citizen", "CITIZEN", reason
                    )
                    if row["assigned_officer_id"]:
                        record_notification(
                            conn,
                            "WARD_OFFICER",
                            row["assigned_officer_id"],
                            ticket_id,
                            f"Citizen reopened ticket {ticket_id}: {reason}",
                        )
                    append_audit_event(
                        conn,
                        "citizen",
                        "Verified Citizen",
                        "CITIZEN",
                        "public",
                        ip_h,
                        "GRIEVANCE_REOPENED",
                        ticket_id,
                        "SUCCESS",
                        f"Verified citizen reopened {ticket_id}: {reason}",
                    )
                    updated_row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    sla_limit = self._get_sla_limit(conn)
                    holidays = load_holidays(conn)

                self._send_json(
                    200,
                    {"ok": True, "record": citizen_tracked_grievance_dto(updated_row, sla_limit, holidays)},
                )
                return

            # --- Public: Citizen Service Application Intake ---
            if path == "/api/public/services":
                self._rate_limit_or_raise("public_service_create", 10, 60, conn)
                valid_sids = {c["id"] for c in SERVICE_CATALOG}
                try:
                    clean = validate_service_create(body, valid_sids)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                catalog = next(c for c in SERVICE_CATALOG if c["id"] == clean["serviceId"])
                raw_tk = generate_tracking_token()
                tk_hash = hash_token(raw_tk)
                ts = now_iso()
                ext_uuid = generate_uuid_v4()

                with transaction(conn):
                    ids = [r["id"] for r in conn.execute("SELECT id FROM services").fetchall()]
                    nums = [int(x.split("-")[-1]) for x in ids if x.split("-")[-1].isdigit()]
                    next_num = max([205] + nums) + 1
                    app_id = f"ABC-SRV-2026-{next_num}"

                    timeline = [
                        {
                            "id": f"srv-tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": "Application Submitted",
                            "actor": f"{clean['applicantName']} (Citizen)",
                            "remark": f"{catalog['titleEn']} application filed for Ward {clean['ward']}.",
                            "statusLabel": "Submitted",
                        }
                    ]
                    conn.execute(
                        """
                        INSERT INTO services(
                            id, external_uuid, service_id, service_name, applicant_name, mobile, mobile_last4,
                            ward, address, department, fee_inr, status, created_at, updated_at,
                            checked_docs_json, uploaded_doc_names_json, assigned_officer_id,
                            assigned_officer_name, filed_by_role, official_remark, timeline_json,
                            tracking_token_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, NULL, NULL, 'CITIZEN', ?, ?, ?)
                        """,
                        (
                            app_id,
                            ext_uuid,
                            catalog["id"],
                            catalog["titleEn"],
                            clean["applicantName"],
                            clean["mobile"],
                            clean["mobile"][-4:],
                            clean["ward"],
                            clean["address"],
                            catalog["department"],
                            catalog["feeInr"],
                            ts,
                            ts,
                            json.dumps(clean["checkedDocs"]),
                            json.dumps(clean["uploadedDocNames"]),
                            "Application received. Pending initial CSC document verification.",
                            json.dumps(timeline),
                            tk_hash,
                        ),
                    )
                    for fname in clean["uploadedDocNames"]:
                        conn.execute(
                            """
                            INSERT INTO attachments(id, target_kind, target_id, file_name, mime_type, size_bytes, storage_ref, created_at)
                            VALUES (?, 'service', ?, ?, 'application/octet-stream', 0, ?, ?)
                            """,
                            (f"att-{uuid.uuid4().hex[:12]}", app_id, fname, f"citizen-decl://{app_id}/{fname}", ts),
                        )
                    append_audit_event(
                        conn,
                        "citizen",
                        mask_name(clean["applicantName"]),
                        "CITIZEN",
                        "public",
                        ip_h,
                        "SERVICE_APPLIED",
                        app_id,
                        "SUCCESS",
                        f"Application {app_id} submitted for {catalog['titleEn']} (Ward {clean['ward']}).",
                    )
                    created_row = conn.execute("SELECT * FROM services WHERE id = ?", (app_id,)).fetchone()
                    sla_limit = self._get_sla_limit(conn)

                receipt = citizen_tracked_service_dto(created_row, sla_limit)
                receipt["applicantName"] = clean["applicantName"]
                receipt["mobileLast4"] = clean["mobile"][-4:]
                status_out = 201
                self._send_json(201, {"ok": True, "application": receipt, "trackingToken": raw_tk})
                return

            # --- Authenticated Staff Routes (Cookie + CSRF required) ---
            actor, sess_prefix, csrf_hash, curr_tok_hash = self._authenticate(conn)
            if not actor:
                raise AuthenticationError("Authentication required.")
            self._verify_csrf_for_session(csrf_hash)

            # Authenticated Self Password Change
            if path == "/api/staff/account/change-password":
                try:
                    ensure_allowed_keys(body, {"currentPassword", "newPassword"}, {"currentPassword", "newPassword"})
                    curr_pw = str(body["currentPassword"])
                    new_pw = str(body["newPassword"])
                    ok, err = validate_passcode_strength(new_pw)
                    if not ok:
                        raise ValueError(err)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                row = conn.execute("SELECT * FROM staff WHERE id = ?", (actor["id"],)).fetchone()
                env_sec_pass = os.environ.get("PANCHAYAT_SECRETARY_PASSCODE", "").strip()
                valid = False
                if row["id"] == "stf-secretary" and env_sec_pass:
                    valid = hmac.compare_digest(curr_pw, env_sec_pass)
                elif row["passcode_hash"]:
                    valid = verify_passcode(curr_pw, row["passcode_hash"])
                if not valid:
                    raise AuthenticationError("Current password is incorrect.")

                new_hash = hash_passcode(new_pw)
                with transaction(conn):
                    conn.execute(
                        "UPDATE staff SET passcode_hash = ?, is_claimed = 1, updated_at = ? WHERE id = ?",
                        (new_hash, now_iso(), actor["id"]),
                    )
                    # Revoke all other sessions for this staff user and keep current session
                    conn.execute(
                        "DELETE FROM sessions WHERE staff_id = ? AND token_hash != ?",
                        (actor["id"], curr_tok_hash),
                    )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "PASSWORD_CHANGED",
                        actor["id"],
                        "SUCCESS",
                        f"{actor['name']} changed their account password and revoked prior sessions.",
                    )
                self._send_json(200, {"ok": True, "message": "Password updated successfully."})
                return

            # Super Admin Password Reset for Another Staff Member
            if path.startswith("/api/staff/users/") and path.endswith("/reset-password"):
                staff_id = path.strip("/").split("/")[3]
                rbac = check_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    raise AuthorizationError(rbac["reason"])
                try:
                    ensure_allowed_keys(body, {"newPassword"}, {"newPassword"})
                    new_pw = str(body["newPassword"])
                    ok, err = validate_passcode_strength(new_pw)
                    if not ok:
                        raise ValueError(err)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                with transaction(conn):
                    target = conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()
                    if not target:
                        raise NotFoundError("Staff account not found.")
                    conn.execute(
                        "UPDATE staff SET passcode_hash = ?, failed_attempts = 0, locked_until = 0, is_claimed = 1, updated_at = ? WHERE id = ?",
                        (hash_passcode(new_pw), now_iso(), staff_id),
                    )
                    conn.execute("DELETE FROM sessions WHERE staff_id = ?", (staff_id,))
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "STAFF_PASSWORD_RESET",
                        staff_id,
                        "SUCCESS",
                        f"Panchayat Secretary reset credentials and invalidated sessions for {target['name']}.",
                    )
                    append_security_alert(
                        conn,
                        "HIGH",
                        "ADMIN_PASSWORD_RESET",
                        target["email"],
                        ip_h,
                        f"Password reset by {actor['name']} for {target['name']}.",
                    )
                self._send_json(200, {"ok": True, "message": "Staff password reset and active sessions invalidated."})
                return

            # Walk-in Grievance Intake (CSC / Super Admin)
            if path == "/api/staff/grievances":
                try:
                    clean = validate_grievance_create(body)
                except ValueError as ve:
                    raise ValidationError(str(ve))
                rbac = check_rbac(actor, clean["ward"], True, "CREATE_WALKIN")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(conn, "MEDIUM", "FORBIDDEN_ACTION", actor["email"], ip_h, rbac["reason"])
                    raise AuthorizationError(rbac["reason"])

                raw_tk = generate_tracking_token()
                tk_hash = hash_token(raw_tk)
                ts = now_iso()
                dept = CATEGORY_DEPARTMENT_MAP.get(clean["category"], "General Administration")
                ext_uuid = generate_uuid_v4()
                with transaction(conn):
                    base_sla = self._get_sla_limit(conn)
                    sla_days = resolve_sla_days_for_ticket(conn, clean["category"], clean["priority"], base_sla)
                    ids = [r["id"] for r in conn.execute("SELECT id FROM grievances").fetchall()]
                    nums = [int(x.split("-")[-1]) for x in ids if x.split("-")[-1].isdigit()]
                    ticket_id = f"ABC-GRV-2026-{max([108] + nums) + 1}"
                    timeline = [
                        {
                            "id": f"tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": "Walk-in Grievance Registered",
                            "actor": f"{actor['name']} ({actor['designation']})",
                            "remark": f"Walk-in filed for Ward {clean['ward']} ({clean['category']}, Priority: {clean['priority']}).",
                            "statusLabel": "SUBMITTED",
                        }
                    ]
                    conn.execute(
                        """
                        INSERT INTO grievances(
                            id, external_uuid, citizen_name, mobile, mobile_last4, ward, category, department,
                            priority, sla_limit_days, paused_seconds, hold_started_at, escalated_at,
                            escalation_level, consent_recorded, landmark, description, status,
                            created_at, updated_at, resolved_at, assigned_officer_id, assigned_officer_name,
                            filed_by_role, before_photo_url, after_photo_url, public_remark, internal_remark,
                            rating, feedback_comment, timeline_json, tracking_token_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?, 'SUBMITTED', ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?)
                        """,
                        (
                            ticket_id,
                            ext_uuid,
                            clean["citizenName"],
                            clean["mobile"],
                            clean["mobile"][-4:],
                            clean["ward"],
                            clean["category"],
                            dept,
                            clean["priority"],
                            sla_days,
                            1 if clean["consentAccepted"] else 0,
                            clean["landmark"],
                            clean["description"],
                            ts,
                            ts,
                            actor["role"],
                            clean["beforePhotoUrl"],
                            f"Walk-in grievance registered at {actor['designation']} desk.",
                            json.dumps(timeline),
                            tk_hash,
                        ),
                    )
                    record_status_history(
                        conn,
                        ticket_id,
                        None,
                        "SUBMITTED",
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        "Walk-in grievance registered.",
                    )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "WALKIN_GRIEVANCE_CREATED",
                        ticket_id,
                        "SUCCESS",
                        f"Walk-in grievance {ticket_id} registered by {actor['name']}.",
                    )
                    created_row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    holidays = load_holidays(conn)

                status_out = 201
                self._send_json(
                    201,
                    {
                        "ok": True,
                        "ticket": staff_grievance_dto(created_row, base_sla, actor, holidays),
                        "trackingToken": raw_tk,
                    },
                )
                return

            # Add Comment to Grievance
            if path.startswith("/api/staff/grievances/") and path.endswith("/comments"):
                parts = path.strip("/").split("/")
                if len(parts) != 5:
                    raise ValidationError("Invalid comment path.")
                ticket_id = parts[3]
                try:
                    ensure_allowed_keys(body, {"body", "isInternal"}, {"body"})
                    c_body = normalize_text(body["body"], 1000, 2, "body")
                    is_internal = bool(body.get("isInternal", False))
                except ValueError as ve:
                    raise ValidationError(str(ve))

                with transaction(conn):
                    ticket = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    if not ticket:
                        raise NotFoundError("Ticket not found.")
                    same_dept = ticket["department"] == actor["department"] or ticket["assigned_officer_id"] == actor["id"]
                    rbac = check_rbac(actor, ticket["ward"], same_dept, "UPDATE")
                    if not rbac["allowed"]:
                        raise AuthorizationError(rbac["reason"])
                    ts = now_iso()
                    cid = f"cmt-{uuid.uuid4().hex[:12]}"
                    conn.execute(
                        """
                        INSERT INTO grievance_comments(id, grievance_id, author_id, author_name, is_internal, body, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (cid, ticket_id, actor["id"], actor["name"], 1 if is_internal else 0, c_body, ts),
                    )
                    if not is_internal:
                        timeline = json.loads(ticket["timeline_json"])
                        timeline.append(
                            {
                                "id": f"tl-cmt-{int(time.time() * 1000)}",
                                "timestamp": ts,
                                "stepTitle": "Official Comment Added",
                                "actor": f"{actor['name']} ({actor['designation']})",
                                "remark": c_body,
                                "statusLabel": normalize_grievance_status(ticket["status"]),
                            }
                        )
                        conn.execute(
                            "UPDATE grievances SET updated_at = ?, timeline_json = ? WHERE id = ?",
                            (ts, json.dumps(timeline), ticket_id),
                        )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "GRIEVANCE_COMMENT_ADDED",
                        ticket_id,
                        "SUCCESS",
                        f"{'Internal' if is_internal else 'Public'} comment added on {ticket_id}.",
                    )
                status_out = 201
                self._send_json(201, {"ok": True, "commentId": cid})
                return

            # Escalate Overdue Grievances (Super Admin)
            if path == "/api/staff/grievances/escalate-overdue":
                rbac = check_rbac(actor, 1, True, "MANAGE_SLA")
                if not rbac["allowed"]:
                    raise AuthorizationError(rbac["reason"])
                with transaction(conn):
                    base_sla = self._get_sla_limit(conn)
                    escalated_ids = escalate_overdue_grievances(
                        conn, actor, now_dt=effective_now_dt(), base_sla_days=base_sla
                    )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "ESCALATION_SWEEP",
                        "GRIEVANCES",
                        "SUCCESS",
                        f"Escalated {len(escalated_ids)} overdue grievance(s).",
                    )
                self._send_json(200, {"ok": True, "escalatedIds": escalated_ids, "count": len(escalated_ids)})
                return

            # Walk-in Service Intake (CSC / Super Admin)
            if path == "/api/staff/services":
                valid_sids = {c["id"] for c in SERVICE_CATALOG}
                try:
                    clean = validate_service_create(body, valid_sids)
                except ValueError as ve:
                    raise ValidationError(str(ve))
                rbac = check_rbac(actor, clean["ward"], True, "CREATE_WALKIN")
                if not rbac["allowed"]:
                    raise AuthorizationError(rbac["reason"])

                catalog = next(c for c in SERVICE_CATALOG if c["id"] == clean["serviceId"])
                raw_tk = generate_tracking_token()
                tk_hash = hash_token(raw_tk)
                ts = now_iso()
                ext_uuid = generate_uuid_v4()
                with transaction(conn):
                    ids = [r["id"] for r in conn.execute("SELECT id FROM services").fetchall()]
                    nums = [int(x.split("-")[-1]) for x in ids if x.split("-")[-1].isdigit()]
                    app_id = f"ABC-SRV-2026-{max([205] + nums) + 1}"
                    timeline = [
                        {
                            "id": f"srv-tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": "Walk-in Application Submitted",
                            "actor": f"{actor['name']} ({actor['designation']})",
                            "remark": f"Walk-in {catalog['titleEn']} application filed for Ward {clean['ward']}.",
                            "statusLabel": "Submitted",
                        }
                    ]
                    conn.execute(
                        """
                        INSERT INTO services(
                            id, external_uuid, service_id, service_name, applicant_name, mobile, mobile_last4,
                            ward, address, department, fee_inr, status, created_at, updated_at,
                            checked_docs_json, uploaded_doc_names_json, assigned_officer_id,
                            assigned_officer_name, filed_by_role, official_remark, timeline_json,
                            tracking_token_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
                        """,
                        (
                            app_id,
                            ext_uuid,
                            catalog["id"],
                            catalog["titleEn"],
                            clean["applicantName"],
                            clean["mobile"],
                            clean["mobile"][-4:],
                            clean["ward"],
                            clean["address"],
                            catalog["department"],
                            catalog["feeInr"],
                            ts,
                            ts,
                            json.dumps(clean["checkedDocs"]),
                            json.dumps(clean["uploadedDocNames"]),
                            actor["role"],
                            "Walk-in application received at CSC desk.",
                            json.dumps(timeline),
                            tk_hash,
                        ),
                    )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "WALKIN_SERVICE_CREATED",
                        app_id,
                        "SUCCESS",
                        f"Walk-in service {app_id} registered by {actor['name']}.",
                    )
                    created_row = conn.execute("SELECT * FROM services WHERE id = ?", (app_id,)).fetchone()
                    sla_limit = self._get_sla_limit(conn)

                status_out = 201
                self._send_json(
                    201,
                    {"ok": True, "application": staff_service_dto(created_row, sla_limit, actor), "trackingToken": raw_tk},
                )
                return

            # Create Staff Account (Super Admin)
            if path == "/api/staff/users":
                rbac = check_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(
                            conn, "HIGH", "PRIVILEGE_ESCALATION_ATTEMPT", actor["email"], ip_h, rbac["reason"]
                        )
                    raise AuthorizationError(rbac["reason"])
                try:
                    clean = validate_staff_payload(body, is_create=True)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                with transaction(conn):
                    if conn.execute("SELECT 1 FROM staff WHERE email = ?", (clean["email"],)).fetchone():
                        raise ValidationError("Another staff account already uses this email.")
                    uname = clean.get("username")
                    if uname and conn.execute("SELECT 1 FROM staff WHERE lower(username) = ?", (uname,)).fetchone():
                        raise ValidationError("Another staff account already uses this User ID.")
                    new_id = f"stf-{int(time.time() * 1000)}"
                    ext_uuid = generate_uuid_v4()
                    ts = now_iso()
                    perms = clean.get("permissions") or dict(DEFAULT_ROLE_PERMISSIONS.get(clean["role"], {}))
                    p_hash = hash_passcode(clean["passcode"])
                    conn.execute(
                        """
                        INSERT INTO staff(
                            id, external_uuid, name, username, email, passcode_hash, designation, role, department,
                            assigned_wards_json, is_active, permissions_json,
                            failed_attempts, locked_until, is_claimed, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)
                        """,
                        (
                            new_id,
                            ext_uuid,
                            clean["name"],
                            uname,
                            clean["email"],
                            p_hash,
                            clean["designation"],
                            clean["role"],
                            clean["department"],
                            json.dumps(clean["assignedWards"]),
                            1 if clean.get("isActive", True) else 0,
                            json.dumps(perms),
                            ts,
                            ts,
                        ),
                    )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "STAFF_CREATED",
                        new_id,
                        "SUCCESS",
                        f"Created staff account {clean['name']} ({clean['role']}).",
                    )
                    created = row_to_staff_dict(conn.execute("SELECT * FROM staff WHERE id = ?", (new_id,)).fetchone())

                status_out = 201
                self._send_json(201, {"ok": True, "staff": staff_self_dto(created)})
                return

            # Toggle Staff Active Status (Super Admin)
            if path.startswith("/api/staff/users/") and path.endswith("/toggle"):
                staff_id = path.strip("/").split("/")[3]
                rbac = check_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    raise AuthorizationError(rbac["reason"])
                if staff_id == actor["id"]:
                    raise ValidationError("You cannot suspend your own active session account.")
                with transaction(conn):
                    target = conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()
                    if not target:
                        raise NotFoundError("Staff account not found.")
                    next_active = 0 if target["is_active"] else 1
                    conn.execute(
                        "UPDATE staff SET is_active = ?, updated_at = ? WHERE id = ?",
                        (next_active, now_iso(), staff_id),
                    )
                    if next_active == 0:
                        conn.execute("DELETE FROM sessions WHERE staff_id = ?", (staff_id,))
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "STAFF_ACTIVATED" if next_active else "STAFF_SUSPENDED",
                        staff_id,
                        "SUCCESS",
                        f"{'Activated' if next_active else 'Suspended'} staff account {target['name']}.",
                    )
                    updated = row_to_staff_dict(conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone())
                self._send_json(200, {"ok": True, "staff": staff_self_dto(updated)})
                return

            # Strongly Authorized Maintenance Reset (Non-Production Only)
            if path == "/api/staff/maintenance/reset":
                if is_production_env():
                    raise AuthorizationError("Maintenance reset is disabled in production builds.")
                rbac = check_rbac(actor, 1, True, "MAINTENANCE_RESET")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(
                            conn, "CRITICAL", "UNAUTHORIZED_MAINTENANCE_RESET", actor["email"], ip_h, rbac["reason"]
                        )
                    raise AuthorizationError(rbac["reason"])
                try:
                    ensure_allowed_keys(body, {"confirmPhrase", "maintenanceKey"}, {"confirmPhrase"})
                except ValueError as ve:
                    raise ValidationError(str(ve))
                if body.get("confirmPhrase") != "CONFIRM_PORTAL_RESET":
                    raise ValidationError("Explicit confirmation phrase required.")
                env_maint = os.environ.get("PANCHAYAT_MAINTENANCE_KEY", "").strip()
                if env_maint and not hmac.compare_digest(str(body.get("maintenanceKey", "")), env_maint):
                    raise AuthorizationError("Invalid maintenance authorization key.")

                with transaction(conn):
                    reset_database_with_audit(conn, actor, sess_prefix, ip_h)
                self._send_json(200, {"ok": True}, self._cookie_headers("", clear=True))
                return

            raise NotFoundError("Endpoint not found.")
        except AppError as ae:
            status_out = ae.status_code
            self._send_app_error(ae)
        except Exception as exc:
            status_out = 500
            LOGGER.error("unhandled_post_error", extra={"structured_data": {"error": str(exc), "path": path}})
            self._send_json(500, {"ok": False, "error": "Internal server error.", "requestId": get_request_id()})
        finally:
            conn.close()
            self._finish_log("POST", path, status_out, started)

    def do_PATCH(self):
        _, started = self._begin_request()
        path = normalize_api_path(urlparse(self.path).path)
        conn = get_connection(SQLITE_PATH)
        ip_h = hash_ip(self._client_ip())
        status_out = 200
        try:
            if not self._check_origin():
                raise AuthorizationError("Cross-origin state change rejected.")
            body = self._read_json()

            actor, sess_prefix, csrf_hash, _ = self._authenticate(conn)
            if not actor:
                raise AuthenticationError("Authentication required.")
            self._verify_csrf_for_session(csrf_hash)

            if path.startswith("/api/staff/grievances/"):
                ticket_id = path.strip("/").split("/")[-1]
                try:
                    patch = validate_grievance_patch(body)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                with transaction(conn):
                    ticket = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    if not ticket:
                        raise NotFoundError("Ticket not found.")

                    same_dept = ticket["department"] == actor["department"] or ticket["assigned_officer_id"] == actor["id"]
                    rbac_upd = check_rbac(actor, ticket["ward"], same_dept, "UPDATE")
                    if not rbac_upd["allowed"]:
                        append_security_alert(
                            conn, "MEDIUM", "FORBIDDEN_RECORD_UPDATE", actor["email"], ip_h, f"{ticket_id}: {rbac_upd['reason']}"
                        )
                        raise AuthorizationError(rbac_upd["reason"])

                    if "assignedOfficerId" in patch and patch["assignedOfficerId"] != ticket["assigned_officer_id"]:
                        rbac_assign = check_rbac(actor, ticket["ward"], same_dept, "ASSIGN")
                        if not rbac_assign["allowed"]:
                            append_security_alert(
                                conn, "MEDIUM", "FORBIDDEN_ASSIGNMENT", actor["email"], ip_h, f"{ticket_id}: {rbac_assign['reason']}"
                            )
                            raise AuthorizationError(rbac_assign["reason"])

                    curr_status = normalize_grievance_status(ticket["status"])
                    next_status = normalize_grievance_status(patch.get("status", curr_status))
                    pub_remark = patch.get("publicRemark", ticket["public_remark"])

                    ok_tr, err_tr = validate_grievance_transition(actor["role"], curr_status, next_status, pub_remark)
                    if not ok_tr:
                        raise ValidationError(err_tr)

                    officer_id = patch["assignedOfficerId"] if "assignedOfficerId" in patch else ticket["assigned_officer_id"]
                    assigned_name = ticket["assigned_officer_name"]
                    if "assignedOfficerId" in patch:
                        if officer_id:
                            off_row = conn.execute("SELECT id, name, is_active FROM staff WHERE id = ?", (officer_id,)).fetchone()
                            if not off_row or not off_row["is_active"]:
                                raise ValidationError("Selected officer is inactive or invalid.")
                            assigned_name = off_row["name"]
                        else:
                            assigned_name = None

                    next_priority = patch.get("priority", ticket["priority"] if "priority" in ticket.keys() else "NORMAL")
                    base_sla = self._get_sla_limit(conn)
                    sla_days = resolve_sla_days_for_ticket(conn, ticket["category"], next_priority, base_sla)

                    ts = now_iso()
                    resolved_at = ticket["resolved_at"]
                    if next_status == "RESOLVED" and not resolved_at:
                        resolved_at = ts
                    elif next_status == "REOPENED":
                        resolved_at = None

                    paused_seconds, hold_started_at = calculate_hold_transition_fields(ticket, next_status)
                    int_remark = patch.get("internalRemark", ticket["internal_remark"])
                    after_photo = patch.get("afterPhotoUrl", ticket["after_photo_url"])

                    timeline = json.loads(ticket["timeline_json"])
                    step_title = (
                        f"Status updated to {next_status}"
                        if next_status != curr_status
                        else (f"Assigned to {assigned_name}" if officer_id != ticket["assigned_officer_id"] and assigned_name else "Official Remark Updated")
                    )
                    timeline.append(
                        {
                            "id": f"tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": step_title,
                            "actor": f"{actor['name']} ({actor['designation']})",
                            "remark": pub_remark or f"Ticket updated by {actor['name']}.",
                            "statusLabel": next_status,
                        }
                    )

                    conn.execute(
                        """
                        UPDATE grievances
                        SET status = ?, priority = ?, sla_limit_days = ?, paused_seconds = ?, hold_started_at = ?,
                            updated_at = ?, resolved_at = ?, assigned_officer_id = ?, assigned_officer_name = ?,
                            public_remark = ?, internal_remark = ?, after_photo_url = ?, timeline_json = ?
                        WHERE id = ?
                        """,
                        (
                            next_status,
                            next_priority,
                            sla_days,
                            paused_seconds,
                            hold_started_at,
                            ts,
                            resolved_at,
                            officer_id,
                            assigned_name,
                            pub_remark,
                            int_remark,
                            after_photo,
                            json.dumps(timeline),
                            ticket_id,
                        ),
                    )
                    if next_status != curr_status:
                        record_status_history(
                            conn,
                            ticket_id,
                            curr_status,
                            next_status,
                            actor["id"],
                            actor["name"],
                            actor["role"],
                            pub_remark or step_title,
                        )
                    if "assignedOfficerId" in patch and officer_id != ticket["assigned_officer_id"]:
                        record_assignment(conn, ticket_id, officer_id, assigned_name, actor["id"])
                        if officer_id:
                            record_notification(
                                conn,
                                "WARD_OFFICER",
                                officer_id,
                                ticket_id,
                                f"Ticket {ticket_id} (Ward {ticket['ward']}) assigned to you by {actor['name']}.",
                            )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "TICKET_RESOLVED" if next_status == "RESOLVED" else "TICKET_UPDATED",
                        ticket_id,
                        "SUCCESS",
                        f"Ticket {ticket_id} updated ({step_title}) by {actor['name']}.",
                    )
                    updated_row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    holidays = load_holidays(conn)

                self._send_json(200, {"ok": True, "ticket": staff_grievance_dto(updated_row, base_sla, actor, holidays)})
                return

            if path.startswith("/api/staff/services/"):
                app_id = path.strip("/").split("/")[-1]
                try:
                    patch = validate_service_patch(body)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                with transaction(conn):
                    app = conn.execute("SELECT * FROM services WHERE id = ?", (app_id,)).fetchone()
                    if not app:
                        raise NotFoundError("Application not found.")

                    same_dept = app["department"] == actor["department"] or app["assigned_officer_id"] == actor["id"]
                    rbac_upd = check_rbac(actor, app["ward"], same_dept, "UPDATE")
                    if not rbac_upd["allowed"]:
                        append_security_alert(
                            conn, "MEDIUM", "FORBIDDEN_SERVICE_UPDATE", actor["email"], ip_h, f"{app_id}: {rbac_upd['reason']}"
                        )
                        raise AuthorizationError(rbac_upd["reason"])

                    next_status = patch.get("status", app["status"])
                    if next_status == "Approved":
                        rbac_app = check_rbac(actor, app["ward"], same_dept, "APPROVE_CERT")
                        if not rbac_app["allowed"]:
                            append_security_alert(
                                conn, "HIGH", "UNAUTHORIZED_CERT_APPROVAL", actor["email"], ip_h, f"{app_id}: {rbac_app['reason']}"
                            )
                            raise AuthorizationError(rbac_app["reason"])

                    if next_status in ("Documents Verified", "Correction Needed"):
                        rbac_ver = check_rbac(actor, app["ward"], same_dept, "VERIFY")
                        if not rbac_ver["allowed"]:
                            raise AuthorizationError(rbac_ver["reason"])

                    if "assignedOfficerId" in patch and patch["assignedOfficerId"] != app["assigned_officer_id"]:
                        rbac_assign = check_rbac(actor, app["ward"], same_dept, "ASSIGN")
                        if not rbac_assign["allowed"]:
                            raise AuthorizationError(rbac_assign["reason"])

                    officer_id = patch["assignedOfficerId"] if "assignedOfficerId" in patch else app["assigned_officer_id"]
                    assigned_name = app["assigned_officer_name"]
                    if "assignedOfficerId" in patch:
                        if officer_id:
                            off_row = conn.execute("SELECT id, name, is_active FROM staff WHERE id = ?", (officer_id,)).fetchone()
                            if not off_row or not off_row["is_active"]:
                                raise ValidationError("Selected officer is inactive or invalid.")
                            assigned_name = off_row["name"]
                        else:
                            assigned_name = None

                    ts = now_iso()
                    off_remark = patch.get("officialRemark", app["official_remark"])
                    timeline = json.loads(app["timeline_json"])
                    timeline.append(
                        {
                            "id": f"srv-tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": f"Status: {next_status}",
                            "actor": f"{actor['name']} ({actor['designation']})",
                            "remark": off_remark or f"Updated to {next_status} by {actor['name']}.",
                            "statusLabel": next_status,
                        }
                    )

                    conn.execute(
                        """
                        UPDATE services
                        SET status = ?, updated_at = ?, assigned_officer_id = ?, assigned_officer_name = ?,
                            official_remark = ?, timeline_json = ?
                        WHERE id = ?
                        """,
                        (next_status, ts, officer_id, assigned_name, off_remark, json.dumps(timeline), app_id),
                    )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "CERTIFICATE_APPROVED" if next_status == "Approved" else "SERVICE_UPDATED",
                        app_id,
                        "SUCCESS",
                        f"Service {app_id} ({app['service_name']}) updated to {next_status}.",
                    )
                    updated_row = conn.execute("SELECT * FROM services WHERE id = ?", (app_id,)).fetchone()
                    sla_limit = self._get_sla_limit(conn)

                self._send_json(200, {"ok": True, "application": staff_service_dto(updated_row, sla_limit, actor)})
                return

            raise NotFoundError("Endpoint not found.")
        except AppError as ae:
            status_out = ae.status_code
            self._send_app_error(ae)
        except Exception as exc:
            status_out = 500
            LOGGER.error("unhandled_patch_error", extra={"structured_data": {"error": str(exc), "path": path}})
            self._send_json(500, {"ok": False, "error": "Internal server error.", "requestId": get_request_id()})
        finally:
            conn.close()
            self._finish_log("PATCH", path, status_out, started)

    def do_PUT(self):
        _, started = self._begin_request()
        path = normalize_api_path(urlparse(self.path).path)
        conn = get_connection(SQLITE_PATH)
        ip_h = hash_ip(self._client_ip())
        status_out = 200
        try:
            if not self._check_origin():
                raise AuthorizationError("Cross-origin state change rejected.")
            body = self._read_json()

            actor, sess_prefix, csrf_hash, _ = self._authenticate(conn)
            if not actor:
                raise AuthenticationError("Authentication required.")
            self._verify_csrf_for_session(csrf_hash)

            if path.startswith("/api/staff/users/"):
                staff_id = path.strip("/").split("/")[-1]
                rbac = check_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(
                            conn, "HIGH", "PRIVILEGE_ESCALATION_ATTEMPT", actor["email"], ip_h, rbac["reason"]
                        )
                    raise AuthorizationError(rbac["reason"])
                try:
                    clean = validate_staff_payload(body, is_create=False)
                except ValueError as ve:
                    raise ValidationError(str(ve))

                with transaction(conn):
                    target = conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()
                    if not target:
                        raise NotFoundError("Staff account not found.")
                    email = clean.get("email", target["email"])
                    dup = conn.execute("SELECT 1 FROM staff WHERE email = ? AND id != ?", (email, staff_id)).fetchone()
                    if dup:
                        raise ValidationError("Another staff account already uses this email.")
                    uname = clean["username"] if "username" in clean else target["username"]
                    if uname:
                        dup_u = conn.execute(
                            "SELECT 1 FROM staff WHERE lower(username) = ? AND id != ?",
                            (uname.lower(), staff_id),
                        ).fetchone()
                        if dup_u:
                            raise ValidationError("Another staff account already uses this User ID.")

                    p_hash = target["passcode_hash"]
                    claimed = target["is_claimed"]
                    if "passcode" in clean:
                        p_hash = hash_passcode(clean["passcode"])
                        claimed = 1

                    next_role = clean.get("role", target["role"])
                    if staff_id == actor["id"] and next_role != "SUPER_ADMIN":
                        raise ValidationError("Cannot demote your own active Super Admin session.")

                    conn.execute(
                        """
                        UPDATE staff
                        SET name = ?, username = ?, email = ?, passcode_hash = ?, designation = ?, role = ?,
                            department = ?, assigned_wards_json = ?, is_active = ?, permissions_json = ?,
                            is_claimed = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            clean.get("name", target["name"]),
                            uname,
                            email,
                            p_hash,
                            clean.get("designation", target["designation"]),
                            next_role,
                            clean.get("department", target["department"]),
                            json.dumps(clean.get("assignedWards", json.loads(target["assigned_wards_json"]))),
                            1 if clean.get("isActive", bool(target["is_active"])) else 0,
                            json.dumps(clean.get("permissions", json.loads(target["permissions_json"]))),
                            claimed,
                            now_iso(),
                            staff_id,
                        ),
                    )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "ROLE_UPDATED",
                        staff_id,
                        "SUCCESS",
                        f"Updated role & permissions for {clean.get('name', target['name'])} ({next_role}).",
                    )
                    updated = row_to_staff_dict(conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone())
                self._send_json(200, {"ok": True, "staff": staff_self_dto(updated)})
                return

            if path == "/api/staff/config/sla":
                rbac = check_rbac(actor, 1, True, "MANAGE_SLA")
                if not rbac["allowed"]:
                    raise AuthorizationError(rbac["reason"])
                try:
                    ensure_allowed_keys(body, {"slaLimitDays"}, {"slaLimitDays"})
                    days = int(body["slaLimitDays"])
                except (ValueError, TypeError):
                    raise ValidationError("SLA threshold must be an integer between 1 and 30.")
                if days < 1 or days > 30:
                    raise ValidationError("SLA threshold must be between 1 and 30 days.")
                with transaction(conn):
                    conn.execute(
                        "UPDATE config SET value = ?, updated_at = ? WHERE key = 'slaLimitDays'",
                        (str(days), now_iso()),
                    )
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "SLA_POLICY_UPDATED",
                        "SLA_CONFIG",
                        "SUCCESS",
                        f"Updated Panchayat grievance SLA threshold to {days} days.",
                    )
                self._send_json(200, {"ok": True, "slaLimitDays": days})
                return

            raise NotFoundError("Endpoint not found.")
        except AppError as ae:
            status_out = ae.status_code
            self._send_app_error(ae)
        except Exception as exc:
            status_out = 500
            LOGGER.error("unhandled_put_error", extra={"structured_data": {"error": str(exc), "path": path}})
            self._send_json(500, {"ok": False, "error": "Internal server error.", "requestId": get_request_id()})
        finally:
            conn.close()
            self._finish_log("PUT", path, status_out, started)

    def do_DELETE(self):
        _, started = self._begin_request()
        path = normalize_api_path(urlparse(self.path).path)
        conn = get_connection(SQLITE_PATH)
        ip_h = hash_ip(self._client_ip())
        status_out = 200
        try:
            if not self._check_origin():
                raise AuthorizationError("Cross-origin delete rejected.")

            actor, sess_prefix, csrf_hash, _ = self._authenticate(conn)
            if not actor:
                raise AuthenticationError("Authentication required.")
            self._verify_csrf_for_session(csrf_hash)

            if path.startswith("/api/staff/grievances/"):
                ticket_id = path.strip("/").split("/")[-1]
                rbac = check_rbac(actor, 1, True, "DELETE")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(
                            conn, "HIGH", "UNAUTHORIZED_DELETE", actor["email"], ip_h, f"Grievance {ticket_id}: {rbac['reason']}"
                        )
                    raise AuthorizationError(rbac["reason"])
                with transaction(conn):
                    cur = conn.execute("DELETE FROM grievances WHERE id = ?", (ticket_id,))
                    if cur.rowcount == 0:
                        raise NotFoundError("Ticket not found.")
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "RECORD_DELETED",
                        ticket_id,
                        "SUCCESS",
                        f"Deleted grievance record {ticket_id} by {actor['name']}.",
                    )
                self._send_json(200, {"ok": True})
                return

            if path.startswith("/api/staff/services/"):
                app_id = path.strip("/").split("/")[-1]
                rbac = check_rbac(actor, 1, True, "DELETE")
                if not rbac["allowed"]:
                    raise AuthorizationError(rbac["reason"])
                with transaction(conn):
                    cur = conn.execute("DELETE FROM services WHERE id = ?", (app_id,))
                    if cur.rowcount == 0:
                        raise NotFoundError("Application not found.")
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "RECORD_DELETED",
                        app_id,
                        "SUCCESS",
                        f"Deleted service application {app_id} by {actor['name']}.",
                    )
                self._send_json(200, {"ok": True})
                return

            raise NotFoundError("Endpoint not found.")
        except AppError as ae:
            status_out = ae.status_code
            self._send_app_error(ae)
        except Exception as exc:
            status_out = 500
            LOGGER.error("unhandled_delete_error", extra={"structured_data": {"error": str(exc), "path": path}})
            self._send_json(500, {"ok": False, "error": "Internal server error.", "requestId": get_request_id()})
        finally:
            conn.close()
            self._finish_log("DELETE", path, status_out, started)


def run_server(port: int = 3001, db_path: str = SQLITE_PATH):
    global SQLITE_PATH
    SQLITE_PATH = db_path
    # Fail-fast startup verification: secret, C engine compilation/smoke test, and DB schema
    load_or_create_session_secret()
    get_session_secret_bytes(reset_cache=True)
    ensure_c_engine_ready()
    init_db(db_path)

    server = ThreadingHTTPServer(("0.0.0.0", port), PanchayatApiHandler)
    LOGGER.info(
        "server_started",
        extra={
            "structured_data": {
                "port": port,
                "env": SETTINGS.app_env,
                "cEngine": str(C_ENGINE_BIN),
            }
        },
    )
    server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ABC Gram Panchayat Hardened Python API Server")
    parser.add_argument("--port", type=int, default=3001)
    parser.add_argument("--db", default=SQLITE_PATH)
    args = parser.parse_args()
    run_server(args.port, args.db)
