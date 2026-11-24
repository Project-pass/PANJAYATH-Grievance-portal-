#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup_file(.db|.db.enc)> [--apply]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_FILE="$1"
APPLY_MODE="${2:-}"

echo "[restore] Verifying checksum, HMAC signature, and SQLite integrity via sandbox restore drill..."
python3 backend/maintenance.py restore-drill "$BACKUP_FILE"

if [[ "$APPLY_MODE" != "--apply" ]]; then
  echo "[restore] Drill passed. Re-run with --apply to restore into active backend/data/panchayat.db (stop API server first)."
  exit 0
fi

TARGET_DB="${PANCHAYAT_SQLITE_PATH:-$ROOT_DIR/backend/data/panchayat.db}"
mkdir -p "$(dirname "$TARGET_DB")"

if [[ -f "$TARGET_DB" ]]; then
  cp -p "$TARGET_DB" "${TARGET_DB}.pre_restore.$(date -u +%Y%m%dT%H%M%SZ).bak"
fi

if [[ "$BACKUP_FILE" == *.enc ]]; then
  if [[ -z "${PANCHAYAT_BACKUP_KEY:-}" ]]; then
    echo "ERROR: PANCHAYAT_BACKUP_KEY must be set to decrypt $BACKUP_FILE." >&2
    exit 1
  fi
  TMP_DEC=$(mktemp)
  trap 'rm -f "$TMP_DEC"' EXIT
  PANCHAYAT_OPENSSL_PASS="$PANCHAYAT_BACKUP_KEY" openssl enc -d -aes-256-cbc -pbkdf2 \
    -in "$BACKUP_FILE" -out "$TMP_DEC" -pass env:PANCHAYAT_OPENSSL_PASS
  cp "$TMP_DEC" "$TARGET_DB"
else
  cp "$BACKUP_FILE" "$TARGET_DB"
fi

chmod 600 "$TARGET_DB"
echo "[restore] Restored verified database snapshot to $TARGET_DB."
