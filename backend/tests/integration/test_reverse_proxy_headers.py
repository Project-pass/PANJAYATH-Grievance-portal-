from __future__ import annotations

import os
import sys
import unittest

TESTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
for p in (BACKEND_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from helpers import IsolatedServerTestCase  # noqa: E402


class ReverseProxyHeaderAndCorsTests(IsolatedServerTestCase):
    def test_forwarded_host_origin_match_and_csrf_cookie_behind_proxy(self):
        # Simulate Nginx proxy forwarding Origin=https://portal.abcpanchayat.gov.in with X-Forwarded-Host
        st, hdrs, _raw, cookies, data = self.request(
            "POST",
            "/api/auth/bootstrap-claim",
            {"passcode": "ProxyPass#2026"},
            headers={
                "Origin": "https://portal.abcpanchayat.gov.in",
                "Host": "api:3001",
                "X-Forwarded-Host": "portal.abcpanchayat.gov.in",
                "X-Forwarded-Proto": "https",
            },
        )
        self.assertEqual(st, 200, data)
        self.assertEqual(hdrs.get("access-control-allow-origin"), "https://portal.abcpanchayat.gov.in")
        self.assertEqual(hdrs.get("access-control-allow-credentials"), "true")
        self.assertIn("default-src 'self'", hdrs.get("content-security-policy", ""))
        self.assertIn("panchayat_sid", cookies)
        self.assertIn("panchayat_csrf", cookies)

    def test_cross_origin_spoof_rejected_even_behind_proxy(self):
        st, _hdrs, _raw, _cookies, data = self.request(
            "POST",
            "/api/auth/login",
            {"identifier": "admin_test", "passcode": "ProxyPass#2026"},
            headers={
                "Origin": "https://evil.example.com",
                "Host": "api:3001",
                "X-Forwarded-Host": "portal.abcpanchayat.gov.in",
            },
        )
        self.assertEqual(st, 403, data)


if __name__ == "__main__":
    unittest.main()
