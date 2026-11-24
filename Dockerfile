# Multi-stage production build for ABC Gram Panchayat Portal
FROM node:22-slim AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY index.html vite.config.js tsconfig.json ./
COPY src ./src
RUN npm run build

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends \
      gcc \
      libc6-dev \
      openssl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r panchayat && useradd -r -g panchayat -m panchayat

WORKDIR /app
COPY requirements.txt pyproject.toml ./
COPY backend ./backend
COPY --from=frontend-builder /app/dist ./dist

# Compile C SLA & RBAC engine deterministically during image build
RUN python3 backend/c_engine/build.py --force

# Serve built static bundle via lightweight reverse proxy or Express/Python static+API entrypoint
COPY package.json ./
RUN mkdir -p /app/backend/data /app/backend/backups && chown -R panchayat:panchayat /app

USER panchayat
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3001/api/health', timeout=3)"

CMD ["python3", "backend/server.py", "--port", "3001"]
