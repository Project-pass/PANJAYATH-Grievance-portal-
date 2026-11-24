# Deployment Guide

## 1. Local / Preview Runtime
```bash
npm install
npm run dev
```
This runs `run_dev.py`, which compiles `backend/c_engine/sla_rbac` if missing/outdated/non-executable, runs the C smoke verification, starts `backend/server.py` on `:3001`, and serves the frontend via Vite on `:3000`.

## 2. Production Container Deployment (`Dockerfile` & `docker-compose.yml`)
1. Generate a strong session secret (`>= 32` chars):
   ```bash
   python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
   ```
2. Export required environment variables:
   ```bash
   export APP_ENV=production
   export PANCHAYAT_SESSION_SECRET="<generated-secret>"
   export PANCHAYAT_ALLOWED_ORIGINS="https://portal.abcgram.gov.in"
   ```
3. Build and run with Docker Compose:
   ```bash
   docker compose up -d --build
   ```
   To include the optional PostgreSQL 16 container profile:
   ```bash
   docker compose --profile postgres up -d --build
   ```

## 3. Reverse Proxy & TLS Requirements
Terminate TLS 1.2/1.3 at a hardened reverse proxy (Nginx / Cloud Load Balancer) forwarding:
- `Host` / `X-Forwarded-Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto: https`
Because session cookies use `HttpOnly; Secure; SameSite=None; Partitioned`, production browsers require HTTPS termination at the ingress boundary.

## 4. Database Migrations (PostgreSQL Target)
When deploying against PostgreSQL (`DATABASE_URL=postgresql+psycopg://...`):
```bash
pip install -r requirements.txt
alembic -c backend/alembic.ini upgrade head
```
*(Note: SQLite WAL runs out of the box with zero third-party Python dependencies and auto-migrates on `init_db()`.)*

## 5. CI/CD Pipeline (`.github/workflows/ci.yml`)
GitHub Actions runs on push/PR to `main`/`master`:
- Compiles & verifies `backend/c_engine/sla_rbac`
- Executes all Python unit, integration, security, E2E, and benchmark tests
- Runs `backend/maintenance.py` backup, restore-drill, and retention-check
- Lints `firestore.rules` with ESLint and builds frontend assets (`npm run lint && npm run build`)
