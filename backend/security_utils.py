import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from collections import defaultdict

ALL_WARDS = list(range(1, 16))

DEPARTMENTS = {
    "General Administration",
    "Roads & Streetlights",
    "Water & Sanitation",
    "Public Health",
    "Revenue & Certificates",
    "Building & Planning",
}

GRIEVANCE_CATEGORIES = {
    "Water Supply",
    "Streetlights",
    "Waste Management",
    "Roads & Drainage",
    "Public Health",
    "Encroachment",
}

GRIEVANCE_STATUSES = {
    "Pending",
    "In Progress",
    "Field Inspection",
    "Resolved",
    "Rejected",
}

SERVICE_STATUSES = {
    "Submitted",
    "Pending Verification",
    "Documents Verified",
    "Correction Needed",
    "Approved",
    "Rejected",
}

ROLES = {"SUPER_ADMIN", "WARD_OFFICER", "CSC_OPERATOR"}

ALLOWED_LOCAL_ASSETS = {
    "/src/assets/images/panchayat_bhavan_hero_1795502748499.jpg",
    "/src/assets/images/grievance_road_before_1795502748537.jpg",
    "/src/assets/images/grievance_road_after_1795502749598.jpg",
    "/src/assets/images/grievance_water_leak_1795502750018.jpg",
    "/src/assets/images/grievance_streetlight_fixed_1795502750170.jpg",
}

_DATA_IMAGE_RE = re.compile(r"^data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$")
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.\-]{3,48}$")
_TRACKING_ID_RE = re.compile(r"^ABC-(GRV|SRV)-2026-\d{1,6}$")
_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")

_PROCESS_FALLBACK_SECRET = secrets.token_bytes(32)


def get_session_secret_bytes():
    raw = os.environ.get("PANCHAYAT_SESSION_SECRET", "").strip()
    if raw:
        return raw.encode("utf-8")
    return _PROCESS_FALLBACK_SECRET


