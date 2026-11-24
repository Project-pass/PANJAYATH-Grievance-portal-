# Backup, Restore Drill & Audit Integrity Operations

## 1. Transactional Online Backups (SQLite & PostgreSQL)
- **SQLite WAL**: Uses `sqlite3.Connection.backup()` so snapshots stay consistent under concurrent WAL reads/writes.
- **PostgreSQL 16**: When `DATABASE_URL` targets `postgresql*`, `maintenance.py backup` invokes `pg_dump -Fc` to capture a consistent custom-format dump.

```bash
# Unencrypted snapshot + SHA-256 + HMAC-SHA256 manifest + automatic restore drill
bash scripts/backup.sh

# Encrypted AES-256-CBC (PBKDF2) snapshot
export PANCHAYAT_BACKUP_KEY="<strong-passphrase>"
bash scripts/backup.sh --encrypt
```

Generated artifacts in `backend/backups/` (permissions `0600`):
- `panchayat_YYYYMMDDTHHMMSSZ.db` (or `.db.enc` / `.dump`)
- `panchayat_YYYYMMDDTHHMMSSZ.db.manifest.json` containing `sha256`, `plaintextSha256`, `hmacSha256`, `encrypted`, `backend`, `sizeBytes`, and `createdAt`.

## 2. Restore Integrity Drill & Recovery Procedure
Verify integrity without touching the live database:
```bash
bash scripts/restore.sh backend/backups/panchayat_YYYYMMDDTHHMMSSZ.db
```
`backend/maintenance.py restore-drill` checks:
1. File SHA-256 matches manifest `sha256`.
2. HMAC-SHA256 signature matches manifest `hmacSha256`.
3. Decrypts via OpenSSL if encrypted and checks `plaintextSha256`.
4. Restores into an isolated temporary SQLite file and runs `PRAGMA integrity_check;` (`ok`) + table row counts (or `pg_restore --list` for PostgreSQL `.dump` backups).

To replace the active SQLite database after stopping the API server (automatically saves a `.pre_restore.*.bak` copy first):
```bash
bash scripts/restore.sh backend/backups/panchayat_YYYYMMDDTHHMMSSZ.db --apply
```

## 3. Cryptographic Audit Checkpoints & Tamper Verification
```bash
# Create signed checkpoint (stored in audit_checkpoints table + audit_checkpoints.jsonl)
python3 backend/maintenance.py audit-checkpoint

# Verify full HMAC-SHA256 hash chain + all checkpoint signatures (exits 1 if tampered)
python3 backend/maintenance.py audit-verify

# Verify retention policy & database immutability triggers
python3 backend/maintenance.py retention-check --days 365
```
Authenticated `SUPER_ADMIN` users can also trigger verification over HTTP via `GET /api/staff/audit/verify`.
