# Backup, Restore Drill & Audit Retention

## 1. Transactional Online Backups
Backups use SQLite's online `sqlite3.Connection.backup()` API so snapshots remain consistent even under active WAL reads/writes:

```bash
# Unencrypted snapshot + SHA-256 + HMAC-SHA256 manifest + automatic restore drill
bash scripts/backup.sh

# Encrypted AES-256-CBC (PBKDF2) snapshot
export PANCHAYAT_BACKUP_KEY="<strong-passphrase>"
bash scripts/backup.sh --encrypt
```

Generated artifacts in `backend/backups/` (permissions `0600`):
- `panchayat_YYYYMMDDTHHMMSSZ.db` (or `.db.enc`)
- `panchayat_YYYYMMDDTHHMMSSZ.db.manifest.json` containing `sha256`, `plaintextSha256`, `hmacSha256`, `encrypted`, `sizeBytes`, and `createdAt`.

## 2. Restore Integrity Drill & Recovery Procedure
Verify integrity without touching the live database:
```bash
bash scripts/restore.sh backend/backups/panchayat_YYYYMMDDTHHMMSSZ.db
```
`backend/maintenance.py restore-drill` checks:
1. File SHA-256 matches manifest `sha256`.
2. HMAC-SHA256 signature matches manifest `hmacSha256`.
3. Decrypts via OpenSSL if encrypted and checks `plaintextSha256`.
4. Restores into an isolated temporary SQLite file and runs `PRAGMA integrity_check;` (`ok`) + table row counts.

To replace the active database after stopping the API server (automatically saves a `.pre_restore.*.bak` copy first):
```bash
bash scripts/restore.sh backend/backups/panchayat_YYYYMMDDTHHMMSSZ.db --apply
```

## 3. Audit Log Retention Verification
```bash
python3 backend/maintenance.py retention-check --days 365
```
Reports total immutable records, records within the 365-day active window, archive-eligible records, and verifies `immutableTriggersActive: true`.
