# ABC Gram Panchayat — Public Grievance Redressal & Citizen E-Service Portal

A hardened, bilingual (English / മലയാളം) civic grievance redressal and statutory e-service platform for **ABC Gram Panchayat** (Wards 1–15).

## Architecture Overview
- **Frontend (`src/`)**: Pure ES JavaScript modules + Tailwind CSS v4 + Vite (port `3000`) with Citizen Public Portal (`/`) and Staff Workspace (`/admin`), bilingual labels (`src/i18n.js`), and optional Google Cloud Identity sign-in (`src/firebase.js`).
- **Backend (`backend/`)**: Modular Python 3.11 stdlib HTTP API server (`backend/server.py`, port `3001`) with structured JSON logging, typed exceptions, `/api/v1/*` routing, OpenAPI 3.0 spec (`/api/v1/docs`), RBAC policy matrix (`backend/app/policies/rbac.py`), SLA & workflow engines (`backend/app/services/`), and SQLite WAL persistence (`backend/db.py`).
- **Native C Engine (`backend/c_engine/`)**: Deterministic compiled C11 binary (`sla_rbac`) built automatically from `sla_rbac.c` via `backend/c_engine/build.py` before dev startup and container build.
- **PostgreSQL & Cloud Rules**: SQLAlchemy 2.x models and Alembic migration (`backend/app/database/postgres_models.py`, `backend/alembic/`) for PostgreSQL target deployments, plus hardened Firestore security rules (`firestore.rules`, `firebase-blueprint.json`).

## Quick Start (Local Development)

### Prerequisites
- Python 3.11+
- GCC / Clang (`gcc`, `clang`, or `cc`)
- Node.js 20+ & npm

### Run
```bash
npm install
npm run dev
```
`run_dev.py` deterministically compiles and self-tests the C engine (`backend/c_engine/sla_rbac`), launches the Python API server on `127.0.0.1:3001`, and starts the Vite dev server on `0.0.0.0:3000` (proxying `/api/*` to port `3001`).

### First-Run Secretary Setup (`admin_test`)
- If `PANCHAYAT_SECRETARY_PASSCODE` is set in the environment, `admin_test` (`stf-secretary`) authenticates directly against it.
- Otherwise, on a fresh database, open `/admin` to complete the one-time **First-Run Secretary Account Setup** (`POST /api/auth/bootstrap-claim`) which hashes the passcode using `hashlib.scrypt` with a 16-byte random salt. No plaintext passcodes or default credentials are stored in source files.

## Verification Commands
```bash
# 1. C engine deterministic build & smoke check
python3 backend/c_engine/build.py --force

# 2. Full automated test suite (unit, integration, security, E2E, performance)
python3 -m unittest discover -s backend/tests -p "test_*.py" -v

# 3. Backup, restore drill, and audit retention check
bash scripts/backup.sh
python3 backend/maintenance.py retention-check --days 365

# 4. Frontend build, type-check, and Firestore rules lint
npm run lint
npm run build
npx eslint firestore.rules
```

## Documentation Index
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [SECURITY.md](./SECURITY.md)
- [DATABASE.md](./DATABASE.md)
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)
- [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md)
- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md)
