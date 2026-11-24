#!/usr/bin/env sh
set -eu

# Verify compiled C SLA/RBAC engine exists and passes deterministic self-test
python3 backend/c_engine/build.py

# Initialize schema & run Alembic migrations when DATABASE_URL targets PostgreSQL
python3 - <<'PY'
import os
import sys
import time

sys.path.insert(0, os.path.abspath("backend"))
from app.database.interface import detect_database_backend
from app.database.connection import resolve_database_url
import db

url = resolve_database_url()
backend = detect_database_backend(url)

if backend == "postgresql":
    last_err = None
    for attempt in range(1, 16):
        try:
            db.init_db()
            last_err = None
            break
        except Exception as exc:
            last_err = exc
            print(f"[entrypoint] Waiting for PostgreSQL (attempt {attempt}/15): {exc}", file=sys.stderr)
            time.sleep(2)
    if last_err is not None:
        raise last_err
else:
    db.init_db()
PY

exec python3 backend/server.py --port "${PORT:-3001}"
