# Production Python API + C SLA/RBAC Engine container
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    PORT=3001

RUN apt-get update && apt-get install -y --no-install-recommends \
      gcc \
      libc6-dev \
      libpq5 \
      openssl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r panchayat && useradd -r -g panchayat -m panchayat

WORKDIR /app
COPY requirements.txt pyproject.toml ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

# Compile C SLA & RBAC engine deterministically during image build
RUN python3 backend/c_engine/build.py --force

RUN mkdir -p /app/backend/data /app/backend/backups && chown -R panchayat:panchayat /app

USER panchayat
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3001/api/ready', timeout=3)"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
