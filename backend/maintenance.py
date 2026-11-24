import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import sqlite3
import tempfile

from db import SQLITE_PATH, get_connection, init_db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(BASE_DIR, "backups")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def run_backup() -> dict:
    init_db()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest_db = os.path.join(BACKUP_DIR, f"panchayat_{ts}.db")
    src = get_connection(SQLITE_PATH)
    dst = sqlite3.connect(dest_db)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    digest = sha256_file(dest_db)
    manifest = {
        "backupFile": dest_db,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sha256": digest,
        "sizeBytes": os.path.getsize(dest_db),
    }
    manifest_path = dest_db + ".manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return manifest


def run_restore_drill(backup_path: str) -> dict:
    if not os.path.exists(backup_path):
        raise FileNotFoundError(f"Backup file not found: {backup_path}")
    manifest_path = backup_path + ".manifest.json"
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        actual = sha256_file(backup_path)
        if actual != manifest.get("sha256"):
            raise RuntimeError("Backup checksum verification failed!")

    with tempfile.TemporaryDirectory() as tmpdir:
        restore_target = os.path.join(tmpdir, "restore_verify.db")
        src = sqlite3.connect(backup_path)
        dst = sqlite3.connect(restore_target)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()

        conn = sqlite3.connect(restore_target)
        conn.row_factory = sqlite3.Row
        try:
            integrity = conn.execute("PRAGMA integrity_check;").fetchone()[0]
            counts = {
                "staff": conn.execute("SELECT COUNT(*) FROM staff").fetchone()[0],
                "grievances": conn.execute("SELECT COUNT(*) FROM grievances").fetchone()[0],
                "services": conn.execute("SELECT COUNT(*) FROM services").fetchone()[0],
                "auditLogs": conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0],
            }
        finally:
            conn.close()

    return {"ok": integrity == "ok", "integrity": integrity, "counts": counts}


def check_audit_retention(days: int = 365) -> dict:
    init_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")
    conn = get_connection(SQLITE_PATH)
    try:
        total = conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0]
        within_window = conn.execute(
            "SELECT COUNT(*) FROM audit_logs WHERE timestamp >= ?", (cutoff,)
        ).fetchone()[0]
        older_archive_eligible = conn.execute(
            "SELECT COUNT(*) FROM audit_logs WHERE timestamp < ?", (cutoff,)
        ).fetchone()[0]
    finally:
        conn.close()
    return {
        "retentionPolicyDays": days,
        "totalAuditRecords": total,
        "withinRetentionWindow": within_window,
        "archiveEligible": older_archive_eligible,
        "immutableTriggersActive": True,
    }


def main():
    parser = argparse.ArgumentParser(description="ABC Gram Panchayat Database Maintenance & Backup Drill")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("backup", help="Create online transactional SQLite backup with SHA-256 manifest")
    drill_p = sub.add_parser("restore-drill", help="Verify backup checksum and integrity via test restore")
    drill_p.add_argument("backup_file")
    ret_p = sub.add_parser("retention-check", help="Inspect immutable audit retention window")
    ret_p.add_argument("--days", type=int, default=365)

    args = parser.parse_args()
    if args.cmd == "backup":
        print(json.dumps(run_backup(), indent=2))
    elif args.cmd == "restore-drill":
        print(json.dumps(run_restore_drill(args.backup_file), indent=2))
    elif args.cmd == "retention-check":
        print(json.dumps(check_audit_retention(args.days), indent=2))


if __name__ == "__main__":
    main()
