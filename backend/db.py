from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
import sqlite3
import time
import uuid

from app.core.config import DATA_DIR as CFG_DATA_DIR, load_settings
from app.core.logging import get_request_id
from app.database.connection import get_adapter, get_db_connection, resolve_database_url
from app.database.interface import DbConnection, detect_database_backend
from app.database.migrations.runner import run_alembic_upgrade
from app.database.sqlite_adapter import SQLITE_WRITE_LOCK
from app.database.transactions import run_transaction
from app.policies.rbac import normalize_grievance_status
from app.services.audit_integrity import (
    DEFAULT_CHECKPOINTS_PATH,
    append_checkpoint_record,
    backfill_audit_hash_chain,
    compute_event_hash,
    resolve_audit_hmac_key,
)
from app.services.sla import DEFAULT_CATEGORY_SLA_DAYS, resolve_effective_sla_limit
from security_utils import generate_tracking_token, hash_passcode, hash_token
from seed_data import CATEGORY_DEPARTMENT_MAP, get_initial_state

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = str(CFG_DATA_DIR)
_SETTINGS = load_settings()
SQLITE_PATH = str(_SETTINGS.sqlite_path)
LEGACY_JSON_PATH = os.path.join(DATA_DIR, "portal_db.json")
AUDIT_JSONL_PATH = str(_SETTINGS.audit_jsonl_path)
AUDIT_CHECKPOINTS_PATH = DEFAULT_CHECKPOINTS_PATH

DB_WRITE_LOCK = SQLITE_WRITE_LOCK


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_connection(db_path: str | None = None) -> DbConnection:
    return get_db_connection(db_path or SQLITE_PATH)


@contextmanager
def transaction(conn: DbConnection | sqlite3.Connection):
    with run_transaction(conn) as tx_conn:
        yield tx_conn


V3_GRIEVANCES_DDL = """
CREATE TABLE IF NOT EXISTS grievances (
    id TEXT PRIMARY KEY,
    external_uuid TEXT UNIQUE,
    citizen_name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    mobile_last4 TEXT NOT NULL CHECK(length(mobile_last4) = 4),
    ward INTEGER NOT NULL CHECK(ward BETWEEN 1 AND 15),
    category TEXT NOT NULL,
    department TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
    sla_limit_days INTEGER NOT NULL DEFAULT 7 CHECK(sla_limit_days BETWEEN 1 AND 30),
    paused_seconds INTEGER NOT NULL DEFAULT 0 CHECK(paused_seconds >= 0),
    hold_started_at TEXT,
    escalated_at TEXT,
    escalation_level INTEGER NOT NULL DEFAULT 0 CHECK(escalation_level >= 0),
    consent_recorded INTEGER NOT NULL DEFAULT 1 CHECK(consent_recorded IN (0,1)),
    landmark TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN (
        'SUBMITTED','ACKNOWLEDGED','ASSIGNED','IN_PROGRESS','ON_HOLD',
        'ESCALATED','RESOLVED','CLOSED','REJECTED','REOPENED'
    )),
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
"""


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
            external_uuid TEXT UNIQUE,
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
            csrf_token_hash TEXT,
            staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL,
            last_seen_at REAL NOT NULL,
            ip_hash TEXT NOT NULL,
            token_prefix TEXT NOT NULL
        );
        """
        + V3_GRIEVANCES_DDL
        + """
        CREATE TABLE IF NOT EXISTS services (
            id TEXT PRIMARY KEY,
            external_uuid TEXT UNIQUE,
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
            request_id TEXT NOT NULL DEFAULT '-',
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
    (
        3,
        """
        CREATE TABLE IF NOT EXISTS wards (
            ward_number INTEGER PRIMARY KEY CHECK(ward_number BETWEEN 1 AND 15),
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS departments (
            name TEXT PRIMARY KEY,
            head_designation TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS grievance_categories (
            name TEXT PRIMARY KEY,
            department TEXT NOT NULL REFERENCES departments(name) ON UPDATE CASCADE,
            default_sla_days INTEGER NOT NULL CHECK(default_sla_days BETWEEN 1 AND 30)
        );

        CREATE TABLE IF NOT EXISTS sla_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            priority TEXT NOT NULL CHECK(priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
            deadline_days INTEGER NOT NULL CHECK(deadline_days BETWEEN 1 AND 30),
            UNIQUE(category, priority)
        );

        CREATE TABLE IF NOT EXISTS holidays (
            holiday_date TEXT PRIMARY KEY,
            label TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS grievance_status_history (
            id TEXT PRIMARY KEY,
            grievance_id TEXT NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
            from_status TEXT,
            to_status TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            actor_name TEXT NOT NULL,
            actor_role TEXT NOT NULL,
            remark TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS grievance_assignments (
            id TEXT PRIMARY KEY,
            grievance_id TEXT NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
            officer_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
            officer_name TEXT,
            assigned_by_id TEXT NOT NULL,
            assigned_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS grievance_comments (
            id TEXT PRIMARY KEY,
            grievance_id TEXT NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
            author_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            is_internal INTEGER NOT NULL DEFAULT 0 CHECK(is_internal IN (0,1)),
            body TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            target_kind TEXT NOT NULL CHECK(target_kind IN ('grievance','service')),
            target_id TEXT NOT NULL,
            file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            storage_ref TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            recipient_role TEXT NOT NULL,
            recipient_ref TEXT NOT NULL,
            target_id TEXT NOT NULL,
            channel TEXT NOT NULL DEFAULT 'IN_APP',
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'SENT' CHECK(status IN ('QUEUED','SENT','FAILED')),
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_grievances_ward_dept_status ON grievances(ward, department, status);
        CREATE INDEX IF NOT EXISTS idx_grievances_created_at ON grievances(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_grievances_uuid ON grievances(external_uuid);
        CREATE INDEX IF NOT EXISTS idx_services_ward_dept_status ON services(ward, department, status);
        CREATE INDEX IF NOT EXISTS idx_services_uuid ON services(external_uuid);
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_status_hist_gid ON grievance_status_history(grievance_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_id, created_at DESC);
        """,
    ),
    (
        4,
        """
        CREATE TABLE IF NOT EXISTS audit_checkpoints (
            checkpoint_id TEXT PRIMARY KEY,
            seq_no INTEGER NOT NULL,
            event_id TEXT NOT NULL,
            event_hash TEXT NOT NULL,
            record_count INTEGER NOT NULL,
            signature TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_seq_no ON audit_logs(seq_no);
        """,
    ),
]


