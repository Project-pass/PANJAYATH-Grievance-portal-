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
import db  # noqa: E402


class EndToEndGrievanceJourneyTests(IsolatedServerTestCase):
    def test_full_civic_and_staff_lifecycle(self):
        # 1. Secretary claims initial portal credentials
        s_claim, _, _, admin_cookies, claim_data = self.request(
            "POST",
            "/api/auth/bootstrap-claim",
            {"passcode": "E2ESecretary2026!"},
        )
        self.assertEqual(s_claim, 200)
        admin_csrf = claim_data["csrfToken"]

        # 2. Secretary creates Ward 3 Roads Officer
        s_off, _, _, _, off_data = self.request(
            "POST",
            "/api/staff/users",
            {
                "name": "Ward3 Roads Officer",
                "username": "e2e_ward3",
                "email": "e2e.ward3@abcgram.gov.in",
                "passcode": "E2EOfficer1!",
                "designation": "Roads Overseer",
                "role": "WARD_OFFICER",
                "department": "Roads & Streetlights",
                "assignedWards": [3],
                "isActive": True,
                "permissions": {
                    "canApproveCertificates": False,
                    "canAssignTickets": False,
                    "canManageUsers": False,
                    "canDeleteRecords": False,
                    "canVerifyDocuments": False,
                },
            },
            cookies=admin_cookies,
            csrf_token=admin_csrf,
        )
        self.assertEqual(s_off, 201)

        # 3. Citizen submits HIGH priority Streetlights grievance in Ward 3
        s_sub, _, _, _, sub_data = self.request(
            "POST",
            "/api/public/grievances",
            {
                "citizenName": "Meera Nair",
                "mobile": "9847001122",
                "ward": 3,
                "category": "Streetlights",
                "priority": "HIGH",
                "landmark": "Panchayat Library Junction",
                "description": "High-mast streetlight pole #9 is completely dark near Library Junction.",
                "consentAccepted": True,
            },
        )
        self.assertEqual(s_sub, 201)
        tid = sub_data["ticket"]["id"]
        tk = sub_data["trackingToken"]
        self.assertEqual(sub_data["ticket"]["priority"], "HIGH")
        self.assertEqual(sub_data["ticket"]["status"], "ASSIGNED")

        # 4. Second citizen submits similar issue -> duplicate warning returned
        s_dup, _, _, _, dup_data = self.request(
            "POST",
            "/api/public/grievances",
            {
                "citizenName": "Rajan Pillai",
                "mobile": "9847003344",
                "ward": 3,
                "category": "Streetlights",
                "priority": "NORMAL",
                "landmark": "Library Junction",
                "description": "Dark streetlight pole near Library Junction needs bulb repair.",
                "consentAccepted": True,
            },
        )
        self.assertEqual(s_dup, 201)
        dup_ids = [d["id"] for d in dup_data.get("potentialDuplicates", [])]
        self.assertIn(tid, dup_ids)

        # 5. Ward 3 officer logs in, moves ticket IN_PROGRESS -> ON_HOLD -> RESOLVED + adds comment
        s_ol, _, _, off_cookies, off_csrf, _ = self.login_with_cookies("e2e_ward3", "E2EOfficer1!")
        self.assertEqual(s_ol, 200)

        s_p1, _, _, _, _ = self.request(
            "PATCH",
            f"/api/staff/grievances/{tid}",
            {"status": "IN_PROGRESS", "publicRemark": "Lineman dispatched to inspect pole."},
            cookies=off_cookies,
            csrf_token=off_csrf,
        )
        self.assertEqual(s_p1, 200)

        s_hold, _, _, _, hold_res = self.request(
            "PATCH",
            f"/api/staff/grievances/{tid}",
            {"status": "ON_HOLD", "publicRemark": "Waiting for replacement LED fixture stock."},
            cookies=off_cookies,
            csrf_token=off_csrf,
        )
        self.assertEqual(s_hold, 200)
        self.assertTrue(hold_res["ticket"]["sla"]["isOnHold"])

        s_cmt, _, _, _, _ = self.request(
            "POST",
            f"/api/staff/grievances/{tid}/comments",
            {"body": "Fixture received from central store.", "isInternal": False},
            cookies=off_cookies,
            csrf_token=off_csrf,
        )
        self.assertEqual(s_cmt, 201)

        s_res, _, _, _, res_data = self.request(
            "PATCH",
            f"/api/staff/grievances/{tid}",
            {"status": "RESOLVED", "publicRemark": "LED luminaire replaced and tested at 19:00."},
            cookies=off_cookies,
            csrf_token=off_csrf,
        )
        self.assertEqual(s_res, 200)
        self.assertEqual(res_data["ticket"]["status"], "RESOLVED")

        # 6. Citizen tracks ticket, submits 5-star feedback, then reopens due to recurrence
        s_trk, _, _, _, trk = self.request(
            "POST",
            "/api/public/track",
            {"trackingId": tid, "trackingToken": tk, "mobileLast4": "1122"},
        )
        self.assertEqual(s_trk, 200)
        self.assertEqual(trk["record"]["status"], "RESOLVED")

        s_fb, _, _, _, fb = self.request(
            "POST",
            f"/api/public/grievances/{tid}/feedback",
            {"trackingToken": tk, "mobileLast4": "1122", "rating": 5, "comment": "Quick action!"},
        )
        self.assertEqual(s_fb, 200)
        self.assertEqual(fb["record"]["rating"], 5)

        s_reo, _, _, _, reo = self.request(
            "POST",
            f"/api/public/grievances/{tid}/reopen",
            {"trackingToken": tk, "mobileLast4": "1122", "reason": "Light went off again after rain."},
        )
        self.assertEqual(s_reo, 200)
        self.assertEqual(reo["record"]["status"], "REOPENED")

        # 7. Verify status history & audit logs recorded the full journey
        conn = db.get_connection(self.test_db_path)
        try:
            hist = conn.execute(
                "SELECT to_status FROM grievance_status_history WHERE grievance_id = ? ORDER BY created_at ASC",
                (tid,),
            ).fetchall()
            statuses = [h["to_status"] for h in hist]
            self.assertIn("ASSIGNED", statuses)
            self.assertIn("IN_PROGRESS", statuses)
            self.assertIn("ON_HOLD", statuses)
            self.assertIn("RESOLVED", statuses)
            self.assertIn("REOPENED", statuses)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
