"""Initial relational schema for PostgreSQL production target.

Revision ID: 0001_initial_schema
Create Date: 2026-11-24
"""
from __future__ import annotations

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa

    op.create_table(
        "wards",
        sa.Column("ward_number", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.CheckConstraint("ward_number BETWEEN 1 AND 15", name="ck_wards_range"),
    )
    op.create_table(
        "departments",
        sa.Column("name", sa.String(80), primary_key=True),
        sa.Column("head_designation", sa.String(120), nullable=False),
    )
    op.create_table(
        "staff",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("external_uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("username", sa.String(48), unique=True),
        sa.Column("email", sa.String(160), nullable=False, unique=True),
        sa.Column("passcode_hash", sa.String(256)),
        sa.Column("designation", sa.String(120), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("department", sa.String(80), sa.ForeignKey("departments.name"), nullable=False),
        sa.Column("assigned_wards_json", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("permissions_json", sa.Text(), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_claimed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.String(64), nullable=False),
        sa.Column("updated_at", sa.String(64), nullable=False),
    )
    op.create_table(
        "grievances",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("external_uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("citizen_name", sa.String(120), nullable=False),
        sa.Column("mobile", sa.String(16), nullable=False),
        sa.Column("mobile_last4", sa.String(4), nullable=False),
        sa.Column("ward", sa.Integer(), sa.ForeignKey("wards.ward_number"), nullable=False),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column("department", sa.String(80), sa.ForeignKey("departments.name"), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False, server_default="NORMAL"),
        sa.Column("sla_limit_days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("paused_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hold_started_at", sa.String(64)),
        sa.Column("escalated_at", sa.String(64)),
        sa.Column("escalation_level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("landmark", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("assigned_officer_id", sa.String(64), sa.ForeignKey("staff.id")),
        sa.Column("public_remark", sa.Text()),
        sa.Column("internal_remark", sa.Text()),
        sa.Column("rating", sa.Integer()),
        sa.Column("tracking_token_hash", sa.String(128), nullable=False),
        sa.Column("created_at", sa.String(64), nullable=False),
        sa.Column("updated_at", sa.String(64), nullable=False),
        sa.Column("resolved_at", sa.String(64)),
    )


def downgrade() -> None:
    from alembic import op

    op.drop_table("grievances")
    op.drop_table("staff")
    op.drop_table("departments")
    op.drop_table("wards")