def _seed_reference_tables(conn: DbConnection):
    for w in range(1, 16):
        conn.execute(
            "INSERT INTO wards(ward_number, name) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (w, f"Ward {w}"),
        )

    depts = [
        ("General Administration", "Panchayat Secretary"),
        ("Roads & Streetlights", "Assistant Engineer"),
        ("Water & Sanitation", "Water & Sanitation Inspector"),
        ("Public Health", "Public Health Officer"),
        ("Revenue & Certificates", "Senior Revenue Clerk"),
        ("Building & Planning", "Town Planning Overseer"),
    ]
    for name, head in depts:
        conn.execute(
            "INSERT INTO departments(name, head_designation) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (name, head),
        )

    for cat, days in DEFAULT_CATEGORY_SLA_DAYS.items():
        dept = CATEGORY_DEPARTMENT_MAP.get(cat, "General Administration")
        conn.execute(
            "INSERT INTO grievance_categories(name, department, default_sla_days) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
            (cat, dept, days),
        )
        for pr in ("LOW", "NORMAL", "HIGH", "CRITICAL"):
            eff = resolve_effective_sla_limit(cat, pr, days)
            conn.execute(
                "INSERT INTO sla_policies(category, priority, deadline_days) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                (cat, pr, eff),
            )

    for hdate, label in (
        ("2026-01-26", "Republic Day"),
        ("2026-08-15", "Independence Day"),
        ("2026-10-02", "Gandhi Jayanti"),
        ("2026-12-25", "Christmas Day"),
    ):
        conn.execute(
            "INSERT INTO holidays(holiday_date, label) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (hdate, label),
        )


