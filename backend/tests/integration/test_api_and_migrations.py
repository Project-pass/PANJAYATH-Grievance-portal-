from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import tempfile
import unittest

TESTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
for p in (BACKEND_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from helpers import IsolatedServerTestCase  # noqa: E402
import db  # noqa: E402
import maintenance  # noqa: E402


class ApiIntegrationAndMigrationTests(IsolatedServerTestCase):
    def test_01_health_ready_openapi_and_versioned_v1_routes(self):
        s_h, hdrs, _, _, d_h = self.request("GET", "/api/health")
        self.assertEqual(s_h, 200)
        self.assertTrue(d_h["ok"])
        self.assertTrue(d_h["cEngineCompiled"])
        self.assertIn("x-request-id", hdrs)

        s_r, _, _, _, d_r = self.request("GET", "/api/v1/ready")
        self.assertEqual(s_r, 200)
        self.assertTrue(d_r["ok"])
        self.assertTrue(all(d_r["checks"].values()))

        s_doc, _, _, _, d_doc = self.request("GET", "/api/v1/openapi.json")
        self.assertEqual(s_doc, 200)
        self.assertIn("openapi", d_doc)
        self.assertIn("/public/overview", d_doc["paths"])

    def test_02_public_overview_reports_exact_db_counts_without_inflation(self):
        s_ov, _, _, _, ov = self.request("GET", "/api/public/overview")
        self.assertEqual(s_ov, 200)
        conn = db.get_connection(self.test_db_path)
        try:
            real_resolved = conn.execute(
                "SELECT COUNT(*) FROM grievances WHERE status IN ('RESOLVED', 'CLOSED')"
            ).fetchone()[0]
            real_total = conn.execute("SELECT COUNT(*) FROM grievances").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(ov["stats"]["resolvedCount"], real_resolved)
        self.assertEqual(ov["stats"]["totalCount"], real_total)
        self.assertLess(ov["stats"]["resolvedCount"], 50)

    def test_03_bootstrap_cookie_only_auth_and_session_regeneration(self):
        s_claim, _, set_raw, cookies, data = self.request(
            "POST",
            "/api/auth/bootstrap-claim",
            {"passcode": "AdminTest2026!"},
        )
        self.assertEqual(s_claim, 200)
        self.assertTrue(data["ok"])
        self.assertNotIn("token", data)
        self.assertIn("panchayat_sid", cookies)
        self.assertIn("panchayat_csrf", cookies)
        cookie_str = "; ".join(set_raw)
        self.assertIn("HttpOnly", cookie_str)
        self.assertIn("Secure", cookie_str)
        self.assertIn("SameSite=None", cookie_str)
        self.assertIn("Partitioned", cookie_str)

        old_sid = cookies["panchayat_sid"]
        # Re-login while presenting old cookie -> rotates session & invalidates old sid
        s_re, _, _, new_cookies, data2 = self.request(
            "POST",
            "/api/auth/login",
            {"identifier": "admin_test", "passcode": "AdminTest2026!"},
            cookies={"panchayat_sid": old_sid},
        )
        self.assertEqual(s_re, 200)
        csrf2 = data2.get("csrfToken") or new_cookies.get("panchayat_csrf")
        self.assertNotEqual(new_cookies["panchayat_sid"], old_sid)

        # Old sid is now invalid on authenticated route
        s_old, _, _, _, _ = self.request(
            "GET",
            "/api/staff/dashboard",
            cookies={"panchayat_sid": old_sid},
        )
        self.assertEqual(s_old, 401)

        self.__class__.admin_cookies = new_cookies
        self.__class__.admin_csrf = csrf2

    def test_04_self_password_change_revokes_other_sessions(self):
        # Create second session for admin_test
        s2, _, _, cookies_b, _, _ = self.login_with_cookies("admin_test", "AdminTest2026!")
        self.assertEqual(s2, 200)

        # Change password from session A (keeps A, revokes B)
        s_cp, _, _, _, _ = self.request(
            "POST",
            "/api/staff/account/change-password",
            {"currentPassword": "AdminTest2026!", "newPassword": "NewSecPass2026!"},
            cookies=self.admin_cookies,
            csrf_token=self.admin_csrf,
        )
        self.assertEqual(s_cp, 200)

        # Session B must be revoked
        s_b, _, _, _, _ = self.request("GET", "/api/staff/dashboard", cookies=cookies_b)
        self.assertEqual(s_b, 401)

        # Session A stays valid
        s_a, _, _, _, _ = self.request("GET", "/api/staff/dashboard", cookies=self.admin_cookies)
        self.assertEqual(s_a, 200)

        # Login with new password works; restore original password for subsequent tests
        s_new, _, _, c_new, csrf_new, _ = self.login_with_cookies("admin_test", "NewSecPass2026!")
        self.assertEqual(s_new, 200)
        self.__class__.admin_cookies = c_new
        self.__class__.admin_csrf = csrf_new

    def test_05_admin_staff_reset_password_and_pagination_and_audit_export(self):
        # Create an officer and log them in
        s_cr, _, _, _, cr = self.request(
            "POST",
            "/api/staff/users",
            {
                "name": "Pagination Officer",
                "username": "page_officer",
                "email": "page.officer@abcgram.gov.in",
                "passcode": "OfficerPass1!",
                "designation": "Ward Engineer",
                "role": "WARD_OFFICER",
                "department": "Water & Sanitation",
                "assignedWards": [1, 2],
                "isActive": True,
            },
            cookies=self.admin_cookies,
            csrf_token=self.admin_csrf,
        )
        self.assertEqual(s_cr, 201)
        oid = cr["staff"]["id"]

        s_ol, _, _, off_cookies, _, _ = self.login_with_cookies("page_officer", "OfficerPass1!")
        self.assertEqual(s_ol, 200)

        # Admin forces password reset -> invalidates officer's session
        s_rst, _, _, _, _ = self.request(
            "POST",
            f"/api/staff/users/{oid}/reset-password",
            {"newPassword": "ResetOfficer2!"},
            cookies=self.admin_cookies,
            csrf_token=self.admin_csrf,
        )
        self.assertEqual(s_rst, 200)
        s_chk, _, _, _, _ = self.request("GET", "/api/staff/dashboard", cookies=off_cookies)
        self.assertEqual(s_chk, 401)

        # Paginated grievance query
        s_pg, _, _, _, pg = self.request(
            "GET",
            "/api/staff/grievances?page=1&pageSize=2",
            cookies=self.admin_cookies,
        )
        self.assertEqual(s_pg, 200)
        self.assertEqual(len(pg["items"]), 2)
        self.assertGreaterEqual(pg["total"], 8)

        # Audit export CSV and JSON
        s_csv, hdr_csv, _, _, d_csv = self.request(
            "GET",
            "/api/staff/audit/export?format=csv",
            cookies=self.admin_cookies,
        )
        self.assertEqual(s_csv, 200)
        self.assertIn("text/csv", hdr_csv.get("content-type", ""))
        self.assertIn("STAFF_PASSWORD_RESET", d_csv.get("raw", ""))

        s_json, hdr_json, _, _, d_json = self.request(
            "GET",
            "/api/staff/audit/export?format=json",
            cookies=self.admin_cookies,
        )
        self.assertEqual(s_json, 200)
        self.assertIn("application/json", hdr_json.get("content-type", ""))
        self.assertIsInstance(d_json, list)

    def test_06_escalation_sweep_and_backup_restore_drill(self):
        # Backdate a non-closed ticket's created_at so it exceeds SLA
        conn = db.get_connection(self.test_db_path)
        try:
            with db.transaction(conn):
                conn.execute(
                    "UPDATE grievances SET created_at = '2026-01-05T09:00:00Z', status = 'ASSIGNED' WHERE id = 'ABC-GRV-2026-102'"
                )
        finally:
            conn.close()

        s_esc, _, _, _, esc = self.request(
            "POST",
            "/api/staff/grievances/escalate-overdue",
            {},
            cookies=self.admin_cookies,
            csrf_token=self.admin_csrf,
        )
        self.assertEqual(s_esc, 200)
        self.assertIn("ABC-GRV-2026-102", esc["escalatedIds"])

        # Backup + restore drill + retention check
        manifest = maintenance.run_backup(encrypt=False)
        self.assertTrue(os.path.exists(manifest["backupFile"]))
        drill = maintenance.run_restore_drill(manifest["backupFile"])
        self.assertTrue(drill["ok"])
        self.assertEqual(drill["integrity"], "ok")
        ret = maintenance.check_audit_retention(365)
        self.assertTrue(ret["immutableTriggersActive"])

        if shutil.which("openssl"):
            prev_bk = os.environ.get("PANCHAYAT_BACKUP_KEY")
            os.environ["PANCHAYAT_BACKUP_KEY"] = "BackupEncKey2026!StrongSecret"
            try:
                enc_manifest = maintenance.run_backup(encrypt=True)
                self.assertTrue(enc_manifest["encrypted"])
                enc_drill = maintenance.run_restore_drill(enc_manifest["backupFile"])
                self.assertTrue(enc_drill["ok"])
                self.assertTrue(enc_drill["encrypted"])
            finally:
                if prev_bk is None:
                    os.environ.pop("PANCHAYAT_BACKUP_KEY", None)
                else:
                    os.environ["PANCHAYAT_BACKUP_KEY"] = prev_bk

    def test_07_sqlite_v1_v2_to_v3_migration_upgrade(self):
        with tempfile.TemporaryDirectory() as td:
            legacy_db = os.path.join(td, "legacy_v2.db")
            conn = sqlite3.connect(legacy_db)
            conn.executescript(
                """
                CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                INSERT INTO schema_migrations(version, applied_at) VALUES (1, '2026-01-01T00:00:00Z');
                INSERT INTO schema_migrations(version, applied_at) VALUES (2, '2026-01-01T00:00:00Z');
                CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
                INSERT INTO config VALUES ('slaLimitDays', '7', '2026-01-01T00:00:00Z');
                CREATE TABLE staff (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT UNIQUE, email TEXT UNIQUE NOT NULL,
                    passcode_hash TEXT, designation TEXT NOT NULL, role TEXT NOT NULL, department TEXT NOT NULL,
                    assigned_wards_json TEXT NOT NULL, is_active INTEGER NOT NULL, permissions_json TEXT NOT NULL,
                    failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until REAL NOT NULL DEFAULT 0,
                    is_claimed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                INSERT INTO staff VALUES (
                    'stf-secretary', 'Secretary', 'admin_test', 'sec@abcgram.gov.in', NULL,
                    'Secretary', 'SUPER_ADMIN', 'General Administration', '[1,2]', 1, '{}',
                    0, 0, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                );
                CREATE TABLE sessions (
                    token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL, role TEXT NOT NULL,
                    created_at REAL NOT NULL, expires_at REAL NOT NULL, last_seen_at REAL NOT NULL,
                    ip_hash TEXT NOT NULL, token_prefix TEXT NOT NULL
                );
                CREATE TABLE grievances (
                    id TEXT PRIMARY KEY, citizen_name TEXT NOT NULL, mobile TEXT NOT NULL,
                    mobile_last4 TEXT NOT NULL, ward INTEGER NOT NULL, category TEXT NOT NULL,
                    department TEXT NOT NULL, landmark TEXT NOT NULL, description TEXT NOT NULL,
                    status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    resolved_at TEXT, assigned_officer_id TEXT, assigned_officer_name TEXT,
                    filed_by_role TEXT NOT NULL, before_photo_url TEXT, after_photo_url TEXT,
                    public_remark TEXT, internal_remark TEXT, rating INTEGER, feedback_comment TEXT,
                    timeline_json TEXT NOT NULL, tracking_token_hash TEXT NOT NULL
                );
                INSERT INTO grievances VALUES (
                    'ABC-GRV-2026-999', 'Legacy Citizen', '9876543210', '3210', 1, 'Water Supply',
                    'Water & Sanitation', 'Old Well', 'Low pressure', 'Field Inspection',
                    '2026-01-02T09:00:00Z', '2026-01-02T10:00:00Z', NULL, NULL, NULL, 'CITIZEN',
                    NULL, NULL, 'Inspecting', NULL, NULL, NULL, '[]', 'dummyhash'
                );
                CREATE TABLE services (
                    id TEXT PRIMARY KEY, service_id TEXT NOT NULL, service_name TEXT NOT NULL,
                    applicant_name TEXT NOT NULL, mobile TEXT NOT NULL, mobile_last4 TEXT NOT NULL,
                    ward INTEGER NOT NULL, address TEXT NOT NULL, department TEXT NOT NULL,
                    fee_inr INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, checked_docs_json TEXT NOT NULL, uploaded_doc_names_json TEXT NOT NULL,
                    assigned_officer_id TEXT, assigned_officer_name TEXT, filed_by_role TEXT NOT NULL,
                    official_remark TEXT, timeline_json TEXT NOT NULL, tracking_token_hash TEXT NOT NULL
                );
                CREATE TABLE audit_logs (
                    id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, actor_id TEXT NOT NULL,
                    actor_name TEXT NOT NULL, actor_role TEXT NOT NULL, session_prefix TEXT NOT NULL,
                    ip_hash TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL,
                    outcome TEXT NOT NULL, details TEXT NOT NULL
                );
                """
            )
            conn.commit()
            conn.close()

            db.init_db(legacy_db)

            up = db.get_connection(legacy_db)
            try:
                versions = [r["version"] for r in up.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()]
                self.assertEqual(versions, [1, 2, 3, 4])
                row = up.execute("SELECT status, external_uuid, priority FROM grievances WHERE id = 'ABC-GRV-2026-999'").fetchone()
                self.assertEqual(row["status"], "IN_PROGRESS")
                self.assertEqual(row["priority"], "NORMAL")
                self.assertIsNotNone(row["external_uuid"])
                s_cols = {r["name"] for r in up.execute("PRAGMA table_info(sessions)").fetchall()}
                self.assertIn("csrf_token_hash", s_cols)
                a_cols = {r["name"] for r in up.execute("PRAGMA table_info(audit_logs)").fetchall()}
                self.assertTrue({"seq_no", "prev_hash", "event_hash"}.issubset(a_cols))
            finally:
                up.close()


if __name__ == "__main__":
    unittest.main()