def hash_passcode(passcode: str) -> str:
    if not isinstance(passcode, str) or len(passcode) < 6 or len(passcode) > 128:
        raise ValueError("Passcode must be between 6 and 128 characters.")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(passcode.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_passcode(passcode: str, stored_hash: str | None) -> bool:
    if not passcode or not stored_hash or not isinstance(stored_hash, str):
        return False
    parts = stored_hash.split("$")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False
    try:
        salt = bytes.fromhex(parts[1])
        expected = bytes.fromhex(parts[2])
    except ValueError:
        return False
    derived = hashlib.scrypt(passcode.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=len(expected))
    return hmac.compare_digest(derived, expected)


def validate_passcode_strength(passcode: str) -> tuple[bool, str]:
    if not isinstance(passcode, str):
        return False, "Passcode must be a string."
    if len(passcode) < 8 or len(passcode) > 128:
        return False, "Passcode must be 8–128 characters long."
    has_alpha = any(c.isalpha() for c in passcode)
    has_digit = any(c.isdigit() for c in passcode)
    has_symbol = any(not c.isalnum() for c in passcode)
    if sum((has_alpha, has_digit, has_symbol)) < 2:
        return False, "Passcode must combine at least two character classes (letters, digits, or symbols)."
    return True, ""


def generate_opaque_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def generate_tracking_token() -> str:
    return "TK-" + secrets.token_urlsafe(15)


def hash_token(token: str) -> str:
    return hmac.new(get_session_secret_bytes(), token.encode("utf-8"), hashlib.sha256).hexdigest()


def hash_ip(ip: str) -> str:
    return hashlib.sha256(f"{ip}:panchayat_ip".encode("utf-8")).hexdigest()[:16]


def mask_name(name: str) -> str:
    parts = str(name or "").strip().split()
    if not parts:
        return "Citizen"
    return " ".join(p[0] + "***" if len(p) > 1 else p for p in parts)


def mask_mobile(mobile: str) -> str:
    digits = re.sub(r"\D", "", str(mobile or ""))
    if len(digits) < 4:
        return "******"
    return "******" + digits[-4:]


def normalize_text(val, max_len: int, min_len: int = 0, field_name: str = "field") -> str:
    if not isinstance(val, str):
        raise ValueError(f"Invalid {field_name}: must be text.")
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", val).strip()
    if len(cleaned) < min_len:
        raise ValueError(f"{field_name} must be at least {min_len} characters.")
    if len(cleaned) > max_len:
        raise ValueError(f"{field_name} exceeds maximum length ({max_len}).")
    return cleaned


def validate_photo_url(val) -> str | None:
    if val is None or val == "":
        return None
    if not isinstance(val, str):
        raise ValueError("Invalid photo attachment format.")
    s = val.strip()
    if s in ALLOWED_LOCAL_ASSETS:
        return s
    if len(s) > 1_500_000:
        raise ValueError("Photo attachment exceeds 1.5MB limit.")
    if _DATA_IMAGE_RE.match(s):
        return s
    raise ValueError("Unsupported or unsafe image source.")


def ensure_allowed_keys(body: dict, allowed_keys: set[str], required_keys: set[str] | None = None):
    if not isinstance(body, dict):
        raise ValueError("Request payload must be a JSON object.")
    extra = set(body.keys()) - allowed_keys
    if extra:
        raise ValueError(f"Unexpected payload fields rejected: {', '.join(sorted(extra))}.")
    if required_keys:
        missing = [k for k in sorted(required_keys) if k not in body or body[k] is None or body[k] == ""]
        if missing:
            raise ValueError(f"Missing required fields: {', '.join(missing)}.")


def validate_grievance_create(body: dict) -> dict:
    allowed = {"citizenName", "mobile", "ward", "category", "landmark", "description", "beforePhotoUrl"}
    required = {"citizenName", "mobile", "ward", "category", "landmark", "description"}
    ensure_allowed_keys(body, allowed, required)

    citizen_name = normalize_text(body["citizenName"], 120, 2, "citizenName")
    mobile = re.sub(r"\D", "", str(body["mobile"]))
    if not re.match(r"^\d{10}$", mobile):
        raise ValueError("Mobile number must be exactly 10 digits.")

    try:
        ward = int(body["ward"])
    except (TypeError, ValueError):
        raise ValueError("Ward must be a valid integer between 1 and 15.")
    if ward < 1 or ward > 15:
        raise ValueError("Ward must be between 1 and 15.")

    category = normalize_text(body["category"], 64, 2, "category")
    if category not in GRIEVANCE_CATEGORIES:
        raise ValueError("Invalid grievance category.")

    landmark = normalize_text(body["landmark"], 200, 2, "landmark")
    description = normalize_text(body["description"], 2000, 5, "description")
    before_photo = validate_photo_url(body.get("beforePhotoUrl"))

    return {
        "citizenName": citizen_name,
        "mobile": mobile,
        "ward": ward,
        "category": category,
        "landmark": landmark,
        "description": description,
        "beforePhotoUrl": before_photo,
    }


def validate_service_create(body: dict, valid_service_ids: set[str]) -> dict:
    allowed = {"serviceId", "applicantName", "mobile", "ward", "address", "checkedDocs", "uploadedDocNames"}
    required = {"serviceId", "applicantName", "mobile", "ward", "address", "checkedDocs"}
    ensure_allowed_keys(body, allowed, required)

    service_id = normalize_text(body["serviceId"], 64, 2, "serviceId")
    if service_id not in valid_service_ids:
        raise ValueError("Invalid service catalog ID.")

    applicant_name = normalize_text(body["applicantName"], 120, 2, "applicantName")
    mobile = re.sub(r"\D", "", str(body["mobile"]))
    if not re.match(r"^\d{10}$", mobile):
        raise ValueError("Mobile number must be exactly 10 digits.")

    try:
        ward = int(body["ward"])
    except (TypeError, ValueError):
        raise ValueError("Ward must be a valid integer between 1 and 15.")
    if ward < 1 or ward > 15:
        raise ValueError("Ward must be between 1 and 15.")

    address = normalize_text(body["address"], 300, 4, "address")

    checked_docs = body.get("checkedDocs", [])
    if not isinstance(checked_docs, list) or len(checked_docs) == 0 or len(checked_docs) > 10:
        raise ValueError("At least 1 and at most 10 document checklist items must be confirmed.")
    clean_checked = [normalize_text(d, 160, 2, "checkedDoc") for d in checked_docs]

    uploaded = body.get("uploadedDocNames") or []
    if not isinstance(uploaded, list) or len(uploaded) > 10:
        raise ValueError("Uploaded document names list exceeds limit (10).")
    clean_uploaded = [normalize_text(u, 140, 1, "uploadedDocName") for u in uploaded]

    return {
        "serviceId": service_id,
        "applicantName": applicant_name,
        "mobile": mobile,
        "ward": ward,
        "address": address,
        "checkedDocs": clean_checked,
        "uploadedDocNames": clean_uploaded,
    }


def validate_grievance_patch(body: dict) -> dict:
    allowed = {"status", "assignedOfficerId", "publicRemark", "internalRemark", "afterPhotoUrl"}
    ensure_allowed_keys(body, allowed)
    if not body:
        raise ValueError("Update payload cannot be empty.")

    out = {}
    if "status" in body:
        st = normalize_text(body["status"], 40, 2, "status")
        if st not in GRIEVANCE_STATUSES:
            raise ValueError("Invalid grievance workflow status.")
        out["status"] = st
    if "assignedOfficerId" in body:
        oid = body["assignedOfficerId"]
        if oid in (None, ""):
            out["assignedOfficerId"] = None
        else:
            oid_s = normalize_text(oid, 64, 2, "assignedOfficerId")
            if not _ID_RE.match(oid_s):
                raise ValueError("Invalid officer identifier format.")
            out["assignedOfficerId"] = oid_s
    if "publicRemark" in body:
        out["publicRemark"] = normalize_text(body["publicRemark"] or "", 1000, 0, "publicRemark")
    if "internalRemark" in body:
        out["internalRemark"] = normalize_text(body["internalRemark"] or "", 1000, 0, "internalRemark")
    if "afterPhotoUrl" in body:
        out["afterPhotoUrl"] = validate_photo_url(body["afterPhotoUrl"])
    return out


def validate_service_patch(body: dict) -> dict:
    allowed = {"status", "assignedOfficerId", "officialRemark"}
    ensure_allowed_keys(body, allowed)
    if not body:
        raise ValueError("Update payload cannot be empty.")

    out = {}
    if "status" in body:
        st = normalize_text(body["status"], 40, 2, "status")
        if st not in SERVICE_STATUSES:
            raise ValueError("Invalid service workflow status.")
        out["status"] = st
    if "assignedOfficerId" in body:
        oid = body["assignedOfficerId"]
        if oid in (None, ""):
            out["assignedOfficerId"] = None
        else:
            oid_s = normalize_text(oid, 64, 2, "assignedOfficerId")
            if not _ID_RE.match(oid_s):
                raise ValueError("Invalid officer identifier format.")
            out["assignedOfficerId"] = oid_s
    if "officialRemark" in body:
        out["officialRemark"] = normalize_text(body["officialRemark"] or "", 1000, 0, "officialRemark")
    return out


def validate_staff_payload(body: dict, is_create: bool) -> dict:
    allowed = {"name", "username", "email", "passcode", "designation", "role", "department", "assignedWards", "isActive", "permissions"}
    required = {"name", "email", "designation", "role", "department", "assignedWards"}
    if is_create:
        required = required | {"passcode"}
    ensure_allowed_keys(body, allowed, required if is_create else None)

    out = {}
    if "name" in body:
        out["name"] = normalize_text(body["name"], 120, 2, "name")
    if "username" in body:
        raw_u = body["username"]
        if raw_u in (None, ""):
            out["username"] = None
        else:
            uname = normalize_text(raw_u, 48, 3, "username").lower()
            if not _USERNAME_RE.match(uname):
                raise ValueError("User ID must be 3–48 characters (letters, digits, _, ., -).")
            out["username"] = uname
    if "email" in body:
        email = normalize_text(body["email"], 160, 5, "email").lower()
        if not _EMAIL_RE.match(email):
            raise ValueError("Invalid official email address.")
        out["email"] = email
    if "passcode" in body and body["passcode"]:
        ok, err = validate_passcode_strength(str(body["passcode"]))
        if not ok:
            raise ValueError(err)
        out["passcode"] = str(body["passcode"])
    if "designation" in body:
        out["designation"] = normalize_text(body["designation"], 120, 2, "designation")
    if "role" in body:
        role = normalize_text(body["role"], 32, 2, "role")
        if role not in ROLES:
            raise ValueError("Invalid staff role.")
        out["role"] = role
    if "department" in body:
        dept = normalize_text(body["department"], 80, 2, "department")
        if dept not in DEPARTMENTS:
            raise ValueError("Invalid department.")
        out["department"] = dept
    if "assignedWards" in body:
        wards = body["assignedWards"]
        if not isinstance(wards, list) or len(wards) == 0 or len(wards) > 15:
            raise ValueError("Assigned wards must contain 1 to 15 ward numbers.")
        clean_wards = sorted({int(w) for w in wards})
        if any(w < 1 or w > 15 for w in clean_wards):
            raise ValueError("All assigned wards must be between 1 and 15.")
        out["assignedWards"] = clean_wards
    if "isActive" in body:
        out["isActive"] = bool(body["isActive"])
    if "permissions" in body:
        perms = body["permissions"]
        if not isinstance(perms, dict):
            raise ValueError("Permissions must be an object.")
        perm_keys = {
            "canApproveCertificates",
            "canAssignTickets",
            "canManageUsers",
            "canDeleteRecords",
            "canVerifyDocuments",
        }
        if set(perms.keys()) - perm_keys:
            raise ValueError("Unknown permission flags rejected.")
        out["permissions"] = {k: bool(perms.get(k, False)) for k in perm_keys}
    return out


def validate_tracking_query(body: dict) -> tuple[str, str, str]:
    allowed = {"trackingId", "trackingToken", "mobileLast4"}
    required = {"trackingId", "trackingToken", "mobileLast4"}
    ensure_allowed_keys(body, allowed, required)

    tid = normalize_text(body["trackingId"], 32, 5, "trackingId").upper()
    if not _TRACKING_ID_RE.match(tid):
        raise ValueError("Invalid Tracking ID format.")
    token = normalize_text(body["trackingToken"], 128, 8, "trackingToken")
    last4 = re.sub(r"\D", "", str(body["mobileLast4"]))
    if len(last4) != 4:
        raise ValueError("Mobile verification requires the last 4 digits.")
    return tid, token, last4


class SlidingWindowRateLimiter:
    def __init__(self):
        self._lock = threading.Lock()
        self._hits = defaultdict(list)

    def check(self, key: str, max_requests: int, window_seconds: int) -> tuple[bool, int]:
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            entries = [t for t in self._hits[key] if t > cutoff]
            if len(entries) >= max_requests:
                self._hits[key] = entries
                retry_after = max(1, int(entries[0] + window_seconds - now) + 1)
                return False, retry_after
            entries.append(now)
            self._hits[key] = entries
            return True, 0