def _apply_v3_table_upgrades(conn: DbConnection):
    staff_cols = {r["name"] for r in conn.execute("PRAGMA table_info(staff)").fetchall()}
    if "external_uuid" not in staff_cols:
        conn.execute("ALTER TABLE staff ADD COLUMN external_uuid TEXT;")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_uuid ON staff(external_uuid);")

    sess_cols = {r["name"] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()}
    if "csrf_token_hash" not in sess_cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN csrf_token_hash TEXT;")

    srv_cols = {r["name"] for r in conn.execute("PRAGMA table_info(services)").fetchall()}
    if "external_uuid" not in srv_cols:
        conn.execute("ALTER TABLE services ADD COLUMN external_uuid TEXT;")

    aud_cols = {r["name"] for r in conn.execute("PRAGMA table_info(audit_logs)").fetchall()}
    if "request_id" not in aud_cols:
        conn.execute("ALTER TABLE audit_logs ADD COLUMN request_id TEXT NOT NULL DEFAULT '-';")

    grv_cols = {r["name"] for r in conn.execute("PRAGMA table_info(grievances)").fetchall()}
    if "external_uuid" not in grv_cols:
        conn.execute("PRAGMA foreign_keys = OFF;")
        conn.execute("DROP TABLE IF EXISTS grievances_v3;")
        conn.execute(V3_GRIEVANCES_DDL.replace("CREATE TABLE IF NOT EXISTS grievances", "CREATE TABLE grievances_v3"))
        rows = conn.execute("SELECT * FROM grievances").fetchall()
        for r in rows:
            canonical_st = normalize_grievance_status(r["status"])
            cat_limit = DEFAULT_CATEGORY_SLA_DAYS.get(r["category"], 7)
            conn.execute(
                """
                INSERT INTO grievances_v3(
                    id, external_uuid, citizen_name, mobile, mobile_last4, ward, category, department,
                    priority, sla_limit_days, paused_seconds, hold_started_at, escalated_at,
                    escalation_level, consent_recorded, landmark, description, status,
                    created_at, updated_at, resolved_at, assigned_officer_id, assigned_officer_name,
                    filed_by_role, before_photo_url, after_photo_url, public_remark, internal_remark,
                    rating, feedback_comment, timeline_json, tracking_token_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NORMAL', ?, 0, NULL, NULL, 0, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    r["id"],
                    str(uuid.uuid4()),
                    r["citizen_name"],
                    r["mobile"],
                    r["mobile_last4"],
                    r["ward"],
                    r["category"],
                    r["department"],
                    cat_limit,
                    r["landmark"],
                    r["description"],
                    canonical_st,
                    r["created_at"],
                    r["updated_at"],
                    r["resolved_at"],
                    r["assigned_officer_id"],
                    r["assigned_officer_name"],
                    r["filed_by_role"],
                    r["before_photo_url"],
                    r["after_photo_url"],
                    r["public_remark"],
                    r["internal_remark"],
                    r["rating"],
                    r["feedback_comment"],
                    r["timeline_json"],
                    r["tracking_token_hash"],
                ),
            )
        conn.execute("DROP TABLE grievances;")
        conn.execute("ALTER TABLE grievances_v3 RENAME TO grievances;")
        conn.execute("PRAGMA foreign_keys = ON;")

    for tbl in ("staff", "grievances", "services"):
        missing = conn.execute(f"SELECT id FROM {tbl} WHERE external_uuid IS NULL OR external_uuid = ''").fetchall()
        for row in missing:
            conn.execute(f"UPDATE {tbl} SET external_uuid = ? WHERE id = ?", (str(uuid.uuid4()), row["id"]))


def _apply_v4_audit_chain_upgrade(conn: DbConnection):
    aud_cols = {r["name"] for r in conn.execute("PRAGMA table_info(audit_logs)").fetchall()}
    if "seq_no" not in aud_cols:
        conn.execute("ALTER TABLE audit_logs ADD COLUMN seq_no INTEGER;")
    if "prev_hash" not in aud_cols:
        conn.execute("ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT;")
    if "event_hash" not in aud_cols:
        conn.execute("ALTER TABLE audit_logs ADD COLUMN event_hash TEXT;")

    # Temporarily drop update trigger only during schema v4 backfill, then immediately restore it
    conn.execute("DROP TRIGGER IF EXISTS trg_audit_no_update;")
    try:
        backfill_audit_hash_chain(conn, resolve_audit_hmac_key())
    finally:
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
            BEFORE UPDATE ON audit_logs
            BEGIN
                SELECT RAISE(ABORT, 'Audit logs are append-only and immutable.');
            END;
            """
        )


