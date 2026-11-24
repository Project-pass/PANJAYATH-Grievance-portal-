from __future__ import annotations


def build_openapi_spec() -> dict:
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "ABC Gram Panchayat — Grievance & Citizen E-Service API",
            "version": "3.0.0",
            "description": (
                "Hardened civic grievance redressal and e-service API with HttpOnly session cookies, "
                "server-bound X-CSRF-Token protection, role-based access control, SLA tracking, and "
                "append-only audit logging."
            ),
        },
        "servers": [
            {"url": "/api/v1", "description": "Versioned v1 API"},
            {"url": "/api", "description": "Compatibility API prefix"},
        ],
        "components": {
            "securitySchemes": {
                "SessionCookie": {
                    "type": "apiKey",
                    "in": "cookie",
                    "name": "panchayat_sid",
                },
                "CsrfHeader": {
                    "type": "apiKey",
                    "in": "header",
                    "name": "X-CSRF-Token",
                },
            }
        },
        "paths": {
            "/health": {"get": {"summary": "Liveness probe", "responses": {"200": {"description": "Service alive"}}}},
            "/ready": {"get": {"summary": "Readiness probe (DB, C engine, secrets)", "responses": {"200": {"description": "Ready"}, "503": {"description": "Degraded"}}}},
            "/docs": {"get": {"summary": "OpenAPI 3.0 specification", "responses": {"200": {"description": "OpenAPI JSON"}}}},
            "/public/overview": {"get": {"summary": "Public anonymized dashboard KPIs & recent works", "responses": {"200": {"description": "Overview payload"}}}},
            "/public/grievances": {"post": {"summary": "Submit public civic grievance", "responses": {"201": {"description": "Grievance registered with one-time tracking token"}}}},
            "/public/grievances/{id}/feedback": {"post": {"summary": "Submit citizen satisfaction rating (resolved tickets)", "responses": {"200": {"description": "Feedback saved"}}}},
            "/public/grievances/{id}/reopen": {"post": {"summary": "Reopen resolved/closed/rejected grievance with reason", "responses": {"200": {"description": "Grievance reopened"}}}},
            "/public/services": {"post": {"summary": "Submit citizen e-service application", "responses": {"201": {"description": "Application registered"}}}},
            "/public/track": {"post": {"summary": "Verified status lookup using Tracking ID, token, and mobile last 4", "responses": {"200": {"description": "Tracked record"}}}},
            "/auth/status": {"get": {"summary": "Current session & bootstrap status", "responses": {"200": {"description": "Auth status"}}}},
            "/auth/bootstrap-claim": {"post": {"summary": "One-time Secretary passcode initialization", "responses": {"200": {"description": "Session cookie set"}}}},
            "/auth/login": {"post": {"summary": "Staff sign-in (sets HttpOnly cookie + CSRF token)", "responses": {"200": {"description": "Authenticated"}}}},
            "/auth/logout": {"post": {"summary": "Invalidate current staff session", "responses": {"200": {"description": "Signed out"}}}},
            "/staff/dashboard": {"get": {"summary": "Scoped staff dashboard & paginated grievances/services", "security": [{"SessionCookie": []}], "responses": {"200": {"description": "Dashboard data"}}}},
            "/staff/grievances": {
                "get": {"summary": "Paginated & filtered grievances within RBAC scope", "security": [{"SessionCookie": []}], "responses": {"200": {"description": "Paginated grievances"}}},
                "post": {"summary": "CSC/Admin walk-in grievance intake", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"201": {"description": "Created"}}},
            },
            "/staff/grievances/{id}": {
                "patch": {"summary": "Workflow transition, assignment, SLA pause/resume, remarks", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Updated"}}},
                "delete": {"summary": "Delete grievance (Super Admin only)", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Deleted"}}},
            },
            "/staff/grievances/{id}/comments": {"post": {"summary": "Add public or internal comment on grievance", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"201": {"description": "Comment added"}}}},
            "/staff/grievances/escalate-overdue": {"post": {"summary": "Escalate SLA-breached open grievances", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Escalation sweep summary"}}}},
            "/staff/services": {"post": {"summary": "CSC/Admin walk-in service application", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"201": {"description": "Created"}}}},
            "/staff/services/{id}": {
                "patch": {"summary": "Verify documents / approve certificate", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Updated"}}},
                "delete": {"summary": "Delete service application (Super Admin only)", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Deleted"}}},
            },
            "/staff/account/change-password": {"post": {"summary": "Authenticated staff password change", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Password updated"}}}},
            "/staff/users": {"post": {"summary": "Create staff user (Super Admin only)", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"201": {"description": "Created"}}}},
            "/staff/users/{id}": {"put": {"summary": "Update staff user/permissions (Super Admin only)", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Updated"}}}},
            "/staff/users/{id}/toggle": {"post": {"summary": "Activate or suspend staff account", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Toggled"}}}},
            "/staff/users/{id}/reset-password": {"post": {"summary": "Super Admin reset of staff password", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Password reset"}}}},
            "/staff/config/sla": {"put": {"summary": "Update Panchayat SLA threshold", "security": [{"SessionCookie": [], "CsrfHeader": []}], "responses": {"200": {"description": "Updated"}}}},
            "/staff/audit": {"get": {"summary": "Paginated immutable audit logs", "security": [{"SessionCookie": []}], "responses": {"200": {"description": "Audit logs"}}}},
            "/staff/audit/export": {"get": {"summary": "Export audit logs (CSV/JSON, Super Admin)", "security": [{"SessionCookie": []}], "responses": {"200": {"description": "Export stream"}}}},
        },
    }
