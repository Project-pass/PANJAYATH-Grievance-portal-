import argparse
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
import subprocess
import time
from urllib.parse import urlparse

from db import (
    SQLITE_PATH,
    append_audit_event,
    append_security_alert,
    get_connection,
    init_db,
    now_iso,
    reset_database_with_audit,
    transaction,
)
from security_utils import (
    SlidingWindowRateLimiter,
    ensure_allowed_keys,
    generate_opaque_token,
    generate_tracking_token,
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
from seed_data import CATEGORY_DEPARTMENT_MAP, DEFAULT_ROLE_PERMISSIONS, SERVICE_CATALOG

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
C_ENGINE_BIN = os.path.join(BASE_DIR, "c_engine", "sla_rbac")
REFERENCE_MIN_NOW = datetime(2026, 11, 23, 23, 59, 0, tzinfo=timezone.utc).timestamp()

MAX_BODY_BYTES = 2 * 1024 * 1024  # 2MB strict payload size cap
SESSION_TTL_SECONDS = 8 * 3600
SESSION_IDLE_SECONDS = 30 * 60
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION_SECONDS = 15 * 60
COOKIE_NAME = "panchayat_sid"

RATE_LIMITER = SlidingWindowRateLimiter()


def effective_now_ts() -> float:
    return max(time.time(), REFERENCE_MIN_NOW)


def is_production_env() -> bool:
    return (
        os.environ.get("APP_ENV", "").strip().lower() == "production"
        or os.environ.get("NODE_ENV", "").strip().lower() == "production"
    )


def call_c_sla(created_at_iso: str, status: str, sla_limit_days: int) -> dict:
    try:
        dt = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00"))
        age_days = max(0, int((effective_now_ts() - dt.timestamp()) // 86400))
    except Exception:
        age_days = 0
    is_closed = 1 if status in ("Resolved", "Rejected", "Approved") else 0

    if os.path.exists(C_ENGINE_BIN):
        proc = subprocess.run(
            [C_ENGINE_BIN, "sla", str(age_days), str(int(sla_limit_days)), str(is_closed)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return json.loads(proc.stdout.strip())

    remaining = sla_limit_days - age_days
    is_breached = (not is_closed) and (age_days > sla_limit_days)
    label = (
        f"Closed ({age_days}d)"
        if is_closed
        else (f"SLA BREACHED ({age_days}d)" if is_breached else ("Due Today" if remaining == 0 else f"{remaining}d left"))
    )
    return {
        "ageDays": age_days,
        "remainingDays": remaining,
        "isBreached": is_breached,
        "isClosed": bool(is_closed),
        "label": label,
    }


def row_to_staff_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "username": row["username"] if "username" in row.keys() else None,
        "email": row["email"],
        "designation": row["designation"],
        "role": row["role"],
        "department": row["department"],
        "assignedWards": json.loads(row["assigned_wards_json"]),
        "isActive": bool(row["is_active"]),
        "permissions": json.loads(row["permissions_json"]),
        "isClaimed": bool(row["is_claimed"]),
    }


def call_c_rbac(staff_member: dict | None, target_ward: int, same_dept: bool, action: str) -> dict:
    if not staff_member or not staff_member.get("isActive", False):
        return {"allowed": False, "reason": "Staff account is inactive or unauthenticated."}

    role_map = {"CITIZEN": 0, "SUPER_ADMIN": 1, "WARD_OFFICER": 2, "CSC_OPERATOR": 3}
    role_code = role_map.get(staff_member.get("role", "CITIZEN"), 0)

    perms = staff_member.get("permissions", {})
    perm_mask = (
        (1 if perms.get("canApproveCertificates") else 0)
        | (2 if perms.get("canAssignTickets") else 0)
        | (4 if perms.get("canManageUsers") else 0)
        | (8 if perms.get("canDeleteRecords") else 0)
        | (16 if perms.get("canVerifyDocuments") else 0)
    )

    ward_mask = 0
    for w in staff_member.get("assignedWards", []):
        if 1 <= int(w) <= 15:
            ward_mask |= 1 << (int(w) - 1)

    safe_ward = max(1, min(15, int(target_ward)))

    if os.path.exists(C_ENGINE_BIN):
        proc = subprocess.run(
            [
                C_ENGINE_BIN,
                "rbac",
                str(role_code),
                str(perm_mask),
                str(ward_mask),
                str(safe_ward),
                "1" if same_dept else "0",
                action,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return json.loads(proc.stdout.strip())

    return {"allowed": False, "reason": "Authorization engine unavailable."}


# --- Strict Response DTOs (never leak passcode hashes, tokens, or unauthorized PII) ---

def staff_self_dto(staff: dict) -> dict:
    return {
        "id": staff["id"],
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


def public_grievance_summary_dto(row, sla_limit: int) -> dict:
    return {
        "id": row["id"],
        "ward": row["ward"],
        "category": row["category"],
        "department": row["department"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "sla": call_c_sla(row["created_at"], row["status"], sla_limit),
    }


def citizen_tracked_grievance_dto(row, sla_limit: int) -> dict:
    return {
        "kind": "grievance",
        "id": row["id"],
        "citizenDisplay": mask_name(row["citizen_name"]),
        "ward": row["ward"],
        "category": row["category"],
        "department": row["department"],
        "landmark": row["landmark"],
        "description": row["description"],
        "status": row["status"],
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
        "sla": call_c_sla(row["created_at"], row["status"], sla_limit),
    }


def citizen_tracked_service_dto(row, sla_limit: int) -> dict:
    return {
        "kind": "service",
        "id": row["id"],
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
        "sla": call_c_sla(row["created_at"], row["status"], sla_limit),
    }


def staff_grievance_dto(row, sla_limit: int, actor: dict) -> dict:
    show_full_contact = actor["role"] in ("SUPER_ADMIN", "CSC_OPERATOR")
    return {
        "id": row["id"],
        "citizenName": row["citizen_name"],
        "mobile": row["mobile"] if show_full_contact else mask_mobile(row["mobile"]),
        "ward": row["ward"],
        "category": row["category"],
        "department": row["department"],
        "landmark": row["landmark"],
        "description": row["description"],
        "status": row["status"],
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
        "sla": call_c_sla(row["created_at"], row["status"], sla_limit),
    }


def staff_service_dto(row, sla_limit: int, actor: dict) -> dict:
    show_full_contact = actor["role"] in ("SUPER_ADMIN", "CSC_OPERATOR")
    return {
        "id": row["id"],
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
        "sla": call_c_sla(row["created_at"], row["status"], sla_limit),
    }


class PanchayatApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _client_ip(self) -> str:
        fwd = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        return fwd or (self.client_address[0] if self.client_address else "127.0.0.1")

    def _same_origin_header(self) -> str | None:
        origin = self.headers.get("Origin", "").strip()
        if not origin:
            return None
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").strip()
        try:
            parsed = urlparse(origin)
            if parsed.netloc and host and parsed.netloc.lower() == host.lower():
                return origin
        except Exception:
            return None
        return None

    def _check_csrf_and_origin(self) -> bool:
        origin = self.headers.get("Origin", "").strip()
        if origin and not self._same_origin_header():
            return False
        return True

    def _send_security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
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

    def _read_json(self) -> dict | None:
        raw_len = self.headers.get("Content-Length", "0").strip()
        try:
            length = int(raw_len)
        except ValueError:
            self._send_json(400, {"ok": False, "error": "Invalid Content-Length header."})
            return None
        if length < 0 or length > MAX_BODY_BYTES:
            self._send_json(413, {"ok": False, "error": "Request payload exceeds maximum allowed size (2MB)."})
            return None
        if length == 0:
            return {}
        try:
            raw = self.rfile.read(length).decode("utf-8")
            parsed = json.loads(raw)
        except Exception:
            self._send_json(400, {"ok": False, "error": "Malformed JSON payload."})
            return None
        if not isinstance(parsed, dict):
            self._send_json(400, {"ok": False, "error": "JSON payload must be an object."})
            return None
        return parsed

    def _extract_session_token(self) -> tuple[str | None, str]:
        auth_hdr = self.headers.get("Authorization", "").strip()
        if auth_hdr.lower().startswith("bearer "):
            tok = auth_hdr[7:].strip()
            if tok:
                return tok, "bearer"
        cookie_hdr = self.headers.get("Cookie", "")
        if cookie_hdr:
            c = SimpleCookie()
            try:
                c.load(cookie_hdr)
                if COOKIE_NAME in c and c[COOKIE_NAME].value:
                    return c[COOKIE_NAME].value.strip(), "cookie"
            except Exception:
                pass
        return None, "none"

    def _authenticate(self, conn) -> tuple[dict | None, str, str]:
        # Explicitly reject legacy raw X-Staff-Id header spoofing
        spoof_hdr = self.headers.get("X-Staff-Id", "").strip()
        token, auth_source = self._extract_session_token()
        if spoof_hdr and not token:
            return None, "spoof_header", auth_source
        if not token:
            return None, "none", auth_source

        tok_hash = hash_token(token)
        now = time.time()
        row = conn.execute(
            """
            SELECT s.token_hash, s.expires_at, s.last_seen_at, s.token_prefix,
                   st.id, st.name, st.username, st.email, st.designation, st.role, st.department,
                   st.assigned_wards_json, st.is_active, st.permissions_json, st.is_claimed
            FROM sessions s
            JOIN staff st ON s.staff_id = st.id
            WHERE s.token_hash = ?
            """,
            (tok_hash,),
        ).fetchone()
        if not row:
            return None, "invalid", auth_source
        if now > row["expires_at"] or (now - row["last_seen_at"]) > SESSION_IDLE_SECONDS:
            with transaction(conn):
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (tok_hash,))
            return None, "expired", auth_source
        if not row["is_active"]:
            return None, "inactive", auth_source

        with transaction(conn):
            conn.execute("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (now, tok_hash))
        return row_to_staff_dict(row), row["token_prefix"], auth_source

    def _bootstrap_required(self, conn) -> bool:
        env_sec = os.environ.get("PANCHAYAT_SECRETARY_PASSCODE", "").strip()
        if env_sec:
            return False
        claimed = conn.execute("SELECT COUNT(*) AS c FROM staff WHERE is_claimed = 1").fetchone()["c"]
        return claimed == 0

    def _cookie_header(self, token: str, clear: bool = False) -> tuple[str, str]:
        if clear:
            return (
                "Set-Cookie",
                f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned",
            )
        return (
            "Set-Cookie",
            f"{COOKIE_NAME}={token}; Path=/; Max-Age={SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned",
        )

    def _rate_limit_or_429(self, bucket: str, max_req: int, window_sec: int, conn) -> bool:
        ip = self._client_ip()
        ip_h = hash_ip(ip)
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
            self._send_json(
                429,
                {"ok": False, "error": "Too many requests. Please wait before trying again."},
                [("Retry-After", str(retry))],
            )
            return False
        return True

    def _get_sla_limit(self, conn) -> int:
        row = conn.execute("SELECT value FROM config WHERE key = 'slaLimitDays'").fetchone()
        return int(row["value"]) if row else 7

    def do_OPTIONS(self):
        origin = self._same_origin_header()
        self.send_response(204 if origin else 403)
        self._send_security_headers()
        if origin:
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        conn = get_connection(SQLITE_PATH)
        try:
            if path == "/api/health":
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "backend": "Python 3 + SQLite WAL",
                        "cEngineCompiled": os.path.exists(C_ENGINE_BIN),
                    },
                )
                return

            if path == "/api/auth/status":
                actor, _prefix, _src = self._authenticate(conn)
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "bootstrapRequired": self._bootstrap_required(conn),
                        "authenticated": actor is not None,
                        "user": staff_self_dto(actor) if actor else None,
                        "envPasscodeConfigured": bool(os.environ.get("PANCHAYAT_SECRETARY_PASSCODE", "").strip()),
                    },
                )
                return

            if path == "/api/public/overview":
                if not self._rate_limit_or_429("public_overview", 60, 60, conn):
                    return
                sla_limit = self._get_sla_limit(conn)
                g_rows = conn.execute("SELECT * FROM grievances ORDER BY created_at DESC").fetchall()
                resolved = [r for r in g_rows if r["status"] == "Resolved"]
                total_days = 0.0
                for r in resolved:
                    if r["resolved_at"]:
                        dt1 = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
                        dt2 = datetime.fromisoformat(r["resolved_at"].replace("Z", "+00:00"))
                        total_days += max(1.0, (dt2.timestamp() - dt1.timestamp()) / 86400.0)
                    else:
                        total_days += 3.0
                avg_days = round(total_days / len(resolved), 1) if resolved else 3.2
                rated = [r["rating"] for r in g_rows if r["rating"] is not None]
                avg_rating = round(sum(rated) / len(rated), 1) if rated else 4.6

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "slaLimitDays": sla_limit,
                        "stats": {
                            "resolvedCount": len(resolved) + 142,
                            "avgDays": f"{avg_days:.1f}",
                            "activeServicesCount": len(SERVICE_CATALOG),
                            "avgRating": f"{avg_rating:.1f}",
                        },
                        "recentWorks": [public_grievance_summary_dto(r, sla_limit) for r in g_rows[:6]],
                        "serviceCatalog": SERVICE_CATALOG,
                    },
                )
                return

            if path == "/api/staff/dashboard":
                actor, sess_prefix, _src = self._authenticate(conn)
                if not actor:
                    if sess_prefix == "spoof_header":
                        with transaction(conn):
                            append_security_alert(
                                conn,
                                "HIGH",
                                "SPOOFED_AUTH_HEADER",
                                "X-Staff-Id",
                                hash_ip(self._client_ip()),
                                "Rejected unauthenticated request attempting raw X-Staff-Id identity spoofing.",
                            )
                    self._send_json(401, {"ok": False, "error": "Authentication required."})
                    return

                sla_limit = self._get_sla_limit(conn)
                g_rows = conn.execute("SELECT * FROM grievances ORDER BY created_at DESC").fetchall()
                s_rows = conn.execute("SELECT * FROM services ORDER BY created_at DESC").fetchall()

                visible_grievances = []
                for g in g_rows:
                    same_dept = (
                        g["department"] == actor["department"]
                        or g["assigned_officer_id"] == actor["id"]
                    )
                    if call_c_rbac(actor, g["ward"], same_dept, "VIEW")["allowed"]:
                        visible_grievances.append(staff_grievance_dto(g, sla_limit, actor))

                visible_services = []
                for s in s_rows:
                    same_dept = (
                        s["department"] == actor["department"]
                        or s["assigned_officer_id"] == actor["id"]
                    )
                    if call_c_rbac(actor, s["ward"], same_dept, "VIEW")["allowed"]:
                        visible_services.append(staff_service_dto(s, sla_limit, actor))

                all_staff = [row_to_staff_dict(r) for r in conn.execute("SELECT * FROM staff ORDER BY created_at ASC").fetchall()]
                if actor["role"] == "SUPER_ADMIN" and actor["permissions"].get("canManageUsers"):
                    staff_out = [staff_self_dto(st) for st in all_staff]
                else:
                    staff_out = [staff_directory_min_dto(st) for st in all_staff if st["isActive"]]

                if actor["role"] == "SUPER_ADMIN":
                    aud_rows = conn.execute("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200").fetchall()
                    alert_rows = conn.execute("SELECT * FROM security_alerts ORDER BY timestamp DESC LIMIT 100").fetchall()
                else:
                    aud_rows = conn.execute(
                        "SELECT * FROM audit_logs WHERE actor_id = ? ORDER BY timestamp DESC LIMIT 100",
                        (actor["id"],),
                    ).fetchall()
                    alert_rows = []

                audit_out = [
                    {
                        "id": a["id"],
                        "timestamp": a["timestamp"],
                        "actorName": a["actor_name"],
                        "actorRole": a["actor_role"],
                        "sessionPrefix": a["session_prefix"],
                        "action": a["action"],
                        "targetId": a["target_id"],
                        "outcome": a["outcome"],
                        "details": a["details"],
                    }
                    for a in aud_rows
                ]
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

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "user": staff_self_dto(actor),
                        "slaLimitDays": sla_limit,
                        "grievances": visible_grievances,
                        "services": visible_services,
                        "staff": staff_out,
                        "auditLogs": audit_out,
                        "securityAlerts": alerts_out,
                    },
                )
                return

            self._send_json(404, {"ok": False, "error": "Endpoint not found."})
        finally:
            conn.close()

    def do_POST(self):
        if not self._check_csrf_and_origin():
            self._send_json(403, {"ok": False, "error": "Cross-origin state change rejected."})
            return

        path = urlparse(self.path).path
        body = self._read_json()
        if body is None:
            return

        conn = get_connection(SQLITE_PATH)
        ip_h = hash_ip(self._client_ip())
        try:
            # --- Auth: One-Time First-Run Bootstrap Claim ---
            if path == "/api/auth/bootstrap-claim":
                if not self._rate_limit_or_429("auth_bootstrap", 10, 60, conn):
                    return
                try:
                    ensure_allowed_keys(body, {"passcode"}, {"passcode"})
                    passcode = str(body["passcode"])
                    ok, err = validate_passcode_strength(passcode)
                    if not ok:
                        self._send_json(400, {"ok": False, "error": err})
                        return
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                new_hash = hash_passcode(passcode)
                raw_tok = generate_opaque_token()
                tok_hash = hash_token(raw_tok)
                tok_prefix = raw_tok[:8]
                now = time.time()

                with transaction(conn):
                    if not self._bootstrap_required(conn):
                        self._send_json(
                            403,
                            {"ok": False, "error": "Initial Secretary setup has already been claimed."},
                        )
                        return
                    sec = conn.execute("SELECT * FROM staff WHERE id = 'stf-secretary'").fetchone()
                    if not sec:
                        self._send_json(500, {"ok": False, "error": "Secretary profile missing."})
                        return
                    conn.execute(
                        "UPDATE staff SET passcode_hash = ?, is_claimed = 1, updated_at = ? WHERE id = 'stf-secretary'",
                        (new_hash, now_iso()),
                    )
                    conn.execute(
                        """
                        INSERT INTO sessions(token_hash, staff_id, role, created_at, expires_at, last_seen_at, ip_hash, token_prefix)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (tok_hash, sec["id"], sec["role"], now, now + SESSION_TTL_SECONDS, now, ip_h, tok_prefix),
                    )
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
                    {"ok": True, "token": raw_tok, "user": staff_self_dto(sec_dict)},
                    [self._cookie_header(raw_tok)],
                )
                return

            # --- Auth: Staff Login ---
            if path == "/api/auth/login":
                if not self._rate_limit_or_429("auth_login", 10, 60, conn):
                    return
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
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

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
                    self._send_json(
                        423,
                        {"ok": False, "error": "Account temporarily locked due to repeated failed attempts. Try again later."},
                        [("Retry-After", str(wait_sec))],
                    )
                    return

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
                                "Sign-in attempted with unregistered email.",
                            )
                        time.sleep(0.25)
                    self._send_json(401, {"ok": False, "error": "Invalid official credentials."})
                    return

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
                    self._send_json(
                        403,
                        {"ok": False, "error": "This staff account is suspended. Contact the Panchayat Secretary."},
                    )
                    return

                raw_tok = generate_opaque_token()
                tok_hash = hash_token(raw_tok)
                tok_prefix = raw_tok[:8]
                with transaction(conn):
                    conn.execute(
                        "UPDATE staff SET failed_attempts = 0, locked_until = 0 WHERE id = ?",
                        (row["id"],),
                    )
                    conn.execute(
                        """
                        INSERT INTO sessions(token_hash, staff_id, role, created_at, expires_at, last_seen_at, ip_hash, token_prefix)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (tok_hash, row["id"], row["role"], now, now + SESSION_TTL_SECONDS, now, ip_h, tok_prefix),
                    )
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
                    {"ok": True, "token": raw_tok, "user": staff_self_dto(staff_dict)},
                    [self._cookie_header(raw_tok)],
                )
                return

            # --- Auth: Logout ---
            if path == "/api/auth/logout":
                tok, _src = self._extract_session_token()
                actor, prefix, _ = self._authenticate(conn)
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
                self._send_json(200, {"ok": True}, [self._cookie_header("", clear=True)])
                return

            # --- Public: Track with high-entropy token + mobile last-4 verification ---
            if path == "/api/public/track":
                if not self._rate_limit_or_429("public_track", 15, 60, conn):
                    return
                try:
                    tid, token, last4 = validate_tracking_query(body)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                sla_limit = self._get_sla_limit(conn)
                tok_h = hash_token(token)
                if tid.startswith("ABC-GRV-"):
                    row = conn.execute("SELECT * FROM grievances WHERE id = ?", (tid,)).fetchone()
                    if (
                        row
                        and hmac.compare_digest(row["tracking_token_hash"], tok_h)
                        and hmac.compare_digest(row["mobile_last4"], last4)
                    ):
                        self._send_json(200, {"ok": True, "record": citizen_tracked_grievance_dto(row, sla_limit)})
                        return
                elif tid.startswith("ABC-SRV-"):
                    row = conn.execute("SELECT * FROM services WHERE id = ?", (tid,)).fetchone()
                    if (
                        row
                        and hmac.compare_digest(row["tracking_token_hash"], tok_h)
                        and hmac.compare_digest(row["mobile_last4"], last4)
                    ):
                        self._send_json(200, {"ok": True, "record": citizen_tracked_service_dto(row, sla_limit)})
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
                self._send_json(
                    404,
                    {"ok": False, "error": "Record not found or verification credentials invalid."},
                )
                return

            # --- Public: Citizen Grievance Intake ---
            if path == "/api/public/grievances":
                if not self._rate_limit_or_429("public_grievance_create", 10, 60, conn):
                    return
                try:
                    clean = validate_grievance_create(body)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                raw_tk = generate_tracking_token()
                tk_hash = hash_token(raw_tk)
                ts = now_iso()
                dept = CATEGORY_DEPARTMENT_MAP.get(clean["category"], "General Administration")

                with transaction(conn):
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

                    timeline = [
                        {
                            "id": f"tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": "Grievance Registered",
                            "actor": f"{clean['citizenName']} (Citizen)",
                            "remark": f"Filed for Ward {clean['ward']} ({clean['category']}).",
                            "statusLabel": "Pending",
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
                            id, citizen_name, mobile, mobile_last4, ward, category, department,
                            landmark, description, status, created_at, updated_at, resolved_at,
                            assigned_officer_id, assigned_officer_name, filed_by_role,
                            before_photo_url, after_photo_url, public_remark, internal_remark,
                            rating, feedback_comment, timeline_json, tracking_token_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, NULL, ?, ?, 'CITIZEN', ?, NULL, ?, NULL, NULL, NULL, ?, ?)
                        """,
                        (
                            ticket_id,
                            clean["citizenName"],
                            clean["mobile"],
                            clean["mobile"][-4:],
                            clean["ward"],
                            clean["category"],
                            dept,
                            clean["landmark"],
                            clean["description"],
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
                    sla_limit = self._get_sla_limit(conn)

                receipt = citizen_tracked_grievance_dto(created_row, sla_limit)
                receipt["citizenName"] = clean["citizenName"]
                receipt["mobileLast4"] = clean["mobile"][-4:]
                self._send_json(201, {"ok": True, "ticket": receipt, "trackingToken": raw_tk})
                return

            # --- Public: Citizen Feedback (requires trackingToken + mobileLast4 + Resolved status) ---
            if path.startswith("/api/public/grievances/") and path.endswith("/feedback"):
                if not self._rate_limit_or_429("public_feedback", 10, 60, conn):
                    return
                parts = path.strip("/").split("/")
                if len(parts) != 5:
                    self._send_json(400, {"ok": False, "error": "Invalid grievance feedback path."})
                    return
                ticket_id = parts[3].upper()
                try:
                    ensure_allowed_keys(body, {"trackingToken", "mobileLast4", "rating", "comment"}, {"trackingToken", "mobileLast4", "rating"})
                    token = normalize_text(body["trackingToken"], 128, 8, "trackingToken")
                    last4 = normalize_text(str(body["mobileLast4"]), 4, 4, "mobileLast4")
                    rating = int(body["rating"])
                    if rating < 1 or rating > 5:
                        raise ValueError("Rating must be between 1 and 5.")
                    comment = normalize_text(body.get("comment") or "", 400, 0, "comment")
                except (ValueError, TypeError) as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                if (
                    not row
                    or not hmac.compare_digest(row["tracking_token_hash"], hash_token(token))
                    or not hmac.compare_digest(row["mobile_last4"], last4)
                ):
                    self._send_json(403, {"ok": False, "error": "Verification failed for this grievance."})
                    return
                if row["status"] != "Resolved":
                    self._send_json(400, {"ok": False, "error": "Feedback can only be submitted once resolved."})
                    return

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

                self._send_json(200, {"ok": True, "record": citizen_tracked_grievance_dto(updated_row, sla_limit)})
                return

            # --- Public: Citizen Service Application Intake ---
            if path == "/api/public/services":
                if not self._rate_limit_or_429("public_service_create", 10, 60, conn):
                    return
                valid_sids = {c["id"] for c in SERVICE_CATALOG}
                try:
                    clean = validate_service_create(body, valid_sids)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                catalog = next(c for c in SERVICE_CATALOG if c["id"] == clean["serviceId"])
                raw_tk = generate_tracking_token()
                tk_hash = hash_token(raw_tk)
                ts = now_iso()

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
                            id, service_id, service_name, applicant_name, mobile, mobile_last4,
                            ward, address, department, fee_inr, status, created_at, updated_at,
                            checked_docs_json, uploaded_doc_names_json, assigned_officer_id,
                            assigned_officer_name, filed_by_role, official_remark, timeline_json,
                            tracking_token_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, NULL, NULL, 'CITIZEN', ?, ?, ?)
                        """,
                        (
                            app_id,
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
                self._send_json(201, {"ok": True, "application": receipt, "trackingToken": raw_tk})
                return

            # --- Authenticated Staff Routes ---
            actor, sess_prefix, _ = self._authenticate(conn)
            if not actor:
                self._send_json(401, {"ok": False, "error": "Authentication required."})
                return

            # Walk-in Grievance Intake (CSC / Super Admin)
            if path == "/api/staff/grievances":
                try:
                    clean = validate_grievance_create(body)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return
                rbac = call_c_rbac(actor, clean["ward"], True, "CREATE_WALKIN")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(conn, "MEDIUM", "FORBIDDEN_ACTION", actor["email"], ip_h, rbac["reason"])
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return

                raw_tk = generate_tracking_token()
                tk_hash = hash_token(raw_tk)
                ts = now_iso()
                dept = CATEGORY_DEPARTMENT_MAP.get(clean["category"], "General Administration")
                with transaction(conn):
                    ids = [r["id"] for r in conn.execute("SELECT id FROM grievances").fetchall()]
                    nums = [int(x.split("-")[-1]) for x in ids if x.split("-")[-1].isdigit()]
                    ticket_id = f"ABC-GRV-2026-{max([108] + nums) + 1}"
                    timeline = [
                        {
                            "id": f"tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": "Walk-in Grievance Registered",
                            "actor": f"{actor['name']} ({actor['designation']})",
                            "remark": f"Walk-in filed for Ward {clean['ward']} ({clean['category']}).",
                            "statusLabel": "Pending",
                        }
                    ]
                    conn.execute(
                        """
                        INSERT INTO grievances(
                            id, citizen_name, mobile, mobile_last4, ward, category, department,
                            landmark, description, status, created_at, updated_at, resolved_at,
                            assigned_officer_id, assigned_officer_name, filed_by_role,
                            before_photo_url, after_photo_url, public_remark, internal_remark,
                            rating, feedback_comment, timeline_json, tracking_token_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?)
                        """,
                        (
                            ticket_id,
                            clean["citizenName"],
                            clean["mobile"],
                            clean["mobile"][-4:],
                            clean["ward"],
                            clean["category"],
                            dept,
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
                    sla_limit = self._get_sla_limit(conn)

                self._send_json(
                    201,
                    {"ok": True, "ticket": staff_grievance_dto(created_row, sla_limit, actor), "trackingToken": raw_tk},
                )
                return

            # Walk-in Service Intake (CSC / Super Admin)
            if path == "/api/staff/services":
                valid_sids = {c["id"] for c in SERVICE_CATALOG}
                try:
                    clean = validate_service_create(body, valid_sids)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return
                rbac = call_c_rbac(actor, clean["ward"], True, "CREATE_WALKIN")
                if not rbac["allowed"]:
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return

                catalog = next(c for c in SERVICE_CATALOG if c["id"] == clean["serviceId"])
                raw_tk = generate_tracking_token()
                tk_hash = hash_token(raw_tk)
                ts = now_iso()
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
                            id, service_id, service_name, applicant_name, mobile, mobile_last4,
                            ward, address, department, fee_inr, status, created_at, updated_at,
                            checked_docs_json, uploaded_doc_names_json, assigned_officer_id,
                            assigned_officer_name, filed_by_role, official_remark, timeline_json,
                            tracking_token_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
                        """,
                        (
                            app_id,
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

                self._send_json(
                    201,
                    {"ok": True, "application": staff_service_dto(created_row, sla_limit, actor), "trackingToken": raw_tk},
                )
                return

            # Create Staff Account (Super Admin)
            if path == "/api/staff/users":
                rbac = call_c_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(
                            conn, "HIGH", "PRIVILEGE_ESCALATION_ATTEMPT", actor["email"], ip_h, rbac["reason"]
                        )
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return
                try:
                    clean = validate_staff_payload(body, is_create=True)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                with transaction(conn):
                    if conn.execute("SELECT 1 FROM staff WHERE email = ?", (clean["email"],)).fetchone():
                        self._send_json(400, {"ok": False, "error": "Another staff account already uses this email."})
                        return
                    uname = clean.get("username")
                    if uname and conn.execute("SELECT 1 FROM staff WHERE lower(username) = ?", (uname,)).fetchone():
                        self._send_json(400, {"ok": False, "error": "Another staff account already uses this User ID."})
                        return
                    new_id = f"stf-{int(time.time() * 1000)}"
                    ts = now_iso()
                    perms = clean.get("permissions") or dict(DEFAULT_ROLE_PERMISSIONS.get(clean["role"], {}))
                    p_hash = hash_passcode(clean["passcode"])
                    conn.execute(
                        """
                        INSERT INTO staff(
                            id, name, username, email, passcode_hash, designation, role, department,
                            assigned_wards_json, is_active, permissions_json,
                            failed_attempts, locked_until, is_claimed, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)
                        """,
                        (
                            new_id,
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

                self._send_json(201, {"ok": True, "staff": staff_self_dto(created)})
                return

            # Toggle Staff Active Status (Super Admin)
            if path.startswith("/api/staff/users/") and path.endswith("/toggle"):
                staff_id = path.strip("/").split("/")[3]
                rbac = call_c_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return
                if staff_id == actor["id"]:
                    self._send_json(400, {"ok": False, "error": "You cannot suspend your own active session account."})
                    return
                with transaction(conn):
                    target = conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()
                    if not target:
                        self._send_json(404, {"ok": False, "error": "Staff account not found."})
                        return
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
                    self._send_json(403, {"ok": False, "error": "Maintenance reset is disabled in production builds."})
                    return
                rbac = call_c_rbac(actor, 1, True, "MAINTENANCE_RESET")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(
                            conn, "CRITICAL", "UNAUTHORIZED_MAINTENANCE_RESET", actor["email"], ip_h, rbac["reason"]
                        )
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return
                try:
                    ensure_allowed_keys(body, {"confirmPhrase", "maintenanceKey"}, {"confirmPhrase"})
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return
                if body.get("confirmPhrase") != "CONFIRM_PORTAL_RESET":
                    self._send_json(400, {"ok": False, "error": "Explicit confirmation phrase required."})
                    return
                env_maint = os.environ.get("PANCHAYAT_MAINTENANCE_KEY", "").strip()
                if env_maint and not hmac.compare_digest(str(body.get("maintenanceKey", "")), env_maint):
                    self._send_json(403, {"ok": False, "error": "Invalid maintenance authorization key."})
                    return

                with transaction(conn):
                    reset_database_with_audit(conn, actor, sess_prefix, ip_h)
                self._send_json(200, {"ok": True}, [self._cookie_header("", clear=True)])
                return

            self._send_json(404, {"ok": False, "error": "Endpoint not found."})
        finally:
            conn.close()

    def do_PATCH(self):
        if not self._check_csrf_and_origin():
            self._send_json(403, {"ok": False, "error": "Cross-origin state change rejected."})
            return

        path = urlparse(self.path).path
        body = self._read_json()
        if body is None:
            return

        conn = get_connection(SQLITE_PATH)
        ip_h = hash_ip(self._client_ip())
        try:
            actor, sess_prefix, _ = self._authenticate(conn)
            if not actor:
                self._send_json(401, {"ok": False, "error": "Authentication required."})
                return

            if path.startswith("/api/staff/grievances/"):
                ticket_id = path.strip("/").split("/")[-1]
                try:
                    patch = validate_grievance_patch(body)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                with transaction(conn):
                    ticket = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    if not ticket:
                        self._send_json(404, {"ok": False, "error": "Ticket not found."})
                        return

                    same_dept = (
                        ticket["department"] == actor["department"]
                        or ticket["assigned_officer_id"] == actor["id"]
                    )
                    rbac_upd = call_c_rbac(actor, ticket["ward"], same_dept, "UPDATE")
                    if not rbac_upd["allowed"]:
                        append_security_alert(
                            conn, "MEDIUM", "FORBIDDEN_RECORD_UPDATE", actor["email"], ip_h, f"{ticket_id}: {rbac_upd['reason']}"
                        )
                        self._send_json(403, {"ok": False, "error": rbac_upd["reason"]})
                        return

                    if "assignedOfficerId" in patch and patch["assignedOfficerId"] != ticket["assigned_officer_id"]:
                        rbac_assign = call_c_rbac(actor, ticket["ward"], same_dept, "ASSIGN")
                        if not rbac_assign["allowed"]:
                            append_security_alert(
                                conn, "MEDIUM", "FORBIDDEN_ASSIGNMENT", actor["email"], ip_h, f"{ticket_id}: {rbac_assign['reason']}"
                            )
                            self._send_json(403, {"ok": False, "error": rbac_assign["reason"]})
                            return

                    next_status = patch.get("status", ticket["status"])
                    officer_id = patch["assignedOfficerId"] if "assignedOfficerId" in patch else ticket["assigned_officer_id"]
                    assigned_name = ticket["assigned_officer_name"]
                    if "assignedOfficerId" in patch:
                        if officer_id:
                            off_row = conn.execute("SELECT id, name, is_active FROM staff WHERE id = ?", (officer_id,)).fetchone()
                            if not off_row or not off_row["is_active"]:
                                self._send_json(400, {"ok": False, "error": "Selected officer is inactive or invalid."})
                                return
                            assigned_name = off_row["name"]
                        else:
                            assigned_name = None

                    ts = now_iso()
                    resolved_at = ticket["resolved_at"]
                    if next_status == "Resolved" and not resolved_at:
                        resolved_at = ts

                    pub_remark = patch.get("publicRemark", ticket["public_remark"])
                    int_remark = patch.get("internalRemark", ticket["internal_remark"])
                    after_photo = patch.get("afterPhotoUrl", ticket["after_photo_url"])

                    timeline = json.loads(ticket["timeline_json"])
                    step_title = (
                        f"Status updated to {next_status}"
                        if next_status != ticket["status"]
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
                        SET status = ?, updated_at = ?, resolved_at = ?,
                            assigned_officer_id = ?, assigned_officer_name = ?,
                            public_remark = ?, internal_remark = ?, after_photo_url = ?,
                            timeline_json = ?
                        WHERE id = ?
                        """,
                        (
                            next_status,
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
                    append_audit_event(
                        conn,
                        actor["id"],
                        actor["name"],
                        actor["role"],
                        sess_prefix,
                        ip_h,
                        "TICKET_RESOLVED" if next_status == "Resolved" else "TICKET_UPDATED",
                        ticket_id,
                        "SUCCESS",
                        f"Ticket {ticket_id} updated ({step_title}) by {actor['name']}.",
                    )
                    updated_row = conn.execute("SELECT * FROM grievances WHERE id = ?", (ticket_id,)).fetchone()
                    sla_limit = self._get_sla_limit(conn)

                self._send_json(200, {"ok": True, "ticket": staff_grievance_dto(updated_row, sla_limit, actor)})
                return

            if path.startswith("/api/staff/services/"):
                app_id = path.strip("/").split("/")[-1]
                try:
                    patch = validate_service_patch(body)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                with transaction(conn):
                    app = conn.execute("SELECT * FROM services WHERE id = ?", (app_id,)).fetchone()
                    if not app:
                        self._send_json(404, {"ok": False, "error": "Application not found."})
                        return

                    same_dept = (
                        app["department"] == actor["department"]
                        or app["assigned_officer_id"] == actor["id"]
                    )
                    rbac_upd = call_c_rbac(actor, app["ward"], same_dept, "UPDATE")
                    if not rbac_upd["allowed"]:
                        append_security_alert(
                            conn, "MEDIUM", "FORBIDDEN_SERVICE_UPDATE", actor["email"], ip_h, f"{app_id}: {rbac_upd['reason']}"
                        )
                        self._send_json(403, {"ok": False, "error": rbac_upd["reason"]})
                        return

                    next_status = patch.get("status", app["status"])
                    if next_status == "Approved":
                        rbac_app = call_c_rbac(actor, app["ward"], same_dept, "APPROVE_CERT")
                        if not rbac_app["allowed"]:
                            append_security_alert(
                                conn, "HIGH", "UNAUTHORIZED_CERT_APPROVAL", actor["email"], ip_h, f"{app_id}: {rbac_app['reason']}"
                            )
                            self._send_json(403, {"ok": False, "error": rbac_app["reason"]})
                            return

                    if next_status in ("Documents Verified", "Correction Needed"):
                        rbac_ver = call_c_rbac(actor, app["ward"], same_dept, "VERIFY")
                        if not rbac_ver["allowed"]:
                            self._send_json(403, {"ok": False, "error": rbac_ver["reason"]})
                            return

                    if "assignedOfficerId" in patch and patch["assignedOfficerId"] != app["assigned_officer_id"]:
                        rbac_assign = call_c_rbac(actor, app["ward"], same_dept, "ASSIGN")
                        if not rbac_assign["allowed"]:
                            self._send_json(403, {"ok": False, "error": rbac_assign["reason"]})
                            return

                    officer_id = patch["assignedOfficerId"] if "assignedOfficerId" in patch else app["assigned_officer_id"]
                    assigned_name = app["assigned_officer_name"]
                    if "assignedOfficerId" in patch:
                        if officer_id:
                            off_row = conn.execute("SELECT id, name, is_active FROM staff WHERE id = ?", (officer_id,)).fetchone()
                            if not off_row or not off_row["is_active"]:
                                self._send_json(400, {"ok": False, "error": "Selected officer is inactive or invalid."})
                                return
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

            self._send_json(404, {"ok": False, "error": "Endpoint not found."})
        finally:
            conn.close()

    def do_PUT(self):
        if not self._check_csrf_and_origin():
            self._send_json(403, {"ok": False, "error": "Cross-origin state change rejected."})
            return

        path = urlparse(self.path).path
        body = self._read_json()
        if body is None:
            return

        conn = get_connection(SQLITE_PATH)
        ip_h = hash_ip(self._client_ip())
        try:
            actor, sess_prefix, _ = self._authenticate(conn)
            if not actor:
                self._send_json(401, {"ok": False, "error": "Authentication required."})
                return

            if path.startswith("/api/staff/users/"):
                staff_id = path.strip("/").split("/")[-1]
                rbac = call_c_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    with transaction(conn):
                        append_security_alert(
                            conn, "HIGH", "PRIVILEGE_ESCALATION_ATTEMPT", actor["email"], ip_h, rbac["reason"]
                        )
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return
                try:
                    clean = validate_staff_payload(body, is_create=False)
                except ValueError as ve:
                    self._send_json(400, {"ok": False, "error": str(ve)})
                    return

                with transaction(conn):
                    target = conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()
                    if not target:
                        self._send_json(404, {"ok": False, "error": "Staff account not found."})
                        return
                    email = clean.get("email", target["email"])
                    dup = conn.execute("SELECT 1 FROM staff WHERE email = ? AND id != ?", (email, staff_id)).fetchone()
                    if dup:
                        self._send_json(400, {"ok": False, "error": "Another staff account already uses this email."})
                        return
                    uname = clean["username"] if "username" in clean else target["username"]
                    if uname:
                        dup_u = conn.execute(
                            "SELECT 1 FROM staff WHERE lower(username) = ? AND id != ?",
                            (uname.lower(), staff_id),
                        ).fetchone()
                        if dup_u:
                            self._send_json(400, {"ok": False, "error": "Another staff account already uses this User ID."})
                            return

                    p_hash = target["passcode_hash"]
                    claimed = target["is_claimed"]
                    if "passcode" in clean:
                        p_hash = hash_passcode(clean["passcode"])
                        claimed = 1

                    next_role = clean.get("role", target["role"])
                    if staff_id == actor["id"] and next_role != "SUPER_ADMIN":
                        self._send_json(400, {"ok": False, "error": "Cannot demote your own active Super Admin session."})
                        return

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
                rbac = call_c_rbac(actor, 1, True, "MANAGE_SLA")
                if not rbac["allowed"]:
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return
                try:
                    ensure_allowed_keys(body, {"slaLimitDays"}, {"slaLimitDays"})
                    days = int(body["slaLimitDays"])
                except (ValueError, TypeError):
                    self._send_json(400, {"ok": False, "error": "SLA threshold must be an integer between 1 and 30."})
                    return
                if days < 1 or days > 30:
                    self._send_json(400, {"ok": False, "error": "SLA threshold must be between 1 and 30 days."})
                    return
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

            self._send_json(404, {"ok": False, "error": "Endpoint not found."})
        finally:
            conn.close()

    def do_DELETE(self):
        if not self._check_csrf_and_origin():
            self._send_json(403, {"ok": False, "error": "Cross-origin state change rejected."})
            return

        path = urlparse(self.path).path
        conn = get_connection(SQLITE_PATH)
        ip_h = hash_ip(self._client_ip())
        try:
            actor, sess_prefix, _ = self._authenticate(conn)
            if not actor:
                self._send_json(401, {"ok": False, "error": "Authentication required."})
                return

            rbac = call_c_rbac(actor, 1, True, "DELETE")
            if not rbac["allowed"]:
                with transaction(conn):
                    append_security_alert(conn, "HIGH", "UNAUTHORIZED_DELETE_ATTEMPT", actor["email"], ip_h, rbac["reason"])
                self._send_json(403, {"ok": False, "error": rbac["reason"]})
                return

            if path.startswith("/api/staff/grievances/"):
                ticket_id = path.strip("/").split("/")[-1]
                with transaction(conn):
                    res = conn.execute("DELETE FROM grievances WHERE id = ?", (ticket_id,))
                    if res.rowcount == 0:
                        self._send_json(404, {"ok": False, "error": "Ticket not found."})
                        return
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
                        f"Deleted grievance {ticket_id}.",
                    )
                self._send_json(200, {"ok": True})
                return

            if path.startswith("/api/staff/services/"):
                app_id = path.strip("/").split("/")[-1]
                with transaction(conn):
                    res = conn.execute("DELETE FROM services WHERE id = ?", (app_id,))
                    if res.rowcount == 0:
                        self._send_json(404, {"ok": False, "error": "Application not found."})
                        return
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
                        f"Deleted service application {app_id}.",
                    )
                self._send_json(200, {"ok": True})
                return

            self._send_json(404, {"ok": False, "error": "Endpoint not found."})
        finally:
            conn.close()


class ReusableThreadingServer(ThreadingHTTPServer):
    allow_reuse_address = True


def main():
    parser = argparse.ArgumentParser(description="ABC Gram Panchayat Hardened Python 3 + SQLite + C API Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args()

    init_db()
    server = ReusableThreadingServer((args.host, args.port), PanchayatApiHandler)
    print(f"Python 3 Hardened API server listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
