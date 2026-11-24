#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

ENCRYPT_FLAG=""
if [[ "${1:-}" == "--encrypt" ]]; then
  if [[ -z "${PANCHAYAT_BACKUP_KEY:-}" ]]; then
    echo "ERROR: PANCHAYAT_BACKUP_KEY must be set when using --encrypt." >&2
    exit 1
  fi
  ENCRYPT_FLAG="--encrypt"
fi

echo "[backup] Creating transactional SQLite backup..."
MANIFEST_JSON=$(python3 backend/maintenance.py backup ${ENCRYPT_FLAG})
echo "$MANIFEST_JSON"

BACKUP_FILE=$(python3 -c 'import json, sys; print(json.load(sys.stdin)["backupFile"])' <<< "$MANIFEST_JSON")
echo "[backup] Running immediate restore integrity drill on $BACKUP_FILE..."
python3 backend/maintenance.py restore-drill "$BACKUP_FILE"
echo "[backup] Completed and verified successfully."
