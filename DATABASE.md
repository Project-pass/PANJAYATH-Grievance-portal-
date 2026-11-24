# Database Architecture & Schema

## 1. Dual-Engine Runtime (`DATABASE_URL`-Driven)
- **PostgreSQL 16 Production Runtime (`DATABASE_URL=postgresql+psycopg://...`)**:
  - `PostgresAdapter` (`backend/app/database/postgres_adapter.py`) uses SQLAlchemy 2.x `QueuePool` (`pool_size=10`, `max_overflow=20`, `pool_pre_ping=True`, `pool_recycle=1800`) and `psycopg` 3.
  - Full 18-table ORM metadata (`backend/app/database/postgres_models.py`) and Alembic migrations (`0001_initial_schema.py`, `0002_complete_schema_and_audit_chain.py`).
  - Portable parameterized queries (`translate_qmark_sql`) and automatic transient-connection retry (`with_db_retry`).
- **SQLite WAL Sandbox / Embedded Runtime (Default when `DATABASE_URL` is unset or `sqlite:///...`)**:
  - `SQLiteAdapter` (`backend/app/database/sqlite_adapter.py`) configures `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, and serialized `BEGIN IMMEDIATE` write locks (`backend/db.py`).
- **Cloud Identity & Rules**: Firebase Authentication + Firestore rules (`firestore.rules`, `firebase-blueprint.json`, `firestore.rules.test.mjs`).

## 2. Schema Version 4 Tables (`backend/db.py` & Alembic `0002`)
1. **`schema_migrations`**: Tracks applied SQLite migration versions (`1`, `2`, `3`, `4`).
2. **`config`**: Portal-wide policy settings (`slaLimitDays`).
3. **`wards`**: Reference table for Wards `1..15` (`CHECK(ward_number BETWEEN 1 AND 15)`).
4. **`departments`**: Panchayat departments (`General Administration`, `Roads & Streetlights`, `Water & Sanitation`, `Public Health`, `Revenue & Certificates`, `Building & Planning`).
5. **`grievance_categories`**: Maps grievance categories to departments and default SLA days.
6. **`sla_policies`**: `(category, priority)` matrix computing effective deadlines (`1..30` days).
7. **`holidays`**: Panchayat/national non-working dates (`YYYY-MM-DD`) excluded from SLA working-day calculations alongside Sundays.
8. **`staff`**: Staff accounts with `external_uuid`, `username`, `email`, `passcode_hash` (`scrypt`), `role`, `assigned_wards_json`, `permissions_json`, lockout counters (`failed_attempts`, `locked_until` as `DOUBLE PRECISION`), `is_active` (`BOOLEAN`), and `is_claimed` (`BOOLEAN`).
9. **`sessions`**: Active sessions storing `token_hash`, `csrf_token_hash`, `expires_at`, `last_seen_at`, `ip_hash`, and `token_prefix`.
10. **`grievances`**: Full grievance records with `external_uuid`, canonical status `CHECK` constraint (`SUBMITTED`..`REOPENED`), `priority`, `sla_limit_days`, `paused_seconds`, `hold_started_at`, `escalated_at`, `escalation_level`, `consent_recorded`, masked `mobile_last4`, `rating` (`1..5`), and `tracking_token_hash`.
11. **`grievance_status_history`**: Normalized transition history (`from_status`, `to_status`, actor, remark, `created_at`).
12. **`grievance_assignments`**: Assignment history linking grievances to officers and assigning admin.
13. **`grievance_comments`**: Public and internal staff comments (`is_internal` `BOOLEAN`).
14. **`services`**: Citizen statutory service applications (`Submitted`..`Rejected`).
15. **`attachments`**: Metadata for service checklist declarations and attachments.
16. **`notifications`**: In-app assignment and SLA escalation alerts.
17. **`audit_logs`**: Append-only, HMAC-SHA256 hash-chained audit events (`seq_no`, `prev_hash`, `event_hash`) protected by SQLite abort triggers (`trg_audit_no_update`, `trg_audit_no_delete`) and PostgreSQL PL/pgSQL `prevent_append_only_mutation()` triggers.
18. **`security_alerts`**: Append-only security events (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) protected by `BEFORE UPDATE` / `BEFORE DELETE` immutability triggers in both SQLite and PostgreSQL.
19. **`audit_checkpoints`**: Persisted signed checkpoints (`checkpoint_id`, `seq_no`, `event_id`, `event_hash`, `record_count`, `signature`) plus external mirror `audit_checkpoints.jsonl`.

## 3. Indexes
- `idx_grievances_ward_dept_status(ward, department, status)`
- `idx_grievances_created_at(created_at DESC)`
- `idx_grievances_uuid(external_uuid)`
- `idx_services_ward_dept_status(ward, department, status)`
- `idx_services_uuid(external_uuid)`
- `idx_audit_timestamp(timestamp DESC)`
- `idx_audit_seq_no(seq_no)`
- `idx_status_hist_gid(grievance_id, created_at)`
- `idx_notifications_target(target_id, created_at DESC)`

## 4. Schema Migration & Upgrade Behavior
- `init_db()` automatically upgrades v1/v2/v3 SQLite databases to v4, backfills existing `audit_logs` rows with deterministic cryptographic `seq_no`/`prev_hash`/`event_hash` values while temporarily dropping and immediately re-creating immutability triggers inside the migration transaction.
- `alembic -c backend/alembic.ini upgrade head` applies migrations `0001` and `0002` on PostgreSQL 16 (executed automatically in `scripts/docker-entrypoint.sh` when `DATABASE_URL` points to PostgreSQL).
