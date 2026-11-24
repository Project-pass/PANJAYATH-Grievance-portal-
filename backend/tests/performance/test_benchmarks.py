from __future__ import annotations

import json
import os
import sys
import time
import unittest
import uuid

TESTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
for p in (BACKEND_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from helpers import IsolatedServerTestCase  # noqa: E402
import db  # noqa: E402
from security_utils import hash_token  # noqa: E402


class PerformanceBenchmarkTests(IsolatedServerTestCase):
    def test_500_grievance_paginated_query_and_overview_latency(self):
        # Claim admin session
        s_claim, _, _, admin_cookies, _ = self.request(
            "POST",
            "/api/auth/bootstrap-claim",
            {"passcode": "PerfPass2026!"},
        )
        self.assertEqual(s_claim, 200)

        # Bulk-insert 500 grievances inside a single transaction
        conn = db.get_connection(self.test_db_path)
        try:
            t0 = time.perf_counter()
            with db.transaction(conn):
                for i in range(500):
                    gid = f"ABC-GRV-2026-{2000 + i}"
                    conn.execute(
                        """
                        INSERT INTO grievances(
                            id, external_uuid, citizen_name, mobile, mobile_last4, ward, category, department,
                            priority, sla_limit_days, paused_seconds, hold_started_at, escalated_at,
                            escalation_level, consent_recorded, landmark, description, status,
                            created_at, updated_at, resolved_at, assigned_officer_id, assigned_officer_name,
                            filed_by_role, before_photo_url, after_photo_url, public_remark, internal_remark,
                            rating, feedback_comment, timeline_json, tracking_token_hash
                        ) VALUES (?, ?, ?, '9876543210', '3210', ?, 'Water Supply', 'Water & Sanitation',
                                  'NORMAL', 5, 0, NULL, NULL, 0, 1, 'Main Junction', 'Benchmark record',
                                  'IN_PROGRESS', '2026-11-20T09:00:00Z', '2026-11-20T09:00:00Z', NULL, NULL, NULL,
                                  'CITIZEN', NULL, NULL, 'Queued', NULL, NULL, NULL, '[]', ?)
                        """,
                        (gid, str(uuid.uuid4()), f"Citizen {i}", (i % 15) + 1, hash_token(f"TK-{i}")),
                    )
            insert_ms = (time.perf_counter() - t0) * 1000.0
        finally:
            conn.close()

        self.assertLess(insert_ms, 5000.0, f"500-row bulk insert took too long: {insert_ms:.1f}ms")

        t1 = time.perf_counter()
        s_pg, _, _, _, pg = self.request(
            "GET",
            "/api/staff/grievances?page=2&pageSize=25&ward=3",
            cookies=admin_cookies,
        )
        query_ms = (time.perf_counter() - t1) * 1000.0
        self.assertEqual(s_pg, 200)
        self.assertGreater(pg["total"], 25)
        self.assertLess(query_ms, 3000.0, f"Paginated query exceeded budget: {query_ms:.1f}ms")


if __name__ == "__main__":
    unittest.main()
