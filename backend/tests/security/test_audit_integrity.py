from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest

TESTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
for p in (BACKEND_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import db  # noqa: E402
import maintenance  # noqa: E402
from app.services.audit import export_audit_logs_json  # noqa: E402
from app.services.audit_integrity import (  # noqa: E402
    compute_event_hash,
    resolve_audit_hmac_key,
    verify_audit_chain,
)
from helpers import IsolatedServerTestCase  # noqa: E402


class AuditIntegrityChainTests(IsolatedServerTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Claim Secretary and create several authenticated audit events
        st, _, _, cookies, data = cls().request(
            "POST", "/api/auth/bootstrap-claim", {"passcode": "SecAdmin#2026"}
        )
        assert st == 200, f"Bootstrap claim failed: {data}"
        cls.sec_cookies = cookies
        cls.sec_csrf = data["csrfToken"]

    def _create_isolated_copy(self, tmpdir: str):
        copy_db = os.path.join(tmpdir, "tamper.db")
        copy_cp = os.path.join(tmpdir, "checkpoints.jsonl")
        copy_jl = os.path.join(tmpdir, "audit.jsonl")

        src = sqlite3.connect(self.test_db_path)
        dst = sqlite3.connect(copy_db)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()

        with open(self.test_checkpoints_path, "r", encoding="utf-8") as f:
            with open(copy_cp, "w", encoding="utf-8") as out:
                out.write(f.read())
        with open(self.test_audit_path, "r", encoding="utf-8") as f:
            with open(copy_jl, "w", encoding="utf-8") as out:
                out.write(f.read())
        return copy_db, copy_cp, copy_jl

    def test_01_valid_chain_checkpoints_and_api_verify_pass(self):
        # Generate extra events via API
        st, _, _, _, res = self.request(
            "PUT",
            "/api/staff/config/sla",
            {"slaLimitDays": 8},
            cookies=self.sec_cookies,
            csrf_token=self.sec_csrf,
        )
        self.assertEqual(st, 200, res)

        st_v, _, _, _, data_v = self.request(
            "GET",
            "/api/staff/audit/verify",
            cookies=self.sec_cookies,
        )
        self.assertEqual(st_v, 200, data_v)
        self.assertTrue(data_v["ok"])
        self.assertTrue(data_v["verification"]["ok"])
        self.assertGreaterEqual(data_v["verification"]["verifiedRecords"], 4)
        self.assertGreaterEqual(data_v["verification"]["checkpointsVerified"], 2)

        # Verify CLI maintenance command exits 0
        proc = subprocess.run(
            [
                sys.executable,
                os.path.join(BACKEND_DIR, "maintenance.py"),
                "audit-verify",
                "--checkpoints",
                self.test_checkpoints_path,
                "--jsonl",
                self.test_audit_path,
            ],
            env={**os.environ, "PANCHAYAT_SQLITE_PATH": self.test_db_path},
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        cli_out = json.loads(proc.stdout)
        self.assertTrue(cli_out["ok"])

    def test_02_modified_event_payload_fails_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy_db, copy_cp, copy_jl = self._create_isolated_copy(tmp)
            raw = sqlite3.connect(copy_db)
            raw.row_factory = sqlite3.Row
            raw.execute("DROP TRIGGER IF EXISTS trg_audit_no_update;")
            raw.execute("UPDATE audit_logs SET details = 'TAMPERED DETAILS' WHERE seq_no = 1;")
            raw.commit()
            raw.close()

            conn = db.get_adapter(copy_db).connect()
            try:
                report = verify_audit_chain(conn, checkpoint_path=copy_cp, jsonl_path=copy_jl)
                self.assertFalse(report["ok"])
                self.assertTrue(any("HMAC mismatch" in e for e in report["errors"]))
            finally:
                conn.close()

    def test_03_deleted_middle_event_fails_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy_db, copy_cp, copy_jl = self._create_isolated_copy(tmp)
            raw = sqlite3.connect(copy_db)
            raw.execute("DROP TRIGGER IF EXISTS trg_audit_no_delete;")
            raw.execute("DELETE FROM audit_logs WHERE seq_no = 2;")
            raw.commit()
            raw.close()

            conn = db.get_adapter(copy_db).connect()
            try:
                report = verify_audit_chain(conn, checkpoint_path=copy_cp, jsonl_path=copy_jl)
                self.assertFalse(report["ok"])
                self.assertTrue(any("gap" in e.lower() or "prev_hash" in e.lower() for e in report["errors"]))
            finally:
                conn.close()

    def test_04_deleted_tail_event_detected_via_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy_db, copy_cp, copy_jl = self._create_isolated_copy(tmp)
            raw = sqlite3.connect(copy_db)
            max_seq = raw.execute("SELECT MAX(seq_no) FROM audit_logs").fetchone()[0]
            raw.execute("DROP TRIGGER IF EXISTS trg_audit_no_delete;")
            raw.execute("DELETE FROM audit_logs WHERE seq_no = ?", (max_seq,))
            raw.commit()
            raw.close()

            conn = db.get_adapter(copy_db).connect()
            try:
                report = verify_audit_chain(conn, checkpoint_path=copy_cp, jsonl_path=copy_jl)
                self.assertFalse(report["ok"])
                self.assertTrue(any("tail deletion" in e.lower() for e in report["errors"]))
            finally:
                conn.close()

    def test_05_reordered_events_fail_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy_db, copy_cp, copy_jl = self._create_isolated_copy(tmp)
            raw = sqlite3.connect(copy_db)
            raw.execute("DROP TRIGGER IF EXISTS trg_audit_no_update;")
            raw.execute("DROP INDEX IF EXISTS idx_audit_seq_no;")
            raw.execute("UPDATE audit_logs SET seq_no = 99 WHERE seq_no = 1;")
            raw.execute("UPDATE audit_logs SET seq_no = 1 WHERE seq_no = 2;")
            raw.execute("UPDATE audit_logs SET seq_no = 2 WHERE seq_no = 99;")
            raw.commit()
            raw.close()

            conn = db.get_adapter(copy_db).connect()
            try:
                report = verify_audit_chain(conn, checkpoint_path=copy_cp, jsonl_path=copy_jl)
                self.assertFalse(report["ok"])
                self.assertTrue(len(report["errors"]) >= 1)
            finally:
                conn.close()

    def test_06_forged_checkpoint_signature_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy_db, copy_cp, copy_jl = self._create_isolated_copy(tmp)
            with open(copy_cp, "r", encoding="utf-8") as f:
                lines = [l for l in f.read().splitlines() if l.strip()]
            forged = json.loads(lines[-1])
            forged["signature"] = "f" * 64
            lines[-1] = json.dumps(forged)
            with open(copy_cp, "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")

            conn = db.get_adapter(copy_db).connect()
            try:
                report = verify_audit_chain(conn, checkpoint_path=copy_cp, jsonl_path=copy_jl)
                self.assertFalse(report["ok"])
                self.assertTrue(any("checkpoint signature" in e.lower() for e in report["errors"]))
            finally:
                conn.close()

    def test_07_direct_sql_mutation_blocked_and_json_export_verifies(self):
        conn = db.get_connection(self.test_db_path)
        try:
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("UPDATE audit_logs SET details = 'HACK' WHERE seq_no = 1;")
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("DELETE FROM audit_logs WHERE seq_no = 1;")

            exported = json.loads(export_audit_logs_json(conn))
            self.assertGreaterEqual(len(exported), 4)
            key = resolve_audit_hmac_key()
            for item in exported:
                expected = compute_event_hash(item, key)
                self.assertEqual(item["eventHash"] if "eventHash" in item else item["event_hash"], expected)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
