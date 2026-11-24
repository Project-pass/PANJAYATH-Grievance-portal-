import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import subprocess
import threading
import time
from urllib.parse import urlparse

from seed_data import (
    ALL_WARDS,
    CATEGORY_DEPARTMENT_MAP,
    DEFAULT_ROLE_PERMISSIONS,
    SERVICE_CATALOG,
    get_initial_state,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "portal_db.json")
C_ENGINE_BIN = os.path.join(BASE_DIR, "c_engine", "sla_rbac")

REFERENCE_MIN_NOW = datetime(2026, 11, 23, 23, 59, 0, tzinfo=timezone.utc).timestamp()
DB_LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def effective_now_ts():
    return max(time.time(), REFERENCE_MIN_NOW)


def ensure_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        with open(DB_PATH, "w", encoding="utf-8") as f:
            json.dump(get_initial_state(), f, indent=2)


def load_db():
    ensure_db()
    with open(DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_db(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def call_c_sla(created_at_iso, status, sla_limit_days):
    try:
        dt = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00"))
        age_days = max(0, int((effective_now_ts() - dt.timestamp()) // 86400))
    except Exception:
        age_days = 0
    is_closed = 1 if status in ("Resolved", "Rejected", "Approved") else 0

    if os.path.exists(C_ENGINE_BIN):
        proc = subprocess.run(
            [C_ENGINE_BIN, "sla", str(age_days), str(sla_limit_days), str(is_closed)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return json.loads(proc.stdout.strip())

    # Fallback in case C binary hasn't been compiled yet
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


def call_c_rbac(staff_member, target_ward, same_dept, action):
    if not staff_member or not staff_member.get("isActive", False):
        return {"allowed": False, "reason": "Staff account is inactive or missing."}

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

    if os.path.exists(C_ENGINE_BIN):
        proc = subprocess.run(
            [
                C_ENGINE_BIN,
                "rbac",
                str(role_code),
                str(perm_mask),
                str(ward_mask),
                str(int(target_ward)),
                "1" if same_dept else "0",
                action,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return json.loads(proc.stdout.strip())

    return {"allowed": role_code == 1, "reason": "Fallback check"}


def make_audit(actor_name, actor_role, action, target_id, details):
    return {
        "id": f"aud-{int(time.time() * 1000)}",
        "timestamp": now_iso(),
        "actorName": actor_name,
        "actorRole": actor_role,
        "action": action,
        "targetId": target_id,
        "details": details,
    }


def enrich_state_with_c_sla(state):
    sla_limit = state.get("slaLimitDays", 7)
    for g in state.get("grievances", []):
        g["sla"] = call_c_sla(g["createdAt"], g["status"], sla_limit)
    for s in state.get("services", []):
        s["sla"] = call_c_sla(s["createdAt"], s["status"], sla_limit)
    return state


class PanchayatApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress noisy per-request stderr logs
        return

    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def _get_actor(self, state):
        staff_id = self.headers.get("X-Staff-Id", "").strip()
        if not staff_id:
            return None
        for st in state.get("staff", []):
            if st["id"] == staff_id and st.get("isActive", False):
                return st
        return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "backend": "Python 3",
                    "cEngineCompiled": os.path.exists(C_ENGINE_BIN),
                },
            )
            return

        if path == "/api/state":
            with DB_LOCK:
                state = load_db()
                enriched = enrich_state_with_c_sla(state)
            self._send_json(200, enriched)
            return

        self._send_json(404, {"error": "Endpoint not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json()

        with DB_LOCK:
            state = load_db()
            actor = self._get_actor(state)

            if path == "/api/auth/login":
                email = str(body.get("email", "")).strip().lower()
                pin = str(body.get("pin", "")).strip()
                matched = next((s for s in state["staff"] if s["email"].lower() == email), None)
                if not matched or matched["pin"] != pin:
                    self._send_json(401, {"ok": False, "error": "Invalid official email or 4-digit access PIN."})
                    return
                if not matched.get("isActive", False):
                    self._send_json(
                        403,
                        {"ok": False, "error": "This staff account is currently suspended. Contact the Panchayat Secretary."},
                    )
                    return
                state["auditLogs"].insert(
                    0,
                    make_audit(
                        matched["name"],
                        matched["role"],
                        "STAFF_LOGIN",
                        matched["id"],
                        f"{matched['name']} ({matched['designation']}) signed into the Admin & Staff Portal.",
                    ),
                )
                save_db(state)
                self._send_json(200, {"ok": True, "staff": matched})
                return

            if path == "/api/reset":
                fresh = get_initial_state()
                save_db(fresh)
                self._send_json(200, enrich_state_with_c_sla(fresh))
                return

            if path == "/api/grievances":
                nums = [int(g["id"].split("-")[-1]) for g in state["grievances"] if g["id"].split("-")[-1].isdigit()]
                next_num = max([108] + nums) + 1
                ticket_id = f"ABC-GRV-2026-{next_num}"
                ts = now_iso()
                category = body.get("category", "Water Supply")
                ward = int(body.get("ward", 1))
                dept = CATEGORY_DEPARTMENT_MAP.get(category, "General Administration")

                auto_officer = next(
                    (
                        s
                        for s in state["staff"]
                        if s.get("isActive")
                        and s["role"] == "WARD_OFFICER"
                        and s["department"] == dept
                        and ward in s.get("assignedWards", [])
                    ),
                    None,
                )

                actor_label = (
                    f"{actor['name']} ({'CSC Operator' if actor['role'] == 'CSC_OPERATOR' else actor['designation']})"
                    if actor
                    else f"{body.get('citizenName', 'Citizen')} (Citizen)"
                )

                ticket = {
                    "id": ticket_id,
                    "citizenName": str(body.get("citizenName", "")).strip(),
                    "mobile": str(body.get("mobile", "")).strip(),
                    "ward": ward,
                    "category": category,
                    "department": dept,
                    "landmark": str(body.get("landmark", "")).strip(),
                    "description": str(body.get("description", "")).strip(),
                    "status": "Pending",
                    "createdAt": ts,
                    "updatedAt": ts,
                    "assignedOfficerId": auto_officer["id"] if auto_officer else None,
                    "assignedOfficerName": auto_officer["name"] if auto_officer else None,
                    "filedByRole": actor["role"] if actor else "CITIZEN",
                    "beforePhotoUrl": body.get("beforePhotoUrl") or None,
                    "publicRemark": (
                        f"Auto-routed to {auto_officer['name']} ({dept})."
                        if auto_officer
                        else "Queued at Panchayat Grievance Desk for officer assignment."
                    ),
                    "timeline": [
                        {
                            "id": f"tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": "Walk-in Grievance Registered" if actor else "Grievance Registered",
                            "actor": actor_label,
                            "remark": f"Filed for Ward {ward} ({category}).",
                            "statusLabel": "Pending",
                        }
                    ],
                }
                state["grievances"].insert(0, ticket)
                state["auditLogs"].insert(
                    0,
                    make_audit(
                        actor["name"] if actor else ticket["citizenName"],
                        actor["role"] if actor else "CITIZEN",
                        "GRIEVANCE_SUBMITTED",
                        ticket_id,
                        f"New grievance {ticket_id} registered for Ward {ward} ({category}).",
                    ),
                )
                save_db(state)
                ticket["sla"] = call_c_sla(ticket["createdAt"], ticket["status"], state["slaLimitDays"])
                self._send_json(201, {"ok": True, "ticket": ticket})
                return

            if path.startswith("/api/grievances/") and path.endswith("/feedback"):
                ticket_id = path.split("/")[3]
                rating = int(body.get("rating", 5))
                comment = str(body.get("comment", "")).strip()
                for g in state["grievances"]:
                    if g["id"] == ticket_id:
                        g["rating"] = rating
                        g["feedbackComment"] = comment or None
                        g["updatedAt"] = now_iso()
                        state["auditLogs"].insert(
                            0,
                            make_audit(
                                "Citizen Feedback",
                                "CITIZEN",
                                "FEEDBACK_SUBMITTED",
                                ticket_id,
                                f"Citizen rated resolution {rating}/5 stars on {ticket_id}.",
                            ),
                        )
                        save_db(state)
                        self._send_json(200, {"ok": True, "ticket": g})
                        return
                self._send_json(404, {"ok": False, "error": "Ticket not found."})
                return

            if path == "/api/services":
                nums = [int(s["id"].split("-")[-1]) for s in state["services"] if s["id"].split("-")[-1].isdigit()]
                next_num = max([205] + nums) + 1
                app_id = f"ABC-SRV-2026-{next_num}"
                ts = now_iso()
                service_id = body.get("serviceId", "residence")
                catalog = next((c for c in SERVICE_CATALOG if c["id"] == service_id), SERVICE_CATALOG[0])
                ward = int(body.get("ward", 1))
                actor_label = (
                    f"{actor['name']} ({'CSC Operator' if actor['role'] == 'CSC_OPERATOR' else actor['designation']})"
                    if actor
                    else f"{body.get('applicantName', 'Applicant')} (Citizen)"
                )

                app = {
                    "id": app_id,
                    "serviceId": catalog["id"],
                    "serviceName": catalog["titleEn"],
                    "applicantName": str(body.get("applicantName", "")).strip(),
                    "mobile": str(body.get("mobile", "")).strip(),
                    "ward": ward,
                    "address": str(body.get("address", "")).strip(),
                    "department": catalog["department"],
                    "feeInr": catalog["feeInr"],
                    "status": "Submitted",
                    "createdAt": ts,
                    "updatedAt": ts,
                    "checkedDocs": body.get("checkedDocs", []),
                    "uploadedDocNames": body.get("uploadedDocNames", []),
                    "filedByRole": actor["role"] if actor else "CITIZEN",
                    "officialRemark": "Application received. Pending initial CSC document verification.",
                    "timeline": [
                        {
                            "id": f"srv-tl-{int(time.time() * 1000)}",
                            "timestamp": ts,
                            "stepTitle": "Walk-in Application Submitted" if actor else "Application Submitted",
                            "actor": actor_label,
                            "remark": f"{catalog['titleEn']} application filed for Ward {ward}.",
                            "statusLabel": "Submitted",
                        }
                    ],
                }
                state["services"].insert(0, app)
                state["auditLogs"].insert(
                    0,
                    make_audit(
                        actor["name"] if actor else app["applicantName"],
                        actor["role"] if actor else "CITIZEN",
                        "SERVICE_APPLIED",
                        app_id,
                        f"Application {app_id} submitted for {catalog['titleEn']} (Ward {ward}).",
                    ),
                )
                save_db(state)
                self._send_json(201, {"ok": True, "application": app})
                return

            if path == "/api/staff":
                rbac = call_c_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return
                email = str(body.get("email", "")).strip().lower()
                if any(s["email"].lower() == email for s in state["staff"]):
                    self._send_json(400, {"ok": False, "error": "Another staff account already uses this email."})
                    return
                new_id = f"stf-{int(time.time() * 1000)}"
                role = body.get("role", "WARD_OFFICER")
                new_staff = {
                    "id": new_id,
                    "name": str(body.get("name", "")).strip(),
                    "email": email,
                    "pin": str(body.get("pin", "1234")).strip() or "1234",
                    "designation": str(body.get("designation", "")).strip(),
                    "role": role,
                    "department": body.get("department", "Roads & Streetlights"),
                    "assignedWards": body.get("assignedWards", [1]),
                    "isActive": bool(body.get("isActive", True)),
                    "permissions": body.get("permissions", dict(DEFAULT_ROLE_PERMISSIONS.get(role, {}))),
                }
                state["staff"].append(new_staff)
                state["auditLogs"].insert(
                    0,
                    make_audit(
                        actor["name"],
                        actor["role"],
                        "STAFF_CREATED",
                        new_id,
                        f"Created staff account {new_staff['name']} as {role} ({new_staff['department']}).",
                    ),
                )
                save_db(state)
                self._send_json(201, {"ok": True, "staff": new_staff})
                return

            if path.startswith("/api/staff/") and path.endswith("/toggle"):
                staff_id = path.split("/")[3]
                rbac = call_c_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return
                if actor and staff_id == actor["id"]:
                    self._send_json(400, {"ok": False, "error": "You cannot suspend your own active session account."})
                    return
                for s in state["staff"]:
                    if s["id"] == staff_id:
                        s["isActive"] = not s.get("isActive", True)
                        state["auditLogs"].insert(
                            0,
                            make_audit(
                                actor["name"],
                                actor["role"],
                                "STAFF_ACTIVATED" if s["isActive"] else "STAFF_SUSPENDED",
                                staff_id,
                                f"{'Activated' if s['isActive'] else 'Suspended'} staff account for {s['name']}.",
                            ),
                        )
                        save_db(state)
                        self._send_json(200, {"ok": True, "staff": s})
                        return
                self._send_json(404, {"ok": False, "error": "Staff account not found."})
                return

        self._send_json(404, {"error": "Endpoint not found"})

    def do_PATCH(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json()

        with DB_LOCK:
            state = load_db()
            actor = self._get_actor(state)
            if not actor:
                self._send_json(401, {"ok": False, "error": "Authentication required."})
                return

            if path.startswith("/api/grievances/"):
                ticket_id = path.split("/")[3]
                ticket = next((g for g in state["grievances"] if g["id"] == ticket_id), None)
                if not ticket:
                    self._send_json(404, {"ok": False, "error": "Ticket not found."})
                    return

                same_dept = (
                    ticket["department"] == actor["department"]
                    or ticket.get("assignedOfficerId") == actor["id"]
                )
                rbac_update = call_c_rbac(actor, ticket["ward"], same_dept, "UPDATE")
                if not rbac_update["allowed"]:
                    self._send_json(403, {"ok": False, "error": rbac_update["reason"]})
                    return

                if "assignedOfficerId" in body and body["assignedOfficerId"] != ticket.get("assignedOfficerId"):
                    rbac_assign = call_c_rbac(actor, ticket["ward"], same_dept, "ASSIGN")
                    if not rbac_assign["allowed"]:
                        self._send_json(403, {"ok": False, "error": rbac_assign["reason"]})
                        return

                ts = now_iso()
                next_status = body.get("status", ticket["status"])
                status_changed = next_status != ticket["status"]
                officer_id = body.get("assignedOfficerId", ticket.get("assignedOfficerId"))
                assigned_off = next((s for s in state["staff"] if s["id"] == officer_id), None) if officer_id else None

                step_title = (
                    f"Status updated to {next_status}"
                    if status_changed
                    else (
                        f"Assigned to {assigned_off['name']}"
                        if assigned_off and officer_id != ticket.get("assignedOfficerId")
                        else "Official Remark Updated"
                    )
                )

                remark_text = body.get("publicRemark") or f"Ticket updated by {actor['name']}."
                ticket["status"] = next_status
                ticket["updatedAt"] = ts
                if next_status == "Resolved" and not ticket.get("resolvedAt"):
                    ticket["resolvedAt"] = ts
                if "assignedOfficerId" in body:
                    ticket["assignedOfficerId"] = officer_id or None
                    ticket["assignedOfficerName"] = assigned_off["name"] if assigned_off else None
                if "publicRemark" in body:
                    ticket["publicRemark"] = body["publicRemark"]
                if "internalRemark" in body:
                    ticket["internalRemark"] = body["internalRemark"]
                if "afterPhotoUrl" in body:
                    ticket["afterPhotoUrl"] = body["afterPhotoUrl"] or None

                ticket["timeline"].append(
                    {
                        "id": f"tl-{int(time.time() * 1000)}",
                        "timestamp": ts,
                        "stepTitle": step_title,
                        "actor": f"{actor['name']} ({actor['designation']})",
                        "remark": remark_text,
                        "statusLabel": next_status,
                    }
                )
                state["auditLogs"].insert(
                    0,
                    make_audit(
                        actor["name"],
                        actor["role"],
                        "TICKET_RESOLVED" if next_status == "Resolved" else "TICKET_UPDATED",
                        ticket_id,
                        f"Ticket {ticket_id} updated ({step_title}) by {actor['name']}.",
                    ),
                )
                save_db(state)
                self._send_json(200, {"ok": True, "ticket": ticket})
                return

            if path.startswith("/api/services/"):
                app_id = path.split("/")[3]
                app = next((s for s in state["services"] if s["id"] == app_id), None)
                if not app:
                    self._send_json(404, {"ok": False, "error": "Application not found."})
                    return

                same_dept = (
                    app["department"] == actor["department"]
                    or app.get("assignedOfficerId") == actor["id"]
                )
                rbac_update = call_c_rbac(actor, app["ward"], same_dept, "UPDATE")
                if not rbac_update["allowed"]:
                    self._send_json(403, {"ok": False, "error": rbac_update["reason"]})
                    return

                next_status = body.get("status", app["status"])
                if next_status == "Approved":
                    rbac_approve = call_c_rbac(actor, app["ward"], same_dept, "APPROVE_CERT")
                    if not rbac_approve["allowed"]:
                        self._send_json(403, {"ok": False, "error": rbac_approve["reason"]})
                        return

                if next_status in ("Documents Verified", "Correction Needed"):
                    rbac_verify = call_c_rbac(actor, app["ward"], same_dept, "VERIFY")
                    if not rbac_verify["allowed"]:
                        self._send_json(403, {"ok": False, "error": rbac_verify["reason"]})
                        return

                ts = now_iso()
                officer_id = body.get("assignedOfficerId", app.get("assignedOfficerId"))
                assigned_off = next((s for s in state["staff"] if s["id"] == officer_id), None) if officer_id else None

                app["status"] = next_status
                app["updatedAt"] = ts
                if "assignedOfficerId" in body:
                    app["assignedOfficerId"] = officer_id or None
                    app["assignedOfficerName"] = assigned_off["name"] if assigned_off else None
                if "officialRemark" in body:
                    app["officialRemark"] = body["officialRemark"]

                app["timeline"].append(
                    {
                        "id": f"srv-tl-{int(time.time() * 1000)}",
                        "timestamp": ts,
                        "stepTitle": f"Status: {next_status}",
                        "actor": f"{actor['name']} ({actor['designation']})",
                        "remark": body.get("officialRemark") or f"Updated to {next_status} by {actor['name']}.",
                        "statusLabel": next_status,
                    }
                )
                state["auditLogs"].insert(
                    0,
                    make_audit(
                        actor["name"],
                        actor["role"],
                        "CERTIFICATE_APPROVED" if next_status == "Approved" else "SERVICE_UPDATED",
                        app_id,
                        f"Service {app_id} ({app['serviceName']}) updated to {next_status} by {actor['name']}.",
                    ),
                )
                save_db(state)
                self._send_json(200, {"ok": True, "application": app})
                return

        self._send_json(404, {"error": "Endpoint not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json()

        with DB_LOCK:
            state = load_db()
            actor = self._get_actor(state)
            if not actor:
                self._send_json(401, {"ok": False, "error": "Authentication required."})
                return

            if path.startswith("/api/staff/"):
                staff_id = path.split("/")[3]
                rbac = call_c_rbac(actor, 1, True, "MANAGE_USERS")
                if not rbac["allowed"]:
                    self._send_json(403, {"ok": False, "error": rbac["reason"]})
                    return

                email = str(body.get("email", "")).strip().lower()
                if any(s["email"].lower() == email and s["id"] != staff_id for s in state["staff"]):
                    self._send_json(400, {"ok": False, "error": "Another staff account already uses this email."})
                    return

                for s in state["staff"]:
                    if s["id"] == staff_id:
                        s["name"] = str(body.get("name", s["name"])).strip()
                        s["email"] = email or s["email"]
                        s["pin"] = str(body.get("pin", s["pin"])).strip() or s["pin"]
                        s["designation"] = str(body.get("designation", s["designation"])).strip()
                        s["role"] = body.get("role", s["role"])
                        s["department"] = body.get("department", s["department"])
                        s["assignedWards"] = body.get("assignedWards", s["assignedWards"])
                        s["isActive"] = bool(body.get("isActive", s["isActive"]))
                        s["permissions"] = body.get("permissions", s["permissions"])
                        state["auditLogs"].insert(
                            0,
                            make_audit(
                                actor["name"],
                                actor["role"],
                                "ROLE_UPDATED",
                                staff_id,
                                f"Updated staff role & permissions for {s['name']} ({s['role']}, Wards: {len(s['assignedWards'])}).",
                            ),
                        )
                        save_db(state)
                        self._send_json(200, {"ok": True, "staff": s})
                        return
                self._send_json(404, {"ok": False, "error": "Staff account not found."})
                return

            if path == "/api/config/sla":
                if actor["role"] != "SUPER_ADMIN":
                    self._send_json(403, {"ok": False, "error": "Only Panchayat Secretary can modify SLA policy."})
                    return
                days = max(1, min(30, int(body.get("slaLimitDays", 7))))
                state["slaLimitDays"] = days
                state["auditLogs"].insert(
                    0,
                    make_audit(
                        actor["name"],
                        actor["role"],
                        "SLA_POLICY_UPDATED",
                        "SLA_CONFIG",
                        f"Updated Panchayat grievance SLA threshold to {days} days.",
                    ),
                )
                save_db(state)
                self._send_json(200, {"ok": True, "slaLimitDays": days})
                return

        self._send_json(404, {"error": "Endpoint not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        with DB_LOCK:
            state = load_db()
            actor = self._get_actor(state)
            rbac = call_c_rbac(actor, 1, True, "DELETE")
            if not rbac["allowed"]:
                self._send_json(403, {"ok": False, "error": rbac["reason"]})
                return

            if path.startswith("/api/grievances/"):
                ticket_id = path.split("/")[3]
                state["grievances"] = [g for g in state["grievances"] if g["id"] != ticket_id]
                state["auditLogs"].insert(
                    0,
                    make_audit(actor["name"], actor["role"], "RECORD_DELETED", ticket_id, f"Deleted grievance {ticket_id}."),
                )
                save_db(state)
                self._send_json(200, {"ok": True})
                return

            if path.startswith("/api/services/"):
                app_id = path.split("/")[3]
                state["services"] = [s for s in state["services"] if s["id"] != app_id]
                state["auditLogs"].insert(
                    0,
                    make_audit(actor["name"], actor["role"], "RECORD_DELETED", app_id, f"Deleted service application {app_id}."),
                )
                save_db(state)
                self._send_json(200, {"ok": True})
                return

        self._send_json(404, {"error": "Endpoint not found"})


class ReusableThreadingServer(ThreadingHTTPServer):
    allow_reuse_address = True


def main():
    parser = argparse.ArgumentParser(description="ABC Gram Panchayat Python 3 + C API Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args()

    ensure_db()
    server = ReusableThreadingServer((args.host, args.port), PanchayatApiHandler)
    print(f"Python 3 API server listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
