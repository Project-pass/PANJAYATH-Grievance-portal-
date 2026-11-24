from __future__ import annotations

import os
import sqlite3
import sys
import unittest

TESTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
for p in (BACKEND_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from app.core.config import ConfigurationError  # noqa: E402
from app.database.connection import get_adapter, resolve_database_url  # noqa: E402
from app.database.interface import (  # noqa: E402
    RowProxy,
    detect_database_backend,
    is_transient_db_error,
    normalize_postgres_url,
    translate_qmark_sql,
    with_db_retry,
)
from app.database.postgres_adapter import PostgresAdapter, PostgresCursorWrapper  # noqa: E402
from app.services.audit_integrity import verify_audit_chain  # noqa: E402


class PostgresAdapterAndTranslationTests(unittest.TestCase):
    def test_01_qmark_sql_tokenizer_preserves_literals_comments_and_quotes(self):
        sql = """
        -- Does comment ? stay untouched?
        SELECT id, 'literal ? mark' AS lit, "col?name" /* block ? */
        FROM grievances
        WHERE ward = ? AND category = ? AND status != 'ON_HOLD?'
        """
        translated, bound = translate_qmark_sql(sql, (4, "Water Supply"))
        self.assertIn(":p0", translated)
        self.assertIn(":p1", translated)
        self.assertNotIn(":p2", translated)
        self.assertIn("'literal ? mark'", translated)
        self.assertIn('"col?name"', translated)
        self.assertIn("-- Does comment ? stay untouched?", translated)
        self.assertIn("/* block ? */", translated)
        self.assertEqual(bound, {"p0": 4, "p1": "Water Supply"})

    def test_02_qmark_mismatch_raises_value_error(self):
        with self.assertRaises(ValueError):
            translate_qmark_sql("SELECT * FROM staff WHERE id = ? AND role = ?", ("stf-1",))

    def test_03_database_url_detection_and_normalization(self):
        self.assertEqual(detect_database_backend("sqlite:///data/panchayat.db"), "sqlite")
        self.assertEqual(detect_database_backend("postgresql://user:pw@db:5432/panchayat"), "postgresql")
        self.assertEqual(detect_database_backend("postgres://user:pw@db:5432/panchayat"), "postgresql")
        self.assertEqual(
            normalize_postgres_url("postgres://u:p@host:5432/db"),
            "postgresql+psycopg://u:p@host:5432/db",
        )
        self.assertEqual(
            normalize_postgres_url("postgresql://u:p@host:5432/db"),
            "postgresql+psycopg://u:p@host:5432/db",
        )

    def test_04_row_proxy_and_cursor_wrapper_parity(self):
        cur = PostgresCursorWrapper(["id", "ward", "status"], [("ABC-GRV-2026-101", 4, "SUBMITTED")], 1)
        row = cur.fetchone()
        self.assertIsInstance(row, RowProxy)
        self.assertEqual(row["id"], "ABC-GRV-2026-101")
        self.assertEqual(row[1], 4)
        self.assertEqual(list(row.keys()), ["id", "ward", "status"])
        self.assertEqual(row.to_dict(), {"id": "ABC-GRV-2026-101", "ward": 4, "status": "SUBMITTED"})
        self.assertIsNone(cur.fetchone())

    def test_05_transient_error_retry_policy(self):
        attempts = {"n": 0}

        def flaky():
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise sqlite3.OperationalError("database is locked")
            return "recovered"

        self.assertTrue(is_transient_db_error(RuntimeError("deadlock detected")))
        self.assertFalse(is_transient_db_error(ValueError("validation error")))
        self.assertEqual(with_db_retry(flaky, max_attempts=3, base_delay=0.005), "recovered")
        self.assertEqual(attempts["n"], 3)

    def test_06_postgres_adapter_fails_fast_cleanly_if_drivers_absent(self):
        adapter = PostgresAdapter("postgresql://user:pass@localhost:5432/panchayat")
        try:
            import sqlalchemy  # noqa: F401
        except ImportError:
            with self.assertRaises(ConfigurationError):
                adapter.connect()


@unittest.skipUnless(
    bool(os.environ.get("TEST_POSTGRES_URL") or (os.environ.get("DATABASE_URL", "").startswith("postgres"))),
    "Live PostgreSQL instance not configured in this sandbox (set TEST_POSTGRES_URL or DATABASE_URL to execute).",
)
class LivePostgresAcceptanceTests(unittest.TestCase):
    """Full end-to-end PostgreSQL 16 runtime acceptance tests (executed in CI Postgres job)."""

    def test_live_postgres_migrations_crud_triggers_and_audit(self):
        pg_url = os.environ.get("TEST_POSTGRES_URL") or os.environ["DATABASE_URL"]
        os.environ["DATABASE_URL"] = pg_url
        import db as db_mod

        db_mod.init_db()
        adapter = get_adapter()
        self.assertEqual(adapter.backend_name, "postgresql")
        self.assertTrue(adapter.health_check())

        conn = db_mod.get_connection()
        try:
            triggers = adapter.list_audit_triggers(conn)
            self.assertIn("trg_audit_no_update", triggers)
            self.assertIn("trg_audit_no_delete", triggers)
            staff_count = conn.execute("SELECT COUNT(*) AS c FROM staff").fetchone()["c"]
            self.assertGreaterEqual(staff_count, 5)
            report = verify_audit_chain(conn, checkpoint_path=None, jsonl_path=None)
            self.assertTrue(report["ok"], report)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
