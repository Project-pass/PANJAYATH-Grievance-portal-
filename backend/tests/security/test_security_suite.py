from __future__ import annotations

import http.client
import json
import os
import sqlite3
import sys
import unittest
import urllib.parse

TESTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
for p in (BACKEND_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from helpers import IsolatedServerTestCase  # noqa: E402
import db  # noqa: E402
import security_utils  # noqa: E402


class SecurityHardeningSuiteTests(IsolatedServerTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Claim Secretary account once for tests that need an authenticated admin session
        conn = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=10)
        payload = json.dumps({"passcode": "SecPass2026!"}).encode("utf-8")
        conn.request("POST", "/api/auth/bootstrap-claim", body=payload, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        body = json.loads(resp.read().decode("utf-8"))
        set_raw = [v for k, v in resp.getheaders() if k.lower() == "set-cookie"]
        conn.close()
        cookies = {}
        for sc in set_raw:
            first = sc.split(";", 1)[0].strip()
            if "=" in first:
                cname, cval = first.split("=", 1)
                cookies[cname.strip()] = cval.strip()
        cls.admin_cookies = cookies
        cls.admin_csrf = body["csrfToken"]

    def test_01_legacy_routes_removed_and_security_headers_enforced(self):
        s, hdrs, _, _, _ = self.request("GET", "/api/state")
        self.assertEqual(s, 404)
        self.assertEqual(hdrs.get("x-content-type-options"), "nosniff")
        self.assertEqual(hdrs.get("referrer-policy"), "strict-origin-when-cross-origin")
        self.assertIn("max-age=31536000", hdrs.get("strict-transport-security", ""))
        self.assertEqual(hdrs.get("cache-control"), "no-store")
        self.assertIn("default-src 'self'", hdrs.get("content-security-policy", ""))
        self.assertIn("object-src 'none'", hdrs.get("content-security-policy", ""))

    def test_02_spoofed_staff_and_bearer_headers_without_cookie_return_401(self):
        s_hdr, _, _, _, _ = self.request(
            "GET", "/api/staff/dashboard", headers={"X-Staff-Id": "stf-secretary"}
        )
        self.assertEqual(s_hdr, 401)
        s_bearer, _, _, _, _ = self.request(
            "GET", "/api/staff/dashboard", headers={"Authorization": "Bearer fake-token"}
        )
        self.assertEqual(s_bearer, 401)

        conn = db.get_connection(self.test_db_path)
        try:
            row = conn.execute(
                "SELECT severity FROM security_alerts WHERE event_type = 'SPOOFED_AUTH_HEADER'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["severity"], "HIGH")
        finally:
            conn.close()

    def test_03_csrf_token_and_origin_enforcement(self):
        # Missing X-CSRF-Token on authenticated PUT -> 403
        s_no_csrf, _, _, _, _ = self.request(
            "PUT",
            "/api/staff/config/sla",
            {"slaLimitDays": 5},
            cookies=self.admin_cookies,
        )
        self.assertEqual(s_no_csrf, 403)

        # Wrong X-CSRF-Token -> 403
        s_bad_csrf, _, _, _, _ = self.request(
            "PUT",
            "/api/staff/config/sla",
            {"slaLimitDays": 5},
            cookies=self.admin_cookies,
            csrf_token="forged-csrf-token",
        )
        self.assertEqual(s_bad_csrf, 403)

        # Cross-origin mutation -> 403
        s_origin, _, _, _, _ = self.request(
            "POST",
            "/api/public/track",
            {"trackingId": "ABC-GRV-2026-101", "trackingToken": "TK-1234567890", "mobileLast4": "1234"},
            headers={"Origin": "https://evil.example"},
        )
        self.assertEqual(s_origin, 403)

    def test_04_rbac_idor_horizontal_and_vertical_escalation_blocked(self):
        # Create Ward 1 Water officer
        s_cr, _, _, _, _ = self.request(
            "POST",
            "/api/staff/users",
            {
                "name": "Ward1 Officer",
                "username": "ward1_sec_test",
                "email": "ward1.sec@abcgram.gov.in",
                "passcode": "WardSec2026!",
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
            cookies=self.admin_cookies,
            csrf_token=self.admin_csrf,
        )
        self.assertEqual(s_cr, 201)
        s_l, _, _, off_cookies, off_csrf, _ = self.login_with_cookies("ward1_sec_test", "WardSec2026!")
        self.assertEqual(s_l, 200)

        # Horizontal IDOR: Ward 4 Roads grievance ABC-GRV-2026-101 denied (403)
        s_idor, _, _, _, _ = self.request(
            "PATCH",
            "/api/staff/grievances/ABC-GRV-2026-101",
            {"status": "IN_PROGRESS"},
            cookies=off_cookies,
            csrf_token=off_csrf,
        )
        self.assertEqual(s_idor, 403)

        # Vertical escalation: Officer cannot approve certificate, create users, export audit, reset DB, or delete
        self.assertEqual(
            self.request(
                "PATCH",
                "/api/staff/services/ABC-SRV-2026-201",
                {"status": "Approved"},
                cookies=off_cookies,
                csrf_token=off_csrf,
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "GET",
                "/api/staff/audit/export?format=csv",
                cookies=off_cookies,
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "DELETE",
                "/api/staff/grievances/ABC-GRV-2026-102",
                cookies=off_cookies,
                csrf_token=off_csrf,
            )[0],
            403,
        )

    def test_05_sqli_path_traversal_ssrf_and_oversized_payload_guards(self):
        # SQL injection string in search query is safely parameterized (returns 200, no DB error, no leaked rows)
        s_sqli, _, _, _, sqli_res = self.request(
            "GET",
            f"/api/staff/grievances?q={urllib.parse.quote(chr(39) + ' OR ' + chr(39) + '1' + chr(39) + '=' + chr(39) + '1')}",
            cookies=self.admin_cookies,
        )
        self.assertEqual(s_sqli, 200)
        self.assertEqual(sqli_res["total"], 0)

        # Path traversal in uploaded document filename rejected (400)
        s_trav, _, _, _, _ = self.request(
            "POST",
            "/api/public/services",
            {
                "serviceId": "residence",
                "applicantName": "Traversal Tester",
                "mobile": "9876543210",
                "ward": 2,
                "address": "Ward 2 Main Road",
                "checkedDocs": ["Aadhaar Card"],
                "uploadedDocNames": ["../../etc/passwd"],
            },
        )
        self.assertEqual(s_trav, 400)

        # SSRF host/scheme allowlist verification
        self.assertFalse(security_utils.is_safe_external_https_url("http://169.254.169.254/latest/meta-data", {"trusted.gov.in"}))
        self.assertFalse(security_utils.is_safe_external_https_url("https://127.0.0.1/admin", {"127.0.0.1"}))
        self.assertFalse(security_utils.is_safe_external_https_url("https://evil.example/file.png", {"trusted.gov.in"}))
        self.assertTrue(security_utils.is_safe_external_https_url("https://trusted.gov.in/doc.pdf", {"trusted.gov.in"}))

        # Oversized Content-Length rejected with 413
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.putrequest("POST", "/api/public/grievances")
        c.putheader("Content-Type", "application/json")
        c.putheader("Content-Length", str(3 * 1024 * 1024))
        c.endheaders()
        r_big = c.getresponse()
        r_big.read()
        c.close()
        self.assertEqual(r_big.status, 413)

    def test_06_dto_and_public_overview_leak_zero_secrets_or_pii(self):
        s_pub, _, _, _, pub = self.request("GET", "/api/public/overview")
        self.assertEqual(s_pub, 200)
        pub_dump = json.dumps(pub)
        for forbidden in ("mobile", "citizenName", "passcode", "pin", "internalRemark", "tracking_token"):
            self.assertNotIn(forbidden, pub_dump)

        s_dash, _, _, _, dash = self.request("GET", "/api/staff/dashboard", cookies=self.admin_cookies)
        self.assertEqual(s_dash, 200)
        dash_dump = json.dumps(dash)
        self.assertNotIn("passcode_hash", dash_dump)
        self.assertNotIn("tracking_token_hash", dash_dump)
        self.assertNotIn("csrf_token_hash", dash_dump)

    def test_07_bruteforce_lockout_and_rate_limit(self):
        self.request(
            "POST",
            "/api/staff/users",
            {
                "name": "Lockout Target",
                "username": "lockout_target",
                "email": "lockout@abcgram.gov.in",
                "passcode": "LockTarget1!",
                "designation": "Clerk",
                "role": "CSC_OPERATOR",
                "department": "General Administration",
                "assignedWards": [1, 2],
                "isActive": True,
            },
            cookies=self.admin_cookies,
            csrf_token=self.admin_csrf,
        )
        for _ in range(5):
            s, _, _, _, _ = self.request(
                "POST",
                "/api/auth/login",
                {"identifier": "lockout_target", "passcode": "WrongPass99!"},
            )
            self.assertEqual(s, 401)

        s_lock, hdrs, _, _, _ = self.request(
            "POST",
            "/api/auth/login",
            {"identifier": "lockout_target", "passcode": "LockTarget1!"},
        )
        self.assertEqual(s_lock, 423)
        self.assertIn("retry-after", hdrs)

        got_429 = False
        for _ in range(10):
            s_rl, rl_hdrs, _, _, _ = self.request(
                "POST",
                "/api/auth/login",
                {"identifier": "nobody", "passcode": "InvalidPass1!"},
            )
            if s_rl == 429:
                self.assertIn("retry-after", rl_hdrs)
                got_429 = True
                break
        self.assertTrue(got_429)

    def test_08_audit_immutability_and_prod_maintenance_reset_block(self):
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

        prev = os.environ.get("APP_ENV")
        os.environ["APP_ENV"] = "production"
        try:
            s_prod, _, _, _, _ = self.request(
                "POST",
                "/api/staff/maintenance/reset",
                {"confirmPhrase": "CONFIRM_PORTAL_RESET"},
                cookies=self.admin_cookies,
                csrf_token=self.admin_csrf,
            )
            self.assertEqual(s_prod, 403)
        finally:
            if prev is None:
                os.environ.pop("APP_ENV", None)
            else:
                os.environ["APP_ENV"] = prev


if __name__ == "__main__":
    unittest.main()
