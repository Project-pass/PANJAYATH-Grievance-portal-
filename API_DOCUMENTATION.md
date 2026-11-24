# API Documentation

All endpoints are available under both `/api/*` and `/api/v1/*`. Live machine-readable OpenAPI 3.0.3 JSON is served at `GET /api/docs` and `GET /api/v1/openapi.json`.

## 1. System & Health Endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Liveness check (`cEngineCompiled`, backend mode). |
| `GET` | `/api/ready` | Public | Readiness check (`database`, `cEngine`, `sessionSecret`); returns `200` or `503`. |
| `GET` | `/api/docs`, `/api/openapi.json` | Public | OpenAPI 3.0.3 JSON specification. |

## 2. Authentication Endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/auth/status` | Public | Returns `{ bootstrapRequired, authenticated, user, envPasscodeConfigured }`. |
| `POST` | `/api/auth/bootstrap-claim` | One-time setup | Initializes `admin_test` (`stf-secretary`) passcode (8–128 chars, 2+ classes) and sets `panchayat_sid` + `panchayat_csrf` cookies. Disabled once claimed (`403`). |
| `POST` | `/api/auth/login` | Public | Accepts `{ identifier \| email, passcode }`. Enforces rate limit (`429`), exponential delay, and 5-attempt lockout (`423`). Sets `panchayat_sid` (`HttpOnly`) & `panchayat_csrf` cookies and returns `{ ok, csrfToken, user }`. |
| `POST` | `/api/auth/logout` | Cookie + CSRF | Deletes session row and clears cookies. |

## 3. Citizen Public Endpoints
| Method | Path | Rate Limit | Description |
|---|---|---|---|
| `GET` | `/api/public/overview` | 60/min | Real DB grievance counts (`resolvedCount`, `totalCount`, `avgDays`, `avgRating`, `ratingCount`), `categorySlaDays`, `recentWorks` (non-PII), and `serviceCatalog`. |
| `POST` | `/api/public/grievances` | 10/min | Creates grievance (`priority`: `LOW|NORMAL|HIGH|CRITICAL`, `consentAccepted`), returns receipt + one-time `trackingToken` (`TK-*`) + `potentialDuplicates`. |
| `POST` | `/api/public/services` | 10/min | Submits statutory service application, returns receipt + one-time `trackingToken`. |
| `POST` | `/api/public/track` | 15/min | Requires `{ trackingId, trackingToken, mobileLast4 }`. Returns masked DTO without mobile or internal remarks. |
| `POST` | `/api/public/grievances/{id}/feedback` | 10/min | Requires verified token + `mobileLast4` on `RESOLVED`/`CLOSED` ticket (`rating` 1–5, optional `comment`). |
| `POST` | `/api/public/grievances/{id}/reopen` | 10/min | Requires verified token + `mobileLast4` and `reason` (>=5 chars) on `RESOLVED`/`CLOSED`/`REJECTED` ticket. |

## 4. Authenticated Staff Endpoints (`Cookie: panchayat_sid` + `X-CSRF-Token` on mutations)
| Method | Path | Permission / Role | Description |
|---|---|---|---|
| `GET` | `/api/staff/dashboard` | Active Staff | Scoped grievances (with comments & SLA), scoped services, staff directory, scoped audit logs, notifications, and (for Super Admin) `securityAlerts` & `auditRetention`. |
| `GET` | `/api/staff/grievances` | Active Staff | Paginated/filtered grievances (`status`, `ward`, `category`, `priority`, `overdueOnly`, `q`, `page`, `pageSize`). |
| `POST` | `/api/staff/grievances` | `CREATE_WALKIN` | CSC/Admin walk-in grievance intake. |
| `PATCH` | `/api/staff/grievances/{id}` | `UPDATE` (+ `ASSIGN` if reassigning) | Validates canonical workflow transition, mandatory remarks (`>=5` chars) for `RESOLVED`/`REJECTED`/`ON_HOLD`/`ESCALATED`/`REOPENED`, updates SLA `ON_HOLD` pause tracking, and records history. |
| `POST` | `/api/staff/grievances/{id}/comments` | `UPDATE` | Adds public or internal comment. |
| `POST` | `/api/staff/grievances/escalate-overdue` | `SUPER_ADMIN` | Escalates SLA-breached open non-hold grievances. |
| `DELETE` | `/api/staff/grievances/{id}` | `DELETE` (`SUPER_ADMIN`) | Deletes grievance with audit log. |
| `POST` | `/api/staff/services` | `CREATE_WALKIN` | Walk-in e-service registration. |
| `PATCH` | `/api/staff/services/{id}` | `UPDATE` / `VERIFY` / `APPROVE_CERT` | Updates service workflow or approves certificate. |
| `DELETE` | `/api/staff/services/{id}` | `DELETE` (`SUPER_ADMIN`) | Deletes service application. |
| `POST` | `/api/staff/account/change-password` | Active Staff | Changes own password and revokes other active sessions. |
| `POST` | `/api/staff/users` | `MANAGE_USERS` (`SUPER_ADMIN`) | Creates staff account with scrypt password hash. |
| `PUT` | `/api/staff/users/{id}` | `MANAGE_USERS` (`SUPER_ADMIN`) | Updates staff profile, ward scope, role, or permissions. |
| `POST` | `/api/staff/users/{id}/toggle` | `MANAGE_USERS` (`SUPER_ADMIN`) | Activates or suspends staff account (deletes sessions on suspend). |
| `POST` | `/api/staff/users/{id}/reset-password` | `MANAGE_USERS` (`SUPER_ADMIN`) | Resets target staff password, clears lockout, revokes target sessions, logs `HIGH` security alert. |
| `PUT` | `/api/staff/config/sla` | `MANAGE_SLA` (`SUPER_ADMIN`) | Updates Panchayat base SLA days (`1..30`). |
| `GET` | `/api/staff/audit` | Active Staff | Paginated audit query (`q`, `action`, `outcome`, `page`, `pageSize`). |
| `GET` | `/api/staff/audit/export` | `EXPORT_AUDIT` (`SUPER_ADMIN`) | Exports audit log as CSV (`?format=csv`) or JSON (`?format=json`). |
| `POST` | `/api/staff/maintenance/reset` | `MAINTENANCE_RESET` (non-prod only) | Disabled (`403`) when `APP_ENV=production`. |
