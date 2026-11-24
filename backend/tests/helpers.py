from __future__ import annotations

import http.client
from http.cookies import SimpleCookie
import json
import os
import sys
import tempfile
import threading
import unittest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
for p in (BACKEND_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import db  # noqa: E402
import maintenance  # noqa: E402
import security_utils  # noqa: E402
import server  # noqa: E402


class IsolatedServerTestCase(unittest.TestCase):
    """Base TestCase spinning up an isolated ThreadingHTTPServer + SQLite WAL DB."""

    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.TemporaryDirectory()
        cls.test_db_path = os.path.join(cls.tmpdir.name, "test_panchayat.db")
        cls.test_audit_path = os.path.join(cls.tmpdir.name, "test_audit.jsonl")
        cls.test_backup_dir = os.path.join(cls.tmpdir.name, "backups")

        cls._orig_db_sqlite = db.SQLITE_PATH
        cls._orig_db_audit = db.AUDIT_JSONL_PATH
        cls._orig_srv_sqlite = server.SQLITE_PATH
        cls._orig_maint_sqlite = maintenance.SQLITE_PATH
        cls._orig_maint_backup = maintenance.BACKUP_DIR
        cls._orig_env_pass = os.environ.pop("PANCHAYAT_SECRETARY_PASSCODE", None)
        cls._orig_sec_cache = security_utils._SESSION_SECRET_CACHE

        db.SQLITE_PATH = cls.test_db_path
        db.AUDIT_JSONL_PATH = cls.test_audit_path
        server.SQLITE_PATH = cls.test_db_path
        maintenance.SQLITE_PATH = cls.test_db_path
        maintenance.BACKUP_DIR = cls.test_backup_dir
        server.RATE_LIMITER._hits.clear()

        db.init_db(cls.test_db_path)

        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.PanchayatApiHandler)
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
        maintenance.SQLITE_PATH = cls._orig_maint_sqlite
        maintenance.BACKUP_DIR = cls._orig_maint_backup
        security_utils._SESSION_SECRET_CACHE = cls._orig_sec_cache
        if cls._orig_env_pass is not None:
            os.environ["PANCHAYAT_SECRETARY_PASSCODE"] = cls._orig_env_pass
        cls.tmpdir.cleanup()

    def request(
        self,
        method: str,
        path: str,
        body=None,
        headers: dict | None = None,
        cookies: dict[str, str] | None = None,
        csrf_token: str | None = None,
    ):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = dict(headers or {})
        if cookies:
            cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())
            if "Cookie" in hdrs:
                hdrs["Cookie"] = f"{hdrs['Cookie']}; {cookie_header}"
            else:
                hdrs["Cookie"] = cookie_header
        if csrf_token and "X-CSRF-Token" not in hdrs:
            hdrs["X-CSRF-Token"] = csrf_token

        payload = None
        if body is not None:
            if isinstance(body, (dict, list)):
                payload = json.dumps(body).encode("utf-8")
                hdrs.setdefault("Content-Type", "application/json")
            else:
                payload = body if isinstance(body, bytes) else str(body).encode("utf-8")
        conn.request(method, path, body=payload, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8", errors="replace")
        resp_headers = {k.lower(): v for k, v in resp.getheaders()}
        set_cookies_raw = [v for k, v in resp.getheaders() if k.lower() == "set-cookie"]
        parsed_cookies: dict[str, str] = {}
        for sc in set_cookies_raw:
            first = sc.split(";", 1)[0].strip()
            if "=" in first:
                cname, cval = first.split("=", 1)
                parsed_cookies[cname.strip()] = cval.strip()
        conn.close()
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            data = {"raw": raw}
        return resp.status, resp_headers, set_cookies_raw, parsed_cookies, data

    def login_with_cookies(self, identifier: str, passcode: str):
        status, hdrs, set_raw, cookies, data = self.request(
            "POST",
            "/api/auth/login",
            {"identifier": identifier, "passcode": passcode},
        )
        csrf = data.get("csrfToken") or cookies.get("panchayat_csrf")
        return status, hdrs, set_raw, cookies, csrf, data