def _seed_tables(conn: DbConnection):
    seed = get_initial_state()
    ts = now_iso()
    conn.execute(
        "INSERT INTO config(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        ("slaLimitDays", str(seed.get("slaLimitDays", 7)), ts),
    )

    env_sec_pass = os.environ.get("PANCHAYAT_SECRETARY_PASSCODE", "").strip()

    for s in seed.get("staff", []):
        p_hash = None
        is_claimed = False
        if s["id"] == "stf-secretary" and env_sec_pass:
            p_hash = hash_passcode(env_sec_pass)
            is_claimed = True
        conn.execute(
            """
            INSERT INTO staff(
                id, external_uuid, name, username, email, passcode_hash, designation, role, department,
                assigned_wards_json, is_active, permissions_json,
                failed_attempts, locked_until, is_claimed, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
            """,
            (
                s["id"],
                str(uuid.uuid4()),
                s["name"],
                s.get("username"),
                s["email"].lower(),
                p_hash,
                s["designation"],
                s["role"],
                s["department"],
                json.dumps(s["assignedWards"]),
                bool(s.get("isActive", True)),
                json.dumps(s["permissions"]),
                is_claimed,
                ts,
                ts,
            ),
        )

    for g in seed.get("grievances", []):
        tk_hash = hash_token(generate_tracking_token())
        canonical_st = normalize_grievance_status(g["status"])
        sla_days = DEFAULT_CATEGORY_SLA_DAYS.get(g["category"], 7)
        conn.execute(
            """
            INSERT INTO grievances(
                id, external_uuid, citizen_name, mobile, mobile_last4, ward, category, department,
                priority, sla_limit_days, paused_seconds, hold_started_at, escalated_at,
                escalation_level, consent_recorded, landmark, description, status,
                created_at, updated_at, resolved_at, assigned_officer_id, assigned_officer_name,
                filed_by_role, before_photo_url, after_photo_url, public_remark, internal_remark,
                rating, feedback_comment, timeline_json, tracking_token_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NORMAL', ?, 0, NULL, NULL, 0, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                g["id"],
                str(uuid.uuid4()),
                g["citizenName"],
                g["mobile"],
                g["mobile"][-4:],
                int(g["ward"]),
                g["category"],
                g["department"],
                sla_days,
                g["landmark"],
                g["description"],
                canonical_st,
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
        conn.execute(
            """
            INSERT INTO grievance_status_history(
                id, grievance_id, from_status, to_status, actor_id, actor_name, actor_role, remark, created_at
            ) VALUES (?, ?, NULL, ?, 'seed', 'System Seed', 'SYSTEM', ?, ?)
            ON CONFLICT DO NOTHING
            """,
            (f"gsh-{g['id']}", g["id"], canonical_st, g.get("publicRemark") or "Registered", g["createdAt"]),
        )

    for srv in seed.get("services", []):
        tk_hash = hash_token(generate_tracking_token())
        conn.execute(
            """
            INSERT INTO services(
                id, external_uuid, service_id, service_name, applicant_name, mobile, mobile_last4,
                ward, address, department, fee_inr, status, created_at, updated_at,
                checked_docs_json, uploaded_doc_names_json, assigned_officer_id,
                assigned_officer_name, filed_by_role, official_remark, timeline_json,
                tracking_token_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                srv["id"],
                str(uuid.uuid4()),
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

    audit_key = resolve_audit_hmac_key()
    head_row = conn.execute(
        "SELECT seq_no, event_hash FROM audit_logs WHERE seq_no IS NOT NULL ORDER BY seq_no DESC LIMIT 1"
    ).fetchone()
    seq_no = int(head_row["seq_no"]) if head_row else 0
    prev_hash = str(head_row["event_hash"]) if head_row and head_row["event_hash"] else ("0" * 64)

    for aud in seed.get("auditLogs", []):
        seq_no += 1
        draft = {
            "seq_no": seq_no,
            "id": aud["id"],
            "timestamp": aud["timestamp"],
            "request_id": "seed",
            "actor_id": "seed",
            "actor_name": aud["actorName"],
            "actor_role": aud["actorRole"],
            "session_prefix": "seed",
            "ip_hash": "00000000",
            "action": aud["action"],
            "target_id": aud["targetId"],
            "outcome": "SUCCESS",
            "details": aud["details"],
            "prev_hash": prev_hash,
        }
        evt_hash = compute_event_hash(draft, audit_key)
        conn.execute(
            """
            INSERT INTO audit_logs(
                id, seq_no, prev_hash, event_hash, timestamp, request_id, actor_id, actor_name, actor_role, session_prefix,
                ip_hash, action, target_id, outcome, details
            ) VALUES (?, ?, ?, ?, ?, 'seed', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                aud["id"],
                seq_no,
                prev_hash,
                evt_hash,
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
        prev_hash = evt_hash

    if seq_no > 0 and seed.get("auditLogs"):
        last_seed = seed["auditLogs"][-1]
        append_checkpoint_record(
            AUDIT_CHECKPOINTS_PATH,
            seq_no,
            last_seed["id"],
            prev_hash,
            seq_no,
            key=audit_key,
            conn=conn,
        )


def init_db(db_path: str | None = None):
    if os.path.exists(LEGACY_JSON_PATH):
        try:
            os.remove(LEGACY_JSON_PATH)
        except OSError:
            pass

    target_url = resolve_database_url(db_path or SQLITE_PATH)
    backend = detect_database_backend(target_url)

    if backend == "postgresql":
        run_alembic_upgrade(target_url)
        conn = get_connection(db_path)
        try:
            with transaction(conn):
                _seed_reference_tables(conn)
                staff_count = conn.execute("SELECT COUNT(*) AS c FROM staff").fetchone()["c"]
                if staff_count == 0:
                    _seed_tables(conn)
        finally:
            conn.close()
        return

    conn = get_connection(db_path or SQLITE_PATH)
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
                        cols = {r["name"] for r in conn.execute("PRAGMA table_info(staff)").fetchall()}
                        if "username" not in cols:
                            conn.execute("ALTER TABLE staff ADD COLUMN username TEXT;")
                    if version == 3:
                        _apply_v3_table_upgrades(conn)
                    if version == 4:
                        _apply_v4_audit_chain_upgrade(conn)
                    conn.executescript(sql)
                    if version == 3:
                        _seed_reference_tables(conn)
                    conn.execute(
                        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                        (version, now_iso()),
                    )

        with transaction(conn):
            _seed_reference_tables(conn)
            staff_count = conn.execute("SELECT COUNT(*) AS c FROM staff").fetchone()["c"]
            if staff_count == 0:
                _seed_tables(conn)
    finally:
        conn.close()


def append_audit_event(
    conn: DbConnection,
    actor_id: str,
    actor_name: str,
    actor_role: str,
    session_prefix: str,
    ip_hash: str,
    action: str,
    target_id: str,
    outcome: str,
    details: str,
    request_id: str | None = None,
):
    req_id = request_id or get_request_id()
    audit_key = resolve_audit_hmac_key()
    head = conn.execute(
        "SELECT seq_no, event_hash FROM audit_logs WHERE seq_no IS NOT NULL ORDER BY seq_no DESC LIMIT 1"
    ).fetchone()
    next_seq = (int(head["seq_no"]) if head and head["seq_no"] is not None else 0) + 1
    prev_hash = str(head["event_hash"]) if head and head["event_hash"] else ("0" * 64)

    evt_id = f"aud-{int(time.time() * 1000)}-{os.getpid()}-{next_seq}-{hash(details) & 0xffff:04x}"
    ts = now_iso()
    draft = {
        "seq_no": next_seq,
        "id": evt_id,
        "timestamp": ts,
        "request_id": req_id,
        "actor_id": actor_id,
        "actor_name": actor_name,
        "actor_role": actor_role,
        "session_prefix": session_prefix,
        "ip_hash": ip_hash,
        "action": action,
        "target_id": target_id,
        "outcome": outcome,
        "details": details,
        "prev_hash": prev_hash,
    }
    evt_hash = compute_event_hash(draft, audit_key)

    conn.execute(
        """
        INSERT INTO audit_logs(
            id, seq_no, prev_hash, event_hash, timestamp, request_id, actor_id, actor_name, actor_role, session_prefix,
            ip_hash, action, target_id, outcome, details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            evt_id,
            next_seq,
            prev_hash,
            evt_hash,
            ts,
            req_id,
            actor_id,
            actor_name,
            actor_role,
            session_prefix,
            ip_hash,
            action,
            target_id,
            outcome,
            details,
        ),
    )

    evt = {
        "id": evt_id,
        "seqNo": next_seq,
        "prevHash": prev_hash,
        "eventHash": evt_hash,
        "timestamp": ts,
        "requestId": req_id,
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

    audit_path = AUDIT_JSONL_PATH
    os.makedirs(os.path.dirname(audit_path), exist_ok=True)
    with open(audit_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(evt) + "\n")

    append_checkpoint_record(
        AUDIT_CHECKPOINTS_PATH,
        next_seq,
        evt_id,
        evt_hash,
        next_seq,
        key=audit_key,
        conn=conn,
    )
    return evt


def append_security_alert(
    conn: DbConnection,
    severity: str,
    event_type: str,
    actor_hint: str,
    ip_hash: str,
    details: str,
):
    aid = f"alrt-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
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
    conn: DbConnection,
    actor: dict,
    session_prefix: str,
    ip_hash: str,
):
    conn.execute("DELETE FROM sessions;")
    conn.execute("DELETE FROM grievance_status_history;")
    conn.execute("DELETE FROM grievance_assignments;")
    conn.execute("DELETE FROM grievance_comments;")
    conn.execute("DELETE FROM notifications;")
    conn.execute("DELETE FROM attachments;")
    conn.execute("DELETE FROM grievances;")
    conn.execute("DELETE FROM services;")
    conn.execute("DELETE FROM staff;")
    conn.execute("DELETE FROM config;")
    _seed_reference_tables(conn)
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
