import http.client
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import db  # noqa: E402
import server  # noqa: E402


class SecurityHardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.TemporaryDirectory()
        cls.test_db_path = os.path.join(cls.tmpdir.name, "test_panchayat.db")
        cls.test_audit_path = os.path.join(cls.tmpdir.name, "test_audit.jsonl")

        cls._orig_db_sqlite = db.SQLITE_PATH
        cls._orig_db_audit = db.AUDIT_JSONL_PATH
        cls._orig_srv_sqlite = server.SQLITE_PATH
        cls._orig_env_pass = os.environ.pop("PANCHAYAT_SECRETARY_PASSCODE", None)

        db.SQLITE_PATH = cls.test_db_path
        db.AUDIT_JSONL_PATH = cls.test_audit_path
        server.SQLITE_PATH = cls.test_db_path
        server.RATE_LIMITER._hits.clear()

        db.init_db(cls.test_db_path)

        cls.httpd = server.ReusableThreadingServer(("127.0.0.1", 0), server.PanchayatApiHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        db.SQLITE_PATH = cls._orig_db_sqlite
        db.AUDIT_JSONL_PATH = cls._orig_db_audit
        server.SQLITE_PATH = cls._orig_srv_sqlite
        if cls._orig_env_pass is not None:
            os.environ["PANCHAYAT_SECRETARY_PASSCODE"] = cls._orig_env_pass
        cls.tmpdir.cleanup()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = dict(headers or {})
        payload = None
        if body is not None:
            if isinstance(body, (dict, list)):
                payload = json.dumps(body).encode("utf-8")
                hdrs.setdefault("Content-Type", "application/json")
            else:
                payload = body if isinstance(body, bytes) else str(body).encode("utf-8")
        conn.request(method, path, body=payload, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8")
        resp_headers = {k.lower(): v for k, v in resp.getheaders()}
        set_cookies = [v for k, v in resp.getheaders() if k.lower() == "set-cookie"]
        conn.close()
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            data = {"raw": raw}
        return resp.status, resp_headers, set_cookies, data

    def test_01_legacy_unauthenticated_routes_removed_and_headers_present(self):
        status, hdrs, _, _ = self.request("GET", "/api/state")
        self.assertEqual(status, 404)
        self.assertEqual(hdrs.get("x-content-type-options"), "nosniff")
        self.assertEqual(hdrs.get("referrer-policy"), "strict-origin-when-cross-origin")
        self.assertIn("max-age=31536000", hdrs.get("strict-transport-security", ""))
        self.assertEqual(hdrs.get("cache-control"), "no-store")

        status_reset, _, _, _ = self.request("POST", "/api/reset", {})
        self.assertIn(status_reset, (401, 404))

    def test_02_public_overview_has_zero_pii_or_credentials(self):
        status, _, _, data = self.request("GET", "/api/public/overview")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        dump = json.dumps(data)
        for forbidden in ("mobile", "citizenName", "passcode", "pin", "internalRemark", "tracking_token"):
            self.assertNotIn(forbidden, dump)

    def test_03_spoofed_staff_header_rejected_and_alert_logged(self):
        status, _, _, data = self.request(
            "GET",
            "/api/staff/dashboard",
            headers={"X-Staff-Id": "stf-secretary"},
        )
        self.assertEqual(status, 401)
        self.assertFalse(data["ok"])

        conn = db.get_connection(self.test_db_path)
        try:
            row = conn.execute(
                "SELECT event_type, severity FROM security_alerts WHERE event_type = 'SPOOFED_AUTH_HEADER'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["severity"], "HIGH")
        finally:
            conn.close()

    def test_04_unauthenticated_staff_routes_return_401(self):
        for method, path, body in [
            ("GET", "/api/staff/dashboard", None),
            ("PATCH", "/api/staff/grievances/ABC-GRV-2026-101", {"status": "Resolved"}),
            ("DELETE", "/api/staff/grievances/ABC-GRV-2026-101", None),
            ("POST", "/api/staff/maintenance/reset", {"confirmPhrase": "CONFIRM_PORTAL_RESET"}),
        ]:
            status, _, _, _ = self.request(method, path, body)
            self.assertEqual(status, 401, f"{method} {path} should require authentication")

    def test_05_bootstrap_claim_and_cookie_attributes(self):
        # Weak passcode rejected (short or single character class)
        s_weak, _, _, _ = self.request("POST", "/api/auth/bootstrap-claim", {"passcode": "1234"})
        self.assertEqual(s_weak, 400)
        s_single, _, _, _ = self.request("POST", "/api/auth/bootstrap-claim", {"passcode": "onlyletters"})
        self.assertEqual(s_single, 400)

        # Strong passcode succeeds once
        s_ok, _, cookies, data = self.request(
            "POST", "/api/auth/bootstrap-claim", {"passcode": "SecPass2026!"}
        )
        self.assertEqual(s_ok, 200)
        self.assertTrue(data["ok"])
        self.assertIn("token", data)
        self.assertEqual(data["user"]["username"], "admin_test")
        self.__class__.admin_token = data["token"]

        cookie_str = "; ".join(cookies)
        self.assertIn("HttpOnly", cookie_str)
        self.assertIn("Secure", cookie_str)
        self.assertIn("SameSite=None", cookie_str)
        self.assertIn("Partitioned", cookie_str)

        # Second claim attempt blocked
        s_second, _, _, _ = self.request(
            "POST", "/api/auth/bootstrap-claim", {"passcode": "AnotherPass2026!"}
        )
        self.assertEqual(s_second, 403)

    def test_05b_username_identifier_login(self):
        s_ok, _, _, data = self.request(
            "POST",
            "/api/auth/login",
            {"identifier": "admin_test", "passcode": "SecPass2026!"},
        )
        self.assertEqual(s_ok, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(data["user"]["username"], "admin_test")
        self.assertEqual(data["user"]["role"], "SUPER_ADMIN")

    def test_06_staff_dashboard_dto_excludes_credential_fields(self):
        status, _, _, data = self.request(
            "GET",
            "/api/staff/dashboard",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(status, 200)
        dump = json.dumps(data)
        self.assertNotIn("passcode_hash", dump)
        self.assertNotIn("tracking_token_hash", dump)
        for st in data["staff"]:
            self.assertNotIn("pin", st)
            self.assertNotIn("passcode", st)

    def test_07_rbac_ward_and_dept_isolation_and_negative_tests(self):
        # Create a Ward Officer assigned strictly to Ward 1 + Water & Sanitation without cert approval
        s_create, _, _, created = self.request(
            "POST",
            "/api/staff/users",
            {
                "name": "Ward One Water Officer",
                "email": "ward1.water@abcgram.gov.in",
                "passcode": "WaterWard1!",
                "designation": "Water Overseer",
                "role": "WARD_OFFICER",
                "department": "Water & Sanitation",
                "assignedWards": [1],
                "isActive": True,
                "permissions": {
                    "canApproveCertificates": False,
                    "canAssignTickets": False,
                    "canManageUsers": False,
                    "canDeleteRecords": False,
                    "canVerifyDocuments": False,
                },
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(s_create, 201)

        s_login, _, _, login_data = self.request(
            "POST",
            "/api/auth/login",
            {"email": "ward1.water@abcgram.gov.in", "passcode": "WaterWard1!"},
        )
        self.assertEqual(s_login, 200)
        officer_tok = login_data["token"]

        # Dashboard returns only Ward 1 + Water & Sanitation records
        s_dash, _, _, dash = self.request(
            "GET",
            "/api/staff/dashboard",
            headers={"Authorization": f"Bearer {officer_tok}"},
        )
        self.assertEqual(s_dash, 200)
        for g in dash["grievances"]:
            self.assertEqual(g["ward"], 1)
            self.assertEqual(g["department"], "Water & Sanitation")
            # Ward officer only sees masked citizen mobile
            self.assertTrue(g["mobile"].startswith("******"))

        # Negative test: officer cannot update a Ward 4 Roads grievance (ABC-GRV-2026-101)
        s_cross_ward, _, _, _ = self.request(
            "PATCH",
            "/api/staff/grievances/ABC-GRV-2026-101",
            {"status": "In Progress"},
            headers={"Authorization": f"Bearer {officer_tok}"},
        )
        self.assertEqual(s_cross_ward, 403)

        # Negative test: officer cannot approve a certificate (ABC-SRV-2026-201)
        s_cert, _, _, _ = self.request(
            "PATCH",
            "/api/staff/services/ABC-SRV-2026-201",
            {"status": "Approved"},
            headers={"Authorization": f"Bearer {officer_tok}"},
        )
        self.assertEqual(s_cert, 403)

        # Negative test: officer cannot create staff, modify SLA, or delete records
        self.assertEqual(
            self.request(
                "POST",
                "/api/staff/users",
                {
                    "name": "Rogue",
                    "email": "rogue@abcgram.gov.in",
                    "passcode": "Rogue1234!",
                    "designation": "Rogue",
                    "role": "SUPER_ADMIN",
                    "department": "General Administration",
                    "assignedWards": [1],
                },
                headers={"Authorization": f"Bearer {officer_tok}"},
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "PUT",
                "/api/staff/config/sla",
                {"slaLimitDays": 2},
                headers={"Authorization": f"Bearer {officer_tok}"},
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "DELETE",
                "/api/staff/grievances/ABC-GRV-2026-102",
                headers={"Authorization": f"Bearer {officer_tok}"},
            )[0],
            403,
        )

    def test_08_schema_allowlist_xss_url_and_size_caps(self):
        # Extra unexpected shadow field
        s_extra, _, _, _ = self.request(
            "POST",
            "/api/public/grievances",
            {
                "citizenName": "Test Citizen",
                "mobile": "9876543210",
                "ward": 2,
                "category": "Water Supply",
                "landmark": "Near School",
                "description": "Pipe leakage near junction",
                "isAdmin": True,
            },
        )
        self.assertEqual(s_extra, 400)

        # Out-of-range ward
        s_ward, _, _, _ = self.request(
            "POST",
            "/api/public/grievances",
            {
                "citizenName": "Test Citizen",
                "mobile": "9876543210",
                "ward": 99,
                "category": "Water Supply",
                "landmark": "Near School",
                "description": "Pipe leakage near junction",
            },
        )
        self.assertEqual(s_ward, 400)

        # Unsafe javascript: photo URL
        s_xss, _, _, _ = self.request(
            "POST",
            "/api/public/grievances",
            {
                "citizenName": "Test Citizen",
                "mobile": "9876543210",
                "ward": 2,
                "category": "Water Supply",
                "landmark": "Near School",
                "description": "Pipe leakage near junction",
                "beforePhotoUrl": "javascript:alert(1)",
            },
        )
        self.assertEqual(s_xss, 400)

        # Oversized (>2MB) payload rejected cleanly via Content-Length guard
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.putrequest("POST", "/api/public/grievances")
        c.putheader("Content-Type", "application/json")
        c.putheader("Content-Length", str(3 * 1024 * 1024))
        c.endheaders()
        r_big = c.getresponse()
        r_big.read()
        c.close()
        self.assertEqual(r_big.status, 413)

    def test_09_citizen_tracking_requires_high_entropy_token_and_last4(self):
        s_create, _, _, created = self.request(
            "POST",
            "/api/public/grievances",
            {
                "citizenName": "Anitha Menon",
                "mobile": "9847123456",
                "ward": 3,
                "category": "Streetlights",
                "landmark": "Post Office Road",
                "description": "Streetlight #14 is flickering at night.",
            },
        )
        self.assertEqual(s_create, 201)
        tid = created["ticket"]["id"]
        tk = created["trackingToken"]
        self.assertTrue(tk.startswith("TK-"))

        # Wrong token -> 404
        self.assertEqual(
            self.request(
                "POST",
                "/api/public/track",
                {"trackingId": tid, "trackingToken": "TK-wrongtokenvalue123", "mobileLast4": "3456"},
            )[0],
            404,
        )
        # Wrong last4 -> 404
        self.assertEqual(
            self.request(
                "POST",
                "/api/public/track",
                {"trackingId": tid, "trackingToken": tk, "mobileLast4": "0000"},
            )[0],
            404,
        )
        # Valid both -> 200 with masked display and zero mobile/internalRemark
        s_ok, _, _, tracked = self.request(
            "POST",
            "/api/public/track",
            {"trackingId": tid, "trackingToken": tk, "mobileLast4": "3456"},
        )
        self.assertEqual(s_ok, 200)
        rec = tracked["record"]
        self.assertNotIn("mobile", rec)
        self.assertNotIn("internalRemark", rec)
        self.assertIn("***", rec["citizenDisplay"])

    def test_10_bruteforce_lockout_and_rate_limit(self):
        # Create isolated staff account for lockout test
        self.request(
            "POST",
            "/api/staff/users",
            {
                "name": "Lockout Target",
                "email": "lockout@abcgram.gov.in",
                "passcode": "LockTarget1!",
                "designation": "Clerk",
                "role": "CSC_OPERATOR",
                "department": "General Administration",
                "assignedWards": [1, 2],
                "isActive": True,
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        for _ in range(5):
            s, _, _, _ = self.request(
                "POST",
                "/api/auth/login",
                {"email": "lockout@abcgram.gov.in", "passcode": "WrongPass99!"},
            )
            self.assertEqual(s, 401)

        # 6th attempt -> 423 Locked
        s_locked, hdrs, _, _ = self.request(
            "POST",
            "/api/auth/login",
            {"email": "lockout@abcgram.gov.in", "passcode": "LockTarget1!"},
        )
        self.assertEqual(s_locked, 423)
        self.assertIn("retry-after", hdrs)

        # Trigger rate limit on auth_login (>10 in 60s)
        got_429 = False
        for _ in range(8):
            s_rl, rl_hdrs, _, _ = self.request(
                "POST",
                "/api/auth/login",
                {"email": "nobody@abcgram.gov.in", "passcode": "InvalidPass1!"},
            )
            if s_rl == 429:
                self.assertIn("retry-after", rl_hdrs)
                got_429 = True
                break
        self.assertTrue(got_429, "Rate limiter should enforce 429 Too Many Requests")

    def test_11_sqlite_audit_logs_are_immutable(self):
        conn = db.get_connection(self.test_db_path)
        try:
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("UPDATE audit_logs SET details = 'tampered'")
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("DELETE FROM audit_logs")
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("DELETE FROM security_alerts")
        finally:
            conn.close()

    def test_12_cross_origin_mutation_rejected(self):
        s_csrf, _, _, _ = self.request(
            "POST",
            "/api/public/track",
            {"trackingId": "ABC-GRV-2026-101", "trackingToken": "TK-1234567890", "mobileLast4": "1234"},
            headers={"Origin": "https://evil.example"},
        )
        self.assertEqual(s_csrf, 403)

    def test_13_authenticated_legacy_reset_404_and_prod_maintenance_blocked(self):
        s_old, _, _, _ = self.request(
            "POST",
            "/api/reset",
            {},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(s_old, 404)

        prev_env = os.environ.get("APP_ENV")
        os.environ["APP_ENV"] = "production"
        try:
            s_prod, _, _, _ = self.request(
                "POST",
                "/api/staff/maintenance/reset",
                {"confirmPhrase": "CONFIRM_PORTAL_RESET"},
                headers={"Authorization": f"Bearer {self.admin_token}"},
            )
            self.assertEqual(s_prod, 403)
        finally:
            if prev_env is None:
                os.environ.pop("APP_ENV", None)
            else:
                os.environ["APP_ENV"] = prev_env


if __name__ == "__main__":
    unittest.main()
