from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import unittest
from datetime import datetime, timezone

BACKEND_DIR = str(Path(__file__).resolve().parents[2])
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.config import ConfigurationError, load_or_create_session_secret, validate_session_secret_strength  # noqa: E402
from app.core.logging import sanitize_log_extra  # noqa: E402
from app.policies.rbac import evaluate_rbac, validate_grievance_transition  # noqa: E402
from app.services.sla import compute_sla_metrics, count_working_days, resolve_effective_sla_limit  # noqa: E402
from c_engine.build import CEngineError, build_c_engine, ensure_c_engine_ready, needs_rebuild, verify_c_engine  # noqa: E402
import seed_data  # noqa: E402


class CEngineBuildLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmpdir.name)
        self.src_copy = self.tmp_path / "sla_rbac.c"
        shutil.copy2(Path(BACKEND_DIR) / "c_engine" / "sla_rbac.c", self.src_copy)
        self.bin_path = self.tmp_path / ("sla_rbac.exe" if os.name == "nt" else "sla_rbac")

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_01_missing_binary_rebuilds_and_verifies(self):
        need, reason = needs_rebuild(self.src_copy, self.bin_path)
        self.assertTrue(need)
        self.assertEqual(reason, "binary_missing")
        st = ensure_c_engine_ready(self.src_copy, self.bin_path)
        self.assertTrue(st.compiled_now)
        self.assertTrue(st.executable)
        self.assertTrue(os.access(self.bin_path, os.X_OK))

    def test_02_non_executable_binary_detected_and_rebuilt(self):
        ensure_c_engine_ready(self.src_copy, self.bin_path)
        if os.name != "nt":
            os.chmod(self.bin_path, 0o644)
            need, reason = needs_rebuild(self.src_copy, self.bin_path)
            self.assertTrue(need)
            self.assertEqual(reason, "binary_not_executable")
            st = ensure_c_engine_ready(self.src_copy, self.bin_path)
            self.assertTrue(st.compiled_now)
            self.assertTrue(os.access(self.bin_path, os.X_OK))

    def test_03_outdated_binary_detected_via_mtime_and_rebuilt(self):
        ensure_c_engine_ready(self.src_copy, self.bin_path)
        bin_stat = self.bin_path.stat()
        os.utime(self.src_copy, ns=(bin_stat.st_atime_ns, bin_stat.st_mtime_ns + 5_000_000_000))
        need, reason = needs_rebuild(self.src_copy, self.bin_path)
        self.assertTrue(need)
        self.assertEqual(reason, "binary_outdated")
        st = ensure_c_engine_ready(self.src_copy, self.bin_path)
        self.assertTrue(st.compiled_now)

    def test_04_up_to_date_binary_skips_redundant_compile(self):
        ensure_c_engine_ready(self.src_copy, self.bin_path)
        need, reason = needs_rebuild(self.src_copy, self.bin_path)
        self.assertFalse(need)
        self.assertEqual(reason, "up_to_date")
        st = ensure_c_engine_ready(self.src_copy, self.bin_path)
        self.assertFalse(st.compiled_now)

    def test_05_broken_c_source_raises_meaningful_diagnostic(self):
        broken_src = self.tmp_path / "broken.c"
        broken_src.write_text("int main(void) { SYNTAX_ERROR_HERE; }\n", encoding="utf-8")
        with self.assertRaises(CEngineError) as ctx:
            build_c_engine(broken_src, self.bin_path, force=True)
        self.assertIn("compilation failed", str(ctx.exception))

    def test_06_corrupt_binary_runtime_verify_fails(self):
        fake_bin = self.tmp_path / "fake_sla_rbac"
        fake_bin.write_text("#!/bin/sh\necho '{\"remainingDays\":999}'\n", encoding="utf-8")
        os.chmod(fake_bin, stat.S_IRWXU)
        with self.assertRaises(CEngineError):
            verify_c_engine(fake_bin)


