from __future__ import annotations

from dataclasses import dataclass

# Canonical Grievance Lifecycle States
CANONICAL_GRIEVANCE_STATUSES = (
    "SUBMITTED",
    "ACKNOWLEDGED",
    "ASSIGNED",
    "IN_PROGRESS",
    "ON_HOLD",
    "ESCALATED",
    "RESOLVED",
    "CLOSED",
    "REJECTED",
    "REOPENED",
)

# Legacy status aliases mapped cleanly for backward compatibility and DB migration
LEGACY_STATUS_MAP = {
    "Pending": "SUBMITTED",
    "In Progress": "IN_PROGRESS",
    "Field Inspection": "IN_PROGRESS",
    "Resolved": "RESOLVED",
    "Rejected": "REJECTED",
}

CLOSED_OR_DONE_GRIEVANCE_STATUSES = {"RESOLVED", "CLOSED", "REJECTED"}

# Explicit State Transition Matrix: current_status -> allowed next statuses
GRIEVANCE_TRANSITIONS: dict[str, set[str]] = {
    "SUBMITTED": {"ACKNOWLEDGED", "ASSIGNED", "IN_PROGRESS", "ESCALATED", "REJECTED"},
    "ACKNOWLEDGED": {"ASSIGNED", "IN_PROGRESS", "ON_HOLD", "ESCALATED", "REJECTED"},
    "ASSIGNED": {"IN_PROGRESS", "ON_HOLD", "ESCALATED", "RESOLVED", "REJECTED"},
    "IN_PROGRESS": {"ON_HOLD", "ESCALATED", "RESOLVED", "REJECTED"},
    "ON_HOLD": {"ASSIGNED", "IN_PROGRESS", "ESCALATED", "RESOLVED", "REJECTED"},
    "ESCALATED": {"ASSIGNED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "REJECTED"},
    "RESOLVED": {"CLOSED", "REOPENED"},
    "CLOSED": {"REOPENED"},
    "REJECTED": {"REOPENED"},
    "REOPENED": {"ACKNOWLEDGED", "ASSIGNED", "IN_PROGRESS", "ESCALATED", "REJECTED"},
}

NOTE_REQUIRED_STATUSES = {"RESOLVED", "REJECTED", "ON_HOLD", "ESCALATED", "REOPENED"}

CANONICAL_SERVICE_STATUSES = (
    "Submitted",
    "Pending Verification",
    "Documents Verified",
    "Correction Needed",
    "Approved",
    "Rejected",
)


def normalize_grievance_status(status: str) -> str:
    if status in CANONICAL_GRIEVANCE_STATUSES:
        return status
    return LEGACY_STATUS_MAP.get(status, status.upper().replace(" ", "_"))


@dataclass(frozen=True)
class RbacDecision:
    allowed: bool
    reason: str


def evaluate_rbac(
    staff_member: dict | None,
    target_ward: int,
    same_dept: bool,
    action: str,
) -> RbacDecision:
    """Authoritative deny-by-default Python RBAC evaluator."""
    if not staff_member or not staff_member.get("isActive", False):
        return RbacDecision(False, "Staff account is inactive or unauthenticated.")

    role = str(staff_member.get("role", "CITIZEN")).upper()
    if role == "CITIZEN":
        return RbacDecision(False, "Citizen role has no administrative privileges.")

    try:
        ward_num = int(target_ward)
    except (TypeError, ValueError):
        return RbacDecision(False, "Invalid target ward parameter.")
    if ward_num < 1 or ward_num > 15:
        return RbacDecision(False, "Target ward outside valid Panchayat range (1–15).")

    perms = staff_member.get("permissions") or {}
    assigned_wards = {int(w) for w in (staff_member.get("assignedWards") or []) if 1 <= int(w) <= 15}
    in_ward = (role in ("SUPER_ADMIN", "CSC_OPERATOR")) or (ward_num in assigned_wards)

    if action == "VIEW":
        if role in ("SUPER_ADMIN", "CSC_OPERATOR"):
            return RbacDecision(True, "Full ward visibility granted.")
        if role == "WARD_OFFICER" and in_ward and same_dept:
            return RbacDecision(True, "Ward and department jurisdiction matched.")
        return RbacDecision(False, "Outside assigned ward or department scope.")

    if action == "CREATE_WALKIN":
        if role in ("SUPER_ADMIN", "CSC_OPERATOR"):
            return RbacDecision(True, "Authorized for walk-in intake.")
        return RbacDecision(False, "Walk-in intake restricted to CSC Operator or Panchayat Secretary.")

    if action == "UPDATE":
        if role == "SUPER_ADMIN":
            return RbacDecision(True, "Authorized to update record.")
        if role == "CSC_OPERATOR":
            return RbacDecision(True, "CSC desk update authorized for acknowledgement/verification.")
        if role == "WARD_OFFICER" and in_ward and same_dept:
            return RbacDecision(True, "Ward officer update permitted within jurisdiction.")
        return RbacDecision(False, "Cannot modify ticket outside assigned ward/department.")

    if action == "ASSIGN":
        if role == "SUPER_ADMIN" or (perms.get("canAssignTickets") and in_ward and same_dept):
            return RbacDecision(True, "Ticket assignment permission verified.")
        return RbacDecision(False, "Permission denied: Assign Tickets authority required.")

    if action == "VERIFY":
        if role == "SUPER_ADMIN" or (
            perms.get("canVerifyDocuments")
            and (role == "CSC_OPERATOR" or (in_ward and same_dept))
        ):
            return RbacDecision(True, "Document verification permission verified.")
        return RbacDecision(False, "Permission denied: Verify Documents authority required.")

    if action == "APPROVE_CERT":
        if role == "SUPER_ADMIN" and perms.get("canApproveCertificates"):
            return RbacDecision(True, "Certificate approval authority verified.")
        if perms.get("canApproveCertificates") and in_ward and same_dept:
            return RbacDecision(True, "Delegated certificate approval verified within jurisdiction.")
        return RbacDecision(False, "Permission denied: Approve Certificates authority required.")

    if action == "MANAGE_USERS":
        if role == "SUPER_ADMIN" and perms.get("canManageUsers"):
            return RbacDecision(True, "User and RBAC management authority verified.")
        return RbacDecision(False, "Permission denied: Manage Users authority required.")

    if action == "DELETE":
        if role == "SUPER_ADMIN" and perms.get("canDeleteRecords"):
            return RbacDecision(True, "Record deletion authority verified.")
        return RbacDecision(False, "Permission denied: Delete Records authority required.")

    if action in ("MANAGE_SLA", "MAINTENANCE_RESET", "EXPORT_AUDIT", "VIEW_SECURITY_ALERTS"):
        if role == "SUPER_ADMIN":
            return RbacDecision(True, "Super Admin administrative action verified.")
        return RbacDecision(False, "Permission denied: Super Admin authority required.")

    return RbacDecision(False, "Unknown RBAC action denied by default.")


def validate_grievance_transition(
    actor_role: str,
    current_status: str,
    next_status: str,
    note: str | None,
) -> tuple[bool, str]:
    curr = normalize_grievance_status(current_status)
    nxt = normalize_grievance_status(next_status)

    if nxt not in CANONICAL_GRIEVANCE_STATUSES:
        return False, f"Invalid grievance workflow status: {next_status}."

    if curr == nxt:
        return True, ""

    allowed_targets = GRIEVANCE_TRANSITIONS.get(curr, set())
    if nxt not in allowed_targets:
        return False, f"Invalid workflow transition from {curr} to {nxt}."

    role = str(actor_role).upper()
    if role == "CSC_OPERATOR" and nxt in ("RESOLVED", "CLOSED", "REJECTED"):
        return False, "CSC Operators cannot resolve, close, or reject field grievances."
    if role == "WARD_OFFICER" and nxt in ("CLOSED", "REOPENED"):
        return False, "Only Panchayat Secretary or verified requester may close or reopen grievances."
    if role == "CITIZEN" and nxt != "REOPENED":
        return False, "Citizens may only request reopening of a closed/resolved grievance."

    if nxt in NOTE_REQUIRED_STATUSES and len((note or "").strip()) < 5:
        return False, f"A detailed official remark (at least 5 characters) is mandatory when moving to {nxt}."

    return True, ""
