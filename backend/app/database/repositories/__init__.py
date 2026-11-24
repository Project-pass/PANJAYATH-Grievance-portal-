"""Domain repository modules decoupling data access from HTTP handlers."""
from app.database.repositories.audit_repo import AuditRepository
from app.database.repositories.grievance_repo import GrievanceRepository
from app.database.repositories.service_repo import ServiceRepository
from app.database.repositories.staff_repo import StaffRepository

__all__ = [
    "AuditRepository",
    "GrievanceRepository",
    "ServiceRepository",
    "StaffRepository",
]
