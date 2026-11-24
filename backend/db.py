from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
import sqlite3
import threading
import time

from security_utils import generate_tracking_token, hash_passcode, hash_token
from seed_data import get_initial_state

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
SQLITE_PATH = os.path.join(DATA_DIR, "panchayat.db")
LEGACY_JSON_PATH = os.path.join(DATA_DIR, "portal_db.json")
AUDIT_JSONL_PATH = os.path.join(DATA_DIR, "audit_log.jsonl")

DB_WRITE_LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_connection(db_path: str = SQLITE_PATH) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=15.0, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection):
    with DB_WRITE_LOCK:
        conn.execute("BEGIN IMMEDIATE;")
        try:
            yield conn
            if conn.in_transaction:
                conn.execute("COMMIT;")
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK;")
            raise


MIGRATIONS = [
    (
        1,
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS staff (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            username TEXT UNIQUE,
            email TEXT UNIQUE NOT NULL,
            passcode_hash TEXT,
            designation TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','WARD_OFFICER','CSC_OPERATOR')),
            department TEXT NOT NULL,
            assigned_wards_json TEXT NOT NULL,
            is_active INTEGER NOT NULL CHECK(is_active IN (0,1)),
            permissions_json TEXT NOT NULL,
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until REAL NOT NULL DEFAULT 0,
            is_claimed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL,
            last_seen_at REAL NOT NULL,
            ip_hash TEXT NOT NULL,
            token_prefix TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS grievances (
            id TEXT PRIMARY KEY,
            citizen_name TEXT NOT NULL,
            mobile TEXT NOT NULL,
            mobile_last4 TEXT NOT NULL CHECK(length(mobile_last4) = 4),
            ward INTEGER NOT NULL CHECK(ward BETWEEN 1 AND 15),
            category TEXT NOT NULL,
            department TEXT NOT NULL,
            landmark TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('Pending','In Progress','Field Inspection','Resolved','Rejected')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            resolved_at TEXT,
            assigned_officer_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
            assigned_officer_name TEXT,
            filed_by_role TEXT NOT NULL,
            before_photo_url TEXT,
            after_photo_url TEXT,
            public_remark TEXT,
            internal_remark TEXT,
            rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 1 AND 5)),
            feedback_comment TEXT,
            timeline_json TEXT NOT NULL,
            tracking_token_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS services (
            id TEXT PRIMARY KEY,
            service_id TEXT NOT NULL,
            service_name TEXT NOT NULL,
            applicant_name TEXT NOT NULL,
            mobile TEXT NOT NULL,
            mobile_last4 TEXT NOT NULL CHECK(length(mobile_last4) = 4),
            ward INTEGER NOT NULL CHECK(ward BETWEEN 1 AND 15),
            address TEXT NOT NULL,
            department TEXT NOT NULL,
            fee_inr INTEGER NOT NULL CHECK(fee_inr >= 0),
            status TEXT NOT NULL CHECK(status IN ('Submitted','Pending Verification','Documents Verified','Correction Needed','Approved','Rejected')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            checked_docs_json TEXT NOT NULL,
            uploaded_doc_names_json TEXT NOT NULL,
            assigned_officer_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
            assigned_officer_name TEXT,
            filed_by_role TEXT NOT NULL,
            official_remark TEXT,
            timeline_json TEXT NOT NULL,
            tracking_token_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            actor_name TEXT NOT NULL,
            actor_role TEXT NOT NULL,
            session_prefix TEXT NOT NULL,
            ip_hash TEXT NOT NULL,
            action TEXT NOT NULL,
            target_id TEXT NOT NULL,
            outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS','DENIED','ERROR')),
            details TEXT NOT NULL
        );

        CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
        BEFORE UPDATE ON audit_logs
        BEGIN
            SELECT RAISE(ABORT, 'Audit logs are append-only and immutable.');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
        BEFORE DELETE ON audit_logs
        BEGIN
            SELECT RAISE(ABORT, 'Audit logs are append-only and cannot be deleted.');
        END;

        CREATE TABLE IF NOT EXISTS security_alerts (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
            event_type TEXT NOT NULL,
            actor_hint TEXT NOT NULL,
            ip_hash TEXT NOT NULL,
            details TEXT NOT NULL
        );

        CREATE TRIGGER IF NOT EXISTS trg_alerts_no_update
        BEFORE UPDATE ON security_alerts
        BEGIN
            SELECT RAISE(ABORT, 'Security alerts are append-only and immutable.');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_alerts_no_delete
        BEFORE DELETE ON security_alerts
        BEGIN
            SELECT RAISE(ABORT, 'Security alerts are append-only and cannot be deleted.');
        END;
        """,
    ),
    (
        2,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_username ON staff(username);
        UPDATE staff SET username = 'admin_test' WHERE id = 'stf-secretary' AND (username IS NULL OR username = '');
        UPDATE staff SET username = 'rahul_roads' WHERE id = 'stf-rahul' AND (username IS NULL OR username = '');
        UPDATE staff SET username = 'anitha_water' WHERE id = 'stf-anitha' AND (username IS NULL OR username = '');
        UPDATE staff SET username = 'suresh_health' WHERE id = 'stf-suresh' AND (username IS NULL OR username = '');
        UPDATE staff SET username = 'deepak_csc' WHERE id = 'stf-deepak' AND (username IS NULL OR username = '');
        """,
    ),
]


def _seed_tables(conn: sqlite3.Connection):
    seed = get_initial_state()
    ts = now_iso()
    conn.execute(
        "INSERT OR IGNORE INTO config(key, value, updated_at) VALUES (?, ?, ?)",
        ("slaLimitDays", str(seed.get("slaLimitDays", 7)), ts),
    )

    env_sec_pass = os.environ.get("PANCHAYAT_SECRETARY_PASSCODE", "").strip()

    for s in seed.get("staff", []):
        p_hash = None
        is_claimed = 0
        if s["id"] == "stf-secretary" and env_sec_pass:
            p_hash = hash_passcode(env_sec_pass)
            is_claimed = 1
        conn.execute(
            """
            INSERT INTO staff(
                id, name, username, email, passcode_hash, designation, role, department,
                assigned_wards_json, is_active, permissions_json,
                failed_attempts, locked_until, is_claimed, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
            """,
            (
                s["id"],
                s["name"],
                s.get("username"),
                s["email"].lower(),
                p_hash,
                s["designation"],
                s["role"],
                s["department"],
                json.dumps(s["assignedWards"]),
                1 if s.get("isActive", True) else 0,
                json.dumps(s["permissions"]),
                is_claimed,
                ts,
                ts,
            ),
        )

    for g in seed.get("grievances", []):
        # Seed records receive random high-entropy tracking tokens (hashed) so sequential IDs do not disclose PII
        tk_hash = hash_token(generate_tracking_token())
        conn.execute(
            """
            INSERT INTO grievances(
                id, citizen_name, mobile, mobile_last4, ward, category, department,
                landmark, description, status, created_at, updated_at, resolved_at,
                assigned_officer_id, assigned_officer_name, filed_by_role,
                before_photo_url, after_photo_url, public_remark, internal_remark,
                rating, feedback_comment, timeline_json, tracking_token_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                g["id"],
                g["citizenName"],
                g["mobile"],
                g["mobile"][-4:],
                int(g["ward"]),
                g["category"],
                g["department"],
                g["landmark"],
                g["description"],
                g["status"],
                g["createdAt"],
                g["updatedAt"],
                g.get("resolvedAt"),
                g.get("assignedOfficerId"),
                g.get("assignedOfficerName"),
                g.get("filedByRole", "CITIZEN"),
                g.get("beforePhotoUrl"),
                g.get("afterPhotoUrl"),
                g.get("publicRemark"),
                g.get("internalRemark"),
                g.get("rating"),
                g.get("feedbackComment"),
                json.dumps(g.get("timeline", [])),
                tk_hash,
            ),
        )

    for srv in seed.get("services", []):
        tk_hash = hash_token(generate_tracking_token())
        conn.execute(
            """
            INSERT INTO services(
                id, service_id, service_name, applicant_name, mobile, mobile_last4,
                ward, address, department, fee_inr, status, created_at, updated_at,
                checked_docs_json, uploaded_doc_names_json, assigned_officer_id,
                assigned_officer_name, filed_by_role, official_remark, timeline_json,
                tracking_token_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                srv["id"],
                srv["serviceId"],
                srv["serviceName"],
                srv["applicantName"],
                srv["mobile"],
                srv["mobile"][-4:],
                int(srv["ward"]),
                srv["address"],
                srv["department"],
                int(srv["feeInr"]),
                srv["status"],
                srv["createdAt"],
                srv["updatedAt"],
                json.dumps(srv.get("checkedDocs", [])),
                json.dumps(srv.get("uploadedDocNames", [])),
                srv.get("assignedOfficerId"),
                srv.get("assignedOfficerName"),
                srv.get("filedByRole", "CITIZEN"),
                srv.get("officialRemark"),
                json.dumps(srv.get("timeline", [])),
                tk_hash,
            ),
        )

    for aud in seed.get("auditLogs", []):
        conn.execute(
            """
            INSERT INTO audit_logs(
                id, timestamp, actor_id, actor_name, actor_role, session_prefix,
                ip_hash, action, target_id, outcome, details
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                aud["id"],
                aud["timestamp"],
                "seed",
                aud["actorName"],
                aud["actorRole"],
                "seed",
                "00000000",
                aud["action"],
                aud["targetId"],
                "SUCCESS",
                aud["details"],
            ),
        )


def init_db(db_path: str = SQLITE_PATH):
    # Remove legacy flat JSON containing plaintext PINs if present
    if os.path.exists(LEGACY_JSON_PATH):
        try:
            os.remove(LEGACY_JSON_PATH)
        except OSError:
            pass

    conn = get_connection(db_path)
    try:
        with DB_WRITE_LOCK:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);"
            )
            applied = {
                row["version"]
                for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
            }
            for version, sql in MIGRATIONS:
                if version not in applied:
                    if version == 2:
                        cols = {
                            r["name"]
                            for r in conn.execute("PRAGMA table_info(staff)").fetchall()
                        }
                        if "username" not in cols:
                            conn.execute("ALTER TABLE staff ADD COLUMN username TEXT;")
                    conn.executescript(sql)
                    conn.execute(
                        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                        (version, now_iso()),
                    )

        with transaction(conn):
            staff_count = conn.execute("SELECT COUNT(*) AS c FROM staff").fetchone()["c"]
            if staff_count == 0:
                _seed_tables(conn)
    finally:
        conn.close()


def append_audit_event(
    conn: sqlite3.Connection,
    actor_id: str,
    actor_name: str,
    actor_role: str,
    session_prefix: str,
    ip_hash: str,
    action: str,
    target_id: str,
    outcome: str,
    details: str,
):
    evt = {
        "id": f"aud-{int(time.time() * 1000)}-{os.getpid()}-{hash(details) & 0xffff:04x}",
        "timestamp": now_iso(),
        "actorId": actor_id,
        "actorName": actor_name,
        "actorRole": actor_role,
        "sessionPrefix": session_prefix,
        "ipHash": ip_hash,
        "action": action,
        "targetId": target_id,
        "outcome": outcome,
        "details": details,
    }
    conn.execute(
        """
        INSERT INTO audit_logs(
            id, timestamp, actor_id, actor_name, actor_role, session_prefix,
            ip_hash, action, target_id, outcome, details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            evt["id"],
            evt["timestamp"],
            evt["actorId"],
            evt["actorName"],
            evt["actorRole"],
            evt["sessionPrefix"],
            evt["ipHash"],
            evt["action"],
            evt["targetId"],
            evt["outcome"],
            evt["details"],
        ),
    )
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(AUDIT_JSONL_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(evt) + "\n")
    return evt


def append_security_alert(
    conn: sqlite3.Connection,
    severity: str,
    event_type: str,
    actor_hint: str,
    ip_hash: str,
    details: str,
):
    aid = f"alrt-{int(time.time() * 1000)}-{hash(details) & 0xffff:04x}"
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO security_alerts(id, timestamp, severity, event_type, actor_hint, ip_hash, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (aid, ts, severity, event_type, actor_hint, ip_hash, details),
    )
    return aid


def reset_database_with_audit(
    conn: sqlite3.Connection,
    actor: dict,
    session_prefix: str,
    ip_hash: str,
):
    conn.execute("DELETE FROM sessions;")
    conn.execute("DELETE FROM grievances;")
    conn.execute("DELETE FROM services;")
    conn.execute("DELETE FROM staff;")
    conn.execute("DELETE FROM config;")
    _seed_tables(conn)
    append_audit_event(
        conn,
        actor["id"],
        actor["name"],
        actor["role"],
        session_prefix,
        ip_hash,
        "MAINTENANCE_RESET",
        "PORTAL_DB",
        "SUCCESS",
        f"Authorized maintenance reset executed by {actor['name']}.",
    )
    append_security_alert(
        conn,
        "HIGH",
        "MAINTENANCE_RESET",
        actor["email"],
        ip_hash,
        f"Authorized maintenance reset executed by {actor['name']}.",
    )
