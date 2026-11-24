"""Complete production PostgreSQL schema, constraints, indexes, hash-chain columns, and immutable triggers.

Revision ID: 0002_complete_schema_and_audit_chain
Revises: 0001_initial_schema
Create Date: 2026-11-24
"""
from __future__ import annotations

revision = "0002_complete_schema_and_audit_chain"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa

    # Align staff.locked_until to DOUBLE PRECISION for Unix epoch floats
    op.alter_column(
        "staff",
        "locked_until",
        existing_type=sa.Integer(),
        type_=sa.Float(precision=53),
        existing_nullable=False,
        postgresql_using="locked_until::double precision",
    )

    # Expand grievances columns to match runtime schema v4
    op.add_column("grievances", sa.Column("consent_recorded", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("grievances", sa.Column("assigned_officer_name", sa.String(120)))
    op.add_column("grievances", sa.Column("filed_by_role", sa.String(32), nullable=False, server_default="CITIZEN"))
    op.add_column("grievances", sa.Column("before_photo_url", sa.Text()))
    op.add_column("grievances", sa.Column("after_photo_url", sa.Text()))
    op.add_column("grievances", sa.Column("feedback_comment", sa.Text()))
    op.add_column("grievances", sa.Column("timeline_json", sa.Text(), nullable=False, server_default="[]"))

    op.create_check_constraint("ck_staff_role", "staff", "role IN ('SUPER_ADMIN','WARD_OFFICER','CSC_OPERATOR')")
    op.create_check_constraint("ck_grv_mobile_last4", "grievances", "length(mobile_last4) = 4")
    op.create_check_constraint("ck_grv_ward", "grievances", "ward BETWEEN 1 AND 15")
    op.create_check_constraint("ck_grv_priority", "grievances", "priority IN ('LOW','NORMAL','HIGH','CRITICAL')")
    op.create_check_constraint("ck_grv_sla_limit", "grievances", "sla_limit_days BETWEEN 1 AND 30")
    op.create_check_constraint("ck_grv_paused_nonneg", "grievances", "paused_seconds >= 0")
    op.create_check_constraint("ck_grv_esc_nonneg", "grievances", "escalation_level >= 0")
    op.create_check_constraint(
        "ck_grv_status",
        "grievances",
        "status IN ('SUBMITTED','ACKNOWLEDGED','ASSIGNED','IN_PROGRESS','ON_HOLD','ESCALATED','RESOLVED','CLOSED','REJECTED','REOPENED')",
    )
    op.create_check_constraint("ck_grv_rating", "grievances", "rating IS NULL OR (rating BETWEEN 1 AND 5)")

    op.create_table(
        "config",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.String(64), nullable=False),
    )

    op.create_table(
        "grievance_categories",
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("department", sa.String(80), sa.ForeignKey("departments.name", onupdate="CASCADE"), nullable=False),
        sa.Column("default_sla_days", sa.Integer(), nullable=False),
        sa.CheckConstraint("default_sla_days BETWEEN 1 AND 30", name="ck_gcat_sla_days"),
    )

    op.create_table(
        "sla_policies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("deadline_days", sa.Integer(), nullable=False),
        sa.UniqueConstraint("category", "priority", name="uq_sla_cat_priority"),
        sa.CheckConstraint("priority IN ('LOW','NORMAL','HIGH','CRITICAL')", name="ck_sla_priority"),
        sa.CheckConstraint("deadline_days BETWEEN 1 AND 30", name="ck_sla_deadline_days"),
    )

    op.create_table(
        "holidays",
        sa.Column("holiday_date", sa.String(16), primary_key=True),
        sa.Column("label", sa.String(120), nullable=False),
    )

    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(128), primary_key=True),
        sa.Column("csrf_token_hash", sa.String(128)),
        sa.Column("staff_id", sa.String(64), sa.ForeignKey("staff.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("expires_at", sa.Float(precision=53), nullable=False),
        sa.Column("last_seen_at", sa.Float(precision=53), nullable=False),
        sa.Column("ip_hash", sa.String(64), nullable=False),
        sa.Column("token_prefix", sa.String(32), nullable=False),
    )

    op.create_table(
        "grievance_status_history",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("grievance_id", sa.String(64), sa.ForeignKey("grievances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(32)),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("actor_name", sa.String(120), nullable=False),
        sa.Column("actor_role", sa.String(32), nullable=False),
        sa.Column("remark", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(64), nullable=False),
    )

    op.create_table(
        "grievance_assignments",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("grievance_id", sa.String(64), sa.ForeignKey("grievances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("officer_id", sa.String(64), sa.ForeignKey("staff.id", ondelete="SET NULL")),
        sa.Column("officer_name", sa.String(120)),
        sa.Column("assigned_by_id", sa.String(64), nullable=False),
        sa.Column("assigned_at", sa.String(64), nullable=False),
    )

    op.create_table(
        "grievance_comments",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("grievance_id", sa.String(64), sa.ForeignKey("grievances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.String(64), nullable=False),
        sa.Column("author_name", sa.String(120), nullable=False),
        sa.Column("is_internal", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(64), nullable=False),
    )

    op.create_table(
        "services",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("external_uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("service_id", sa.String(64), nullable=False),
        sa.Column("service_name", sa.String(120), nullable=False),
        sa.Column("applicant_name", sa.String(120), nullable=False),
        sa.Column("mobile", sa.String(16), nullable=False),
        sa.Column("mobile_last4", sa.String(4), nullable=False),
        sa.Column("ward", sa.Integer(), sa.ForeignKey("wards.ward_number"), nullable=False),
        sa.Column("address", sa.String(300), nullable=False),
        sa.Column("department", sa.String(80), sa.ForeignKey("departments.name"), nullable=False),
        sa.Column("fee_inr", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("created_at", sa.String(64), nullable=False),
        sa.Column("updated_at", sa.String(64), nullable=False),
        sa.Column("checked_docs_json", sa.Text(), nullable=False),
        sa.Column("uploaded_doc_names_json", sa.Text(), nullable=False),
        sa.Column("assigned_officer_id", sa.String(64), sa.ForeignKey("staff.id", ondelete="SET NULL")),
        sa.Column("assigned_officer_name", sa.String(120)),
        sa.Column("filed_by_role", sa.String(32), nullable=False),
        sa.Column("official_remark", sa.Text()),
        sa.Column("timeline_json", sa.Text(), nullable=False),
        sa.Column("tracking_token_hash", sa.String(128), nullable=False),
        sa.CheckConstraint("length(mobile_last4) = 4", name="ck_srv_mobile_last4"),
        sa.CheckConstraint("ward BETWEEN 1 AND 15", name="ck_srv_ward"),
        sa.CheckConstraint("fee_inr >= 0", name="ck_srv_fee_nonneg"),
        sa.CheckConstraint(
            "status IN ('Submitted','Pending Verification','Documents Verified','Correction Needed','Approved','Rejected')",
            name="ck_srv_status",
        ),
    )

    op.create_table(
        "attachments",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("target_kind", sa.String(16), nullable=False),
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("file_name", sa.String(200), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("storage_ref", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(64), nullable=False),
        sa.CheckConstraint("target_kind IN ('grievance','service')", name="ck_att_kind"),
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("recipient_role", sa.String(32), nullable=False),
        sa.Column("recipient_ref", sa.String(64), nullable=False),
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("channel", sa.String(24), nullable=False, server_default="IN_APP"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="SENT"),
        sa.Column("created_at", sa.String(64), nullable=False),
        sa.CheckConstraint("status IN ('QUEUED','SENT','FAILED')", name="ck_ntf_status"),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("seq_no", sa.BigInteger(), unique=True),
        sa.Column("prev_hash", sa.String(64)),
        sa.Column("event_hash", sa.String(64)),
        sa.Column("timestamp", sa.String(64), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=False, server_default="-"),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("actor_name", sa.String(120), nullable=False),
        sa.Column("actor_role", sa.String(32), nullable=False),
        sa.Column("session_prefix", sa.String(32), nullable=False),
        sa.Column("ip_hash", sa.String(64), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("details", sa.Text(), nullable=False),
        sa.CheckConstraint("outcome IN ('SUCCESS','DENIED','ERROR')", name="ck_audit_outcome"),
    )

    op.create_table(
        "security_alerts",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("timestamp", sa.String(64), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("actor_hint", sa.String(160), nullable=False),
        sa.Column("ip_hash", sa.String(64), nullable=False),
        sa.Column("details", sa.Text(), nullable=False),
        sa.CheckConstraint("severity IN ('LOW','MEDIUM','HIGH','CRITICAL')", name="ck_alert_sev"),
    )

    op.create_table(
        "audit_checkpoints",
        sa.Column("checkpoint_id", sa.String(64), primary_key=True),
        sa.Column("seq_no", sa.BigInteger(), nullable=False),
        sa.Column("event_id", sa.String(80), nullable=False),
        sa.Column("event_hash", sa.String(64), nullable=False),
        sa.Column("record_count", sa.BigInteger(), nullable=False),
        sa.Column("signature", sa.String(64), nullable=False),
        sa.Column("created_at", sa.String(64), nullable=False),
    )

    op.create_index("idx_grievances_ward_dept_status", "grievances", ["ward", "department", "status"])
    op.create_index("idx_grievances_created_at", "grievances", ["created_at"])
    op.create_index("idx_grievances_uuid", "grievances", ["external_uuid"])
    op.create_index("idx_services_ward_dept_status", "services", ["ward", "department", "status"])
    op.create_index("idx_services_uuid", "services", ["external_uuid"])
    op.create_index("idx_audit_timestamp", "audit_logs", ["timestamp"])
    op.create_index("idx_audit_seq_no", "audit_logs", ["seq_no"])
    op.create_index("idx_status_hist_gid", "grievance_status_history", ["grievance_id", "created_at"])
    op.create_index("idx_notifications_target", "notifications", ["target_id", "created_at"])

    # Enforce PostgreSQL append-only immutability on audit_logs and security_alerts
    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only and immutable.', TG_TABLE_NAME
                USING ERRCODE = '42501';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_no_update
        BEFORE UPDATE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_no_delete
        BEFORE DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_alerts_no_update
        BEFORE UPDATE ON security_alerts
        FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_alerts_no_delete
        BEFORE DELETE ON security_alerts
        FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
        """
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TRIGGER IF EXISTS trg_alerts_no_delete ON security_alerts;")
    op.execute("DROP TRIGGER IF EXISTS trg_alerts_no_update ON security_alerts;")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_logs;")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;")
    op.execute("DROP FUNCTION IF EXISTS prevent_append_only_mutation();")

    for tbl in (
        "audit_checkpoints",
        "security_alerts",
        "audit_logs",
        "notifications",
        "attachments",
        "services",
        "grievance_comments",
        "grievance_assignments",
        "grievance_status_history",
        "sessions",
        "holidays",
        "sla_policies",
        "grievance_categories",
        "config",
    ):
        op.drop_table(tbl)
