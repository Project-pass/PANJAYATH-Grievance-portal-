# Deployment Guide

## 1. Local / Preview Runtime
```bash
npm ci
npm run dev
```
This runs `run_dev.py`, which compiles `backend/c_engine/sla_rbac` if missing/outdated/non-executable, runs the C smoke verification, starts `backend/server.py` on `:3001`, and serves the frontend via Vite on `:3000`.
Node.js version is pinned to `22` via `.nvmrc` and `package.json` (`engines.node: ">=22.0.0 <23.0.0"`), with `package-lock.json` kept in sync for deterministic `npm ci`.

## 2. Production Multi-Container Architecture (Nginx + Python API + PostgreSQL 16)
The production stack separates responsibilities across three containers (`docker-compose.yml` & `docker-compose.prod.yml`):
1. **`proxy` (`Dockerfile.web` + `nginx/nginx.conf`)**:
   - Multi-stage `node:22-alpine` (`npm ci && npm run build`) copied into `nginxinc/nginx-unprivileged:1.27-alpine` listening on port `8080`.
   - Serves built SPA static assets at `/` with `try_files $uri $uri/ /index.html` and hashed asset caching.
   - Proxies `/api/` to internal `http://api:3001` forwarding `Host`, `X-Forwarded-Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
   - Applies strict CSP and security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`).
2. **`api` (`Dockerfile` + `scripts/docker-entrypoint.sh`)**:
   - `python:3.11-slim` installing `requirements.txt`, compiling `backend/c_engine/sla_rbac`, running as non-root `panchayat` user.
   - Entrypoint verifies the C engine, waits/retries PostgreSQL readiness, executes `alembic -c backend/alembic.ini upgrade head`, seeds defaults, and execs `backend/server.py` on internal port `3001` (not exposed externally).
3. **`postgres` (`postgres:16-alpine`)**:
   - Runs on an `internal: true` Docker network with `pg_isready` healthchecks and persistent volume storage.

### Production Launch Commands (`docker-compose.prod.yml`)
`docker-compose.prod.yml` intentionally omits default passwords and fails fast if required secrets are unset:
```bash
export POSTGRES_PASSWORD="<strong-db-password>"
export PANCHAYAT_SESSION_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
export PANCHAYAT_AUDIT_HMAC_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
export PANCHAYAT_ALLOWED_ORIGINS="https://portal.abcgram.gov.in"

docker compose -f docker-compose.prod.yml up -d --build
```
Verify runtime health via the Nginx ingress:
```bash
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS http://127.0.0.1:8080/api/ready
```

## 3. Reverse Proxy & TLS Termination
Terminate TLS 1.2/1.3 at an upstream load balancer or ingress fronting `proxy:8080` forwarding `X-Forwarded-Proto: https` and `X-Forwarded-Host`. Because session cookies use `HttpOnly; Secure; SameSite=None; Partitioned`, production browsers require HTTPS termination at the public ingress.

## 4. Database Migrations (PostgreSQL 16)
When running migrations manually against PostgreSQL (`DATABASE_URL=postgresql+psycopg://...`):
```bash
pip install -r requirements.txt
alembic -c backend/alembic.ini upgrade head
```

## 5. CI/CD Pipeline (`.github/workflows/ci.yml`)
GitHub Actions runs 5 verification jobs on push/PR:
1. **`python-backend-and-postgres`**: Compiles C engine, runs `ruff`, `mypy`, `alembic upgrade head` on PostgreSQL 16 service, executes full Python unittest suite (including `LivePostgresAcceptanceTests`), runs performance benchmarks (`500` & `5000` rows), and runs `audit-checkpoint`/`audit-verify`/`backup`/`restore-drill`/`retention-check`.
2. **`frontend-quality-and-build`**: Runs `npm ci`, `npx eslint firestore.rules`, `npm run lint` (`tsc --noEmit && eslint .`), and `npm run build`.
3. **`firebase-emulator-security`**: Installs Java 21 + Node 22 and executes `npx firebase emulators:exec --only firestore "npm run test:firestore"`.
4. **`docker-proxy-acceptance`**: Builds `Dockerfile` and `Dockerfile.web`, boots `docker-compose.yml`, verifies Nginx `/` + `/api/health` + `/api/ready` + headers, and runs Playwright Chromium E2E tests against `http://127.0.0.1:8080`.
5. **`security-and-supply-chain`**: Executes `npm audit --audit-level=high`, `pip-audit`, and secret/storage static scans.
