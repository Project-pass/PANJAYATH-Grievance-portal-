# Database Architecture & Schema

## 1. Engines & Parity
- **Sandbox / Local Runtime**: SQLite 3 with `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, and `BEGIN IMMEDIATE` write transactions (`backend/db.py`).
- **Production Relational Target**: PostgreSQL 16 ORM models (`backend/app/database/postgres_models.py`) and Alembic migration configuration (`backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/versions/0001_initial_schema.py`).
- **Cloud Identity / Rules**: Firebase Authentication + Firestore rules (`firestore.rules`, `firebase-blueprint.json`).

## 2. Schema Version 3 Tables (`backend/db.py`)
1. **`schema_migrations`**: Tracks applied migration versions (`1`, `2`, `3`).
2. **`config`**: Portal-wide policy settings (`slaLimitDays`).
3. **`wards`**: Reference table for Wards `1..15` (`CHECK(ward_number BETWEEN 1 AND 15)`).
4. **`departments`**: Panchayat departments (`General Administration`, `Roads & Streetlights`, `Water & Sanitation`, `Public Health`, `Revenue & Certificates`, `Building & Planning`).
5. **`grievance_categories`**: Maps grievance categories to departments and default SLA days.
6. **`sla_policies`**: `(category, priority)` matrix computing effective deadlines (`1..30` days).
7. **`holidays`**: Panchayat/national non-working dates (`YYYY-MM-DD`) excluded from SLA working-day calculations alongside Sundays.
8. **`staff`**: Staff accounts with `external_uuid`, `username`, `email`, `passcode_hash` (`scrypt`), `role`, `assigned_wards_json`, `permissions_json`, lockout counters (`failed_attempts`, `locked_until`), and `is_claimed`.
9. **`sessions`**: Active sessions storing `token_hash`, `csrf_token_hash`, `expires_at`, `last_seen_at`, `ip_hash`, and `token_prefix`.
10. **`grievances`**: Full grievance records with `external_uuid`, canonical status `CHECK` constraint (`SUBMITTED`, `ACKNOWLEDGED`, `ASSIGNED`, `IN_PROGRESS`, `ON_HOLD`, `ESCALATED`, `RESOLVED`, `CLOSED`, `REJECTED`, `REOPENED`), `priority` (`LOW`, `NORMAL`, `HIGH`, `CRITICAL`), `sla_limit_days`, `paused_seconds`, `hold_started_at`, `escalated_at`, `escalation_level`, `consent_recorded`, masked last-4 mobile, `rating` (`1..5`), and `tracking_token_hash`.
11. **`grievance_status_history`**: Normalized transition history (`from_status`, `to_status`, actor, remark, `created_at`).
12. **`grievance_assignments`**: Assignment history linking grievances to officers and assigning admin.
13. **`grievance_comments`**: Public and internal staff comments (`is_internal`).
14. **`services`**: Citizen statutory service applications (`Submitted`, `Pending Verification`, `Documents Verified`, `Correction Needed`, `Approved`, `Rejected`).
15. **`attachments`**: Metadata for service checklist declarations and attachments.
16. **`notifications`**: In-app assignment and SLA escalation alerts.
17. **`audit_logs`**: Append-only audit events protected by `trg_audit_no_update` and `trg_audit_no_delete` SQLite abort triggers.
18. **`security_alerts`**: Append-only security events (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) protected by `trg_alerts_no_update` and `trg_alerts_no_delete`.

## 3. Indexes
- `idx_grievances_ward_dept_status(ward, department, status)`
- `idx_grievances_created_at(created_at DESC)`
- `idx_grievances_uuid(external_uuid)`
- `idx_services_ward_dept_status(ward, department, status)`
- `idx_services_uuid(external_uuid)`
- `idx_audit_timestamp(timestamp DESC)`
- `idx_status_hist_gid(grievance_id, created_at)`
- `idx_notifications_target(target_id, created_at DESC)`

## 4. Schema Migration & Upgrade Behavior
`init_db()` automatically upgrades v1/v2 databases to v3 by adding `external_uuid`, `csrf_token_hash`, `request_id`, rebuilding `grievances` with canonical status mapping (`Pending` -> `SUBMITTED`, `Field Inspection` -> `IN_PROGRESS`, etc.), and seeding reference tables idempotently.

## 5. PostgreSQL Deployment Notes
The Alembic baseline (`0001_initial_schema`) has been compiled and syntax-checked in Python, while execution against a live PostgreSQL server requires provisioning a PostgreSQL 16 instance and installing `requirements.txt` (`SQLAlchemy`, `alembic`, `psycopg[binary]`).
