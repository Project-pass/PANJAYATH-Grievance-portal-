"""SQLAlchemy 2.x ORM definitions targeting PostgreSQL 16 (production target schema).

Note: The sandbox runtime uses Python 3.11 stdlib sqlite3 (WAL mode) with matching relational
schema v3 in `backend/db.py`. Use this module with Alembic (`backend/alembic/`) when deploying
against PostgreSQL (`DATABASE_URL=postgresql+psycopg://...`).
"""
from __future__ import annotations

try:
    from sqlalchemy import (
        Boolean,
        CheckConstraint,
        DateTime,
        ForeignKey,
        Index,
        Integer,
        String,
        Text,
        UniqueConstraint,
        func,
    )
    from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
except ImportError:  # pragma: no cover - optional in stdlib-only sandbox
    DeclarativeBase = object  # type: ignore[assignment]
    mapped_column = None  # type: ignore[assignment]


if DeclarativeBase is not object:

    class Base(DeclarativeBase):
        pass

    class Ward(Base):
        __tablename__ = "wards"
        ward_number: Mapped[int] = mapped_column(Integer, primary_key=True)
        name: Mapped[str] = mapped_column(String(64), nullable=False)
        __table_args__ = (CheckConstraint("ward_number BETWEEN 1 AND 15", name="ck_wards_range"),)

    class Department(Base):
        __tablename__ = "departments"
        name: Mapped[str] = mapped_column(String(80), primary_key=True)
        head_designation: Mapped[str] = mapped_column(String(120), nullable=False)

    class StaffMember(Base):
        __tablename__ = "staff"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        external_uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
        name: Mapped[str] = mapped_column(String(120), nullable=False)
        username: Mapped[str | None] = mapped_column(String(48), unique=True)
        email: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
        passcode_hash: Mapped[str | None] = mapped_column(String(256))
        designation: Mapped[str] = mapped_column(String(120), nullable=False)
        role: Mapped[str] = mapped_column(String(32), nullable=False)
        department: Mapped[str] = mapped_column(String(80), ForeignKey("departments.name"), nullable=False)
        assigned_wards_json: Mapped[str] = mapped_column(Text, nullable=False)
        is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
        permissions_json: Mapped[str] = mapped_column(Text, nullable=False)
        failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
        locked_until: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
        is_claimed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
        created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
        updated_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

    class Grievance(Base):
        __tablename__ = "grievances"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        external_uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
        citizen_name: Mapped[str] = mapped_column(String(120), nullable=False)
        mobile: Mapped[str] = mapped_column(String(16), nullable=False)
        mobile_last4: Mapped[str] = mapped_column(String(4), nullable=False)
        ward: Mapped[int] = mapped_column(Integer, ForeignKey("wards.ward_number"), nullable=False)
        category: Mapped[str] = mapped_column(String(64), nullable=False)
        department: Mapped[str] = mapped_column(String(80), ForeignKey("departments.name"), nullable=False)
        priority: Mapped[str] = mapped_column(String(16), default="NORMAL", nullable=False)
        sla_limit_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
        paused_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
        hold_started_at: Mapped[str | None] = mapped_column(String(64))
        escalated_at: Mapped[str | None] = mapped_column(String(64))
        escalation_level: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
        landmark: Mapped[str] = mapped_column(String(200), nullable=False)
        description: Mapped[str] = mapped_column(Text, nullable=False)
        status: Mapped[str] = mapped_column(String(32), nullable=False)
        assigned_officer_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("staff.id"))
        public_remark: Mapped[str | None] = mapped_column(Text)
        internal_remark: Mapped[str | None] = mapped_column(Text)
        rating: Mapped[int | None] = mapped_column(Integer)
        tracking_token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)
        updated_at: Mapped[str] = mapped_column(String(64), nullable=False)
        resolved_at: Mapped[str | None] = mapped_column(String(64))
        __table_args__ = (
            Index("ix_pg_grievances_ward_dept_status", "ward", "department", "status"),
        )

    class AuditLog(Base):
        __tablename__ = "audit_logs"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        timestamp: Mapped[str] = mapped_column(String(64), nullable=False)
        request_id: Mapped[str] = mapped_column(String(64), nullable=False)
        actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
        actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
        actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
        session_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
        ip_hash: Mapped[str] = mapped_column(String(64), nullable=False)
        action: Mapped[str] = mapped_column(String(64), nullable=False)
        target_id: Mapped[str] = mapped_column(String(64), nullable=False)
        outcome: Mapped[str] = mapped_column(String(16), nullable=False)
        details: Mapped[str] = mapped_column(Text, nullable=False)

    class SlaPolicy(Base):
        __tablename__ = "sla_policies"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        category: Mapped[str] = mapped_column(String(64), nullable=False)
        priority: Mapped[str] = mapped_column(String(16), nullable=False)
        deadline_days: Mapped[int] = mapped_column(Integer, nullable=False)
        __table_args__ = (UniqueConstraint("category", "priority", name="uq_sla_cat_priority"),)
