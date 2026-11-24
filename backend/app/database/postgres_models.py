"""Complete SQLAlchemy 2.x ORM definitions targeting PostgreSQL 16 (all 18 production tables)."""
from __future__ import annotations

try:
    from sqlalchemy import (
        BigInteger,
        Boolean,
        CheckConstraint,
        Float,
        ForeignKey,
        Index,
        Integer,
        String,
        Text,
        UniqueConstraint,
    )
    from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
except ImportError:  # pragma: no cover - optional in stdlib-only sandbox
    DeclarativeBase = object  # type: ignore[assignment]
    mapped_column = None  # type: ignore[assignment]


if DeclarativeBase is not object:

    class Base(DeclarativeBase):
        pass

    class ConfigEntry(Base):
        __tablename__ = "config"
        key: Mapped[str] = mapped_column(String(80), primary_key=True)
        value: Mapped[str] = mapped_column(Text, nullable=False)
        updated_at: Mapped[str] = mapped_column(String(64), nullable=False)

    class Ward(Base):
        __tablename__ = "wards"
        ward_number: Mapped[int] = mapped_column(Integer, primary_key=True)
        name: Mapped[str] = mapped_column(String(64), nullable=False)
        __table_args__ = (CheckConstraint("ward_number BETWEEN 1 AND 15", name="ck_wards_range"),)

    class Department(Base):
        __tablename__ = "departments"
        name: Mapped[str] = mapped_column(String(80), primary_key=True)
        head_designation: Mapped[str] = mapped_column(String(120), nullable=False)

    class GrievanceCategory(Base):
        __tablename__ = "grievance_categories"
        name: Mapped[str] = mapped_column(String(64), primary_key=True)
        department: Mapped[str] = mapped_column(
            String(80), ForeignKey("departments.name", onupdate="CASCADE"), nullable=False
        )
        default_sla_days: Mapped[int] = mapped_column(Integer, nullable=False)
        __table_args__ = (CheckConstraint("default_sla_days BETWEEN 1 AND 30", name="ck_gcat_sla_days"),)

    class SlaPolicy(Base):
        __tablename__ = "sla_policies"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        category: Mapped[str] = mapped_column(String(64), nullable=False)
        priority: Mapped[str] = mapped_column(String(16), nullable=False)
        deadline_days: Mapped[int] = mapped_column(Integer, nullable=False)
        __table_args__ = (
            UniqueConstraint("category", "priority", name="uq_sla_cat_priority"),
            CheckConstraint("priority IN ('LOW','NORMAL','HIGH','CRITICAL')", name="ck_sla_priority"),
            CheckConstraint("deadline_days BETWEEN 1 AND 30", name="ck_sla_deadline_days"),
        )

    class Holiday(Base):
        __tablename__ = "holidays"
        holiday_date: Mapped[str] = mapped_column(String(16), primary_key=True)
        label: Mapped[str] = mapped_column(String(120), nullable=False)

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
        locked_until: Mapped[float] = mapped_column(Float(precision=53), default=0.0, nullable=False)
        is_claimed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)
        updated_at: Mapped[str] = mapped_column(String(64), nullable=False)
        __table_args__ = (
            CheckConstraint("role IN ('SUPER_ADMIN','WARD_OFFICER','CSC_OPERATOR')", name="ck_staff_role"),
        )

    class StaffSession(Base):
        __tablename__ = "sessions"
        token_hash: Mapped[str] = mapped_column(String(128), primary_key=True)
        csrf_token_hash: Mapped[str | None] = mapped_column(String(128))
        staff_id: Mapped[str] = mapped_column(String(64), ForeignKey("staff.id", ondelete="CASCADE"), nullable=False)
        role: Mapped[str] = mapped_column(String(32), nullable=False)
        created_at: Mapped[float] = mapped_column(Float(precision=53), nullable=False)
        expires_at: Mapped[float] = mapped_column(Float(precision=53), nullable=False)
        last_seen_at: Mapped[float] = mapped_column(Float(precision=53), nullable=False)
        ip_hash: Mapped[str] = mapped_column(String(64), nullable=False)
        token_prefix: Mapped[str] = mapped_column(String(32), nullable=False)

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
        consent_recorded: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
        landmark: Mapped[str] = mapped_column(String(200), nullable=False)
        description: Mapped[str] = mapped_column(Text, nullable=False)
        status: Mapped[str] = mapped_column(String(32), nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)
        updated_at: Mapped[str] = mapped_column(String(64), nullable=False)
        resolved_at: Mapped[str | None] = mapped_column(String(64))
        assigned_officer_id: Mapped[str | None] = mapped_column(
            String(64), ForeignKey("staff.id", ondelete="SET NULL")
        )
        assigned_officer_name: Mapped[str | None] = mapped_column(String(120))
        filed_by_role: Mapped[str] = mapped_column(String(32), nullable=False)
        before_photo_url: Mapped[str | None] = mapped_column(Text)
        after_photo_url: Mapped[str | None] = mapped_column(Text)
        public_remark: Mapped[str | None] = mapped_column(Text)
        internal_remark: Mapped[str | None] = mapped_column(Text)
        rating: Mapped[int | None] = mapped_column(Integer)
        feedback_comment: Mapped[str | None] = mapped_column(Text)
        timeline_json: Mapped[str] = mapped_column(Text, nullable=False)
        tracking_token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
        __table_args__ = (
            CheckConstraint("length(mobile_last4) = 4", name="ck_grv_mobile_last4"),
            CheckConstraint("ward BETWEEN 1 AND 15", name="ck_grv_ward"),
            CheckConstraint("priority IN ('LOW','NORMAL','HIGH','CRITICAL')", name="ck_grv_priority"),
            CheckConstraint("sla_limit_days BETWEEN 1 AND 30", name="ck_grv_sla_limit"),
            CheckConstraint("paused_seconds >= 0", name="ck_grv_paused_nonneg"),
            CheckConstraint("escalation_level >= 0", name="ck_grv_esc_nonneg"),
            CheckConstraint(
                "status IN ('SUBMITTED','ACKNOWLEDGED','ASSIGNED','IN_PROGRESS','ON_HOLD','ESCALATED','RESOLVED','CLOSED','REJECTED','REOPENED')",
                name="ck_grv_status",
            ),
            CheckConstraint("rating IS NULL OR (rating BETWEEN 1 AND 5)", name="ck_grv_rating"),
            Index("idx_grievances_ward_dept_status", "ward", "department", "status"),
            Index("idx_grievances_created_at", "created_at"),
            Index("idx_grievances_uuid", "external_uuid"),
        )

    class GrievanceStatusHistory(Base):
        __tablename__ = "grievance_status_history"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        grievance_id: Mapped[str] = mapped_column(
            String(64), ForeignKey("grievances.id", ondelete="CASCADE"), nullable=False
        )
        from_status: Mapped[str | None] = mapped_column(String(32))
        to_status: Mapped[str] = mapped_column(String(32), nullable=False)
        actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
        actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
        actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
        remark: Mapped[str] = mapped_column(Text, nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)
        __table_args__ = (Index("idx_status_hist_gid", "grievance_id", "created_at"),)

    class GrievanceAssignment(Base):
        __tablename__ = "grievance_assignments"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        grievance_id: Mapped[str] = mapped_column(
            String(64), ForeignKey("grievances.id", ondelete="CASCADE"), nullable=False
        )
        officer_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("staff.id", ondelete="SET NULL"))
        officer_name: Mapped[str | None] = mapped_column(String(120))
        assigned_by_id: Mapped[str] = mapped_column(String(64), nullable=False)
        assigned_at: Mapped[str] = mapped_column(String(64), nullable=False)

    class GrievanceComment(Base):
        __tablename__ = "grievance_comments"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        grievance_id: Mapped[str] = mapped_column(
            String(64), ForeignKey("grievances.id", ondelete="CASCADE"), nullable=False
        )
        author_id: Mapped[str] = mapped_column(String(64), nullable=False)
        author_name: Mapped[str] = mapped_column(String(120), nullable=False)
        is_internal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
        body: Mapped[str] = mapped_column(Text, nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)

    class ServiceApplication(Base):
        __tablename__ = "services"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        external_uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
        service_id: Mapped[str] = mapped_column(String(64), nullable=False)
        service_name: Mapped[str] = mapped_column(String(120), nullable=False)
        applicant_name: Mapped[str] = mapped_column(String(120), nullable=False)
        mobile: Mapped[str] = mapped_column(String(16), nullable=False)
        mobile_last4: Mapped[str] = mapped_column(String(4), nullable=False)
        ward: Mapped[int] = mapped_column(Integer, ForeignKey("wards.ward_number"), nullable=False)
        address: Mapped[str] = mapped_column(String(300), nullable=False)
        department: Mapped[str] = mapped_column(String(80), ForeignKey("departments.name"), nullable=False)
        fee_inr: Mapped[int] = mapped_column(Integer, nullable=False)
        status: Mapped[str] = mapped_column(String(40), nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)
        updated_at: Mapped[str] = mapped_column(String(64), nullable=False)
        checked_docs_json: Mapped[str] = mapped_column(Text, nullable=False)
        uploaded_doc_names_json: Mapped[str] = mapped_column(Text, nullable=False)
        assigned_officer_id: Mapped[str | None] = mapped_column(
            String(64), ForeignKey("staff.id", ondelete="SET NULL")
        )
        assigned_officer_name: Mapped[str | None] = mapped_column(String(120))
        filed_by_role: Mapped[str] = mapped_column(String(32), nullable=False)
        official_remark: Mapped[str | None] = mapped_column(Text)
        timeline_json: Mapped[str] = mapped_column(Text, nullable=False)
        tracking_token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
        __table_args__ = (
            CheckConstraint("length(mobile_last4) = 4", name="ck_srv_mobile_last4"),
            CheckConstraint("ward BETWEEN 1 AND 15", name="ck_srv_ward"),
            CheckConstraint("fee_inr >= 0", name="ck_srv_fee_nonneg"),
            CheckConstraint(
                "status IN ('Submitted','Pending Verification','Documents Verified','Correction Needed','Approved','Rejected')",
                name="ck_srv_status",
            ),
            Index("idx_services_ward_dept_status", "ward", "department", "status"),
            Index("idx_services_uuid", "external_uuid"),
        )

    class Attachment(Base):
        __tablename__ = "attachments"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        target_kind: Mapped[str] = mapped_column(String(16), nullable=False)
        target_id: Mapped[str] = mapped_column(String(64), nullable=False)
        file_name: Mapped[str] = mapped_column(String(200), nullable=False)
        mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
        size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
        storage_ref: Mapped[str] = mapped_column(Text, nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)
        __table_args__ = (CheckConstraint("target_kind IN ('grievance','service')", name="ck_att_kind"),)

    class Notification(Base):
        __tablename__ = "notifications"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        recipient_role: Mapped[str] = mapped_column(String(32), nullable=False)
        recipient_ref: Mapped[str] = mapped_column(String(64), nullable=False)
        target_id: Mapped[str] = mapped_column(String(64), nullable=False)
        channel: Mapped[str] = mapped_column(String(24), default="IN_APP", nullable=False)
        message: Mapped[str] = mapped_column(Text, nullable=False)
        status: Mapped[str] = mapped_column(String(16), default="SENT", nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)
        __table_args__ = (
            CheckConstraint("status IN ('QUEUED','SENT','FAILED')", name="ck_ntf_status"),
            Index("idx_notifications_target", "target_id", "created_at"),
        )

    class AuditLog(Base):
        __tablename__ = "audit_logs"
        id: Mapped[str] = mapped_column(String(80), primary_key=True)
        seq_no: Mapped[int | None] = mapped_column(BigInteger, unique=True)
        prev_hash: Mapped[str | None] = mapped_column(String(64))
        event_hash: Mapped[str | None] = mapped_column(String(64))
        timestamp: Mapped[str] = mapped_column(String(64), nullable=False)
        request_id: Mapped[str] = mapped_column(String(64), default="-", nullable=False)
        actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
        actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
        actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
        session_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
        ip_hash: Mapped[str] = mapped_column(String(64), nullable=False)
        action: Mapped[str] = mapped_column(String(64), nullable=False)
        target_id: Mapped[str] = mapped_column(String(64), nullable=False)
        outcome: Mapped[str] = mapped_column(String(16), nullable=False)
        details: Mapped[str] = mapped_column(Text, nullable=False)
        __table_args__ = (
            CheckConstraint("outcome IN ('SUCCESS','DENIED','ERROR')", name="ck_audit_outcome"),
            Index("idx_audit_timestamp", "timestamp"),
            Index("idx_audit_seq_no", "seq_no"),
        )

    class SecurityAlert(Base):
        __tablename__ = "security_alerts"
        id: Mapped[str] = mapped_column(String(80), primary_key=True)
        timestamp: Mapped[str] = mapped_column(String(64), nullable=False)
        severity: Mapped[str] = mapped_column(String(16), nullable=False)
        event_type: Mapped[str] = mapped_column(String(64), nullable=False)
        actor_hint: Mapped[str] = mapped_column(String(160), nullable=False)
        ip_hash: Mapped[str] = mapped_column(String(64), nullable=False)
        details: Mapped[str] = mapped_column(Text, nullable=False)
        __table_args__ = (CheckConstraint("severity IN ('LOW','MEDIUM','HIGH','CRITICAL')", name="ck_alert_sev"),)

    class AuditCheckpoint(Base):
        __tablename__ = "audit_checkpoints"
        checkpoint_id: Mapped[str] = mapped_column(String(64), primary_key=True)
        seq_no: Mapped[int] = mapped_column(BigInteger, nullable=False)
        event_id: Mapped[str] = mapped_column(String(80), nullable=False)
        event_hash: Mapped[str] = mapped_column(String(64), nullable=False)
        record_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
        signature: Mapped[str] = mapped_column(String(64), nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), nullable=False)