class CoreConfigLoggingAndPolicyTests(unittest.TestCase):
    def test_production_secret_fails_fast_when_missing_or_weak(self):
        prev = os.environ.pop("PANCHAYAT_SESSION_SECRET", None)
        try:
            with self.assertRaises(ConfigurationError):
                load_or_create_session_secret(Path(tempfile.gettempdir()) / "unused_sec", production=True)
            with self.assertRaises(ConfigurationError):
                validate_session_secret_strength("short_secret")
            with self.assertRaises(ConfigurationError):
                validate_session_secret_strength("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            os.environ["PANCHAYAT_SESSION_SECRET"] = "A9!xQ2#mZ7$pW4@rT8^kL5&vN3*cB6_dF1"
            sec = load_or_create_session_secret(Path(tempfile.gettempdir()) / "unused_sec", production=True)
            self.assertGreaterEqual(len(sec), 32)
        finally:
            if prev is None:
                os.environ.pop("PANCHAYAT_SESSION_SECRET", None)
            else:
                os.environ["PANCHAYAT_SESSION_SECRET"] = prev

    def test_dev_secret_persists_with_0600_permissions(self):
        prev = os.environ.pop("PANCHAYAT_SESSION_SECRET", None)
        try:
            with tempfile.TemporaryDirectory() as td:
                sf = Path(td) / ".session_secret"
                s1 = load_or_create_session_secret(sf, production=False)
                s2 = load_or_create_session_secret(sf, production=False)
                self.assertEqual(s1, s2)
                self.assertGreaterEqual(len(s1), 32)
                if os.name != "nt":
                    self.assertEqual(stat.S_IMODE(sf.stat().st_mode), 0o600)
        finally:
            if prev is not None:
                os.environ["PANCHAYAT_SESSION_SECRET"] = prev

    def test_log_redaction_strips_sensitive_keys(self):
        cleaned = sanitize_log_extra(
            {
                "path": "/api/auth/login",
                "passcode": "SecPass2026!",
                "csrfToken": "raw-csrf",
                "cookieHeader": "panchayat_sid=abc",
                "authorization": "Bearer xyz",
            }
        )
        self.assertEqual(cleaned["path"], "/api/auth/login")
        self.assertEqual(cleaned["passcode"], "[REDACTED]")
        self.assertEqual(cleaned["csrfToken"], "[REDACTED]")
        self.assertEqual(cleaned["cookieHeader"], "[REDACTED]")
        self.assertEqual(cleaned["authorization"], "[REDACTED]")

    def test_rbac_deny_by_default_and_jurisdiction(self):
        officer = {
            "id": "stf-1",
            "role": "WARD_OFFICER",
            "department": "Water & Sanitation",
            "assignedWards": [1, 2],
            "isActive": True,
            "permissions": {
                "canApproveCertificates": False,
                "canAssignTickets": False,
                "canManageUsers": False,
                "canDeleteRecords": False,
                "canVerifyDocuments": False,
            },
        }
        self.assertTrue(evaluate_rbac(officer, 1, True, "VIEW").allowed)
        self.assertFalse(evaluate_rbac(officer, 4, True, "VIEW").allowed)
        self.assertFalse(evaluate_rbac(officer, 1, False, "UPDATE").allowed)
        self.assertFalse(evaluate_rbac(officer, 1, True, "MANAGE_USERS").allowed)
        self.assertFalse(evaluate_rbac(officer, 1, True, "UNKNOWN_ACTION").allowed)
        self.assertFalse(evaluate_rbac({**officer, "isActive": False}, 1, True, "VIEW").allowed)
        self.assertFalse(evaluate_rbac({"role": "CITIZEN", "isActive": True}, 1, True, "VIEW").allowed)

    def test_canonical_workflow_transitions_and_notes(self):
        ok, _ = validate_grievance_transition("WARD_OFFICER", "ASSIGNED", "IN_PROGRESS", "")
        self.assertTrue(ok)
        ok_bad_jump, _ = validate_grievance_transition("SUPER_ADMIN", "SUBMITTED", "CLOSED", "done")
        self.assertFalse(ok_bad_jump)
        ok_no_note, _ = validate_grievance_transition("WARD_OFFICER", "IN_PROGRESS", "RESOLVED", "ok")
        self.assertFalse(ok_no_note)
        ok_with_note, _ = validate_grievance_transition("WARD_OFFICER", "IN_PROGRESS", "RESOLVED", "Fixed leaking valve.")
        self.assertTrue(ok_with_note)
        ok_csc_resolve, _ = validate_grievance_transition("CSC_OPERATOR", "IN_PROGRESS", "RESOLVED", "Attempted close")
        self.assertFalse(ok_csc_resolve)
        ok_citizen_reopen, _ = validate_grievance_transition("CITIZEN", "RESOLVED", "REOPENED", "Still leaking badly")
        self.assertTrue(ok_citizen_reopen)

    def test_sla_working_days_priority_and_hold_pause(self):
        self.assertEqual(resolve_effective_sla_limit("Public Health", "CRITICAL"), 1)
        self.assertEqual(resolve_effective_sla_limit("Encroachment", "LOW"), 13)
        # 2026-10-01 (Thu) to 2026-10-05 (Mon) has Fri Oct 2 (Gandhi Jayanti holiday) and Sun Oct 4 -> 2 working days (Sat Oct 3 + Mon Oct 5)
        wd = count_working_days(
            datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc),
            datetime(2026, 10, 5, 17, 0, tzinfo=timezone.utc),
            holidays={"2026-10-02"},
            exclude_sundays=True,
        )
        self.assertEqual(wd, 2)

        sla_paused = compute_sla_metrics(
            "2026-10-01T09:00:00Z",
            "ON_HOLD",
            3,
            now_dt=datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc),
            paused_seconds=86400 * 4,
            hold_started_at_iso="2026-10-06T09:00:00Z",
        )
        self.assertTrue(sla_paused["isOnHold"])
        self.assertFalse(sla_paused["isBreached"])
        self.assertGreater(sla_paused["pausedDays"], 5.0)
        self.assertTrue(sla_paused["label"].startswith("Paused"))

    def test_seed_data_contains_zero_plaintext_pins_or_fake_offsets(self):
        state = seed_data.get_initial_state()
        for st in state["staff"]:
            self.assertNotIn("pin", st)
            self.assertNotIn("passcode", st)
        self.assertEqual(len(state["grievances"]), 8)


if __name__ == "__main__":
    unittest.main()
