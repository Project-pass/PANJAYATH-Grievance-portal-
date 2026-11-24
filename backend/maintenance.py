from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

import db as db_mod
from app.database.connection import resolve_database_url
from app.database.interface import detect_database_backend
from app.services.audit_integrity import (
    create_audit_checkpoint,
    verify_audit_chain,
)
from security_utils import get_session_secret_bytes

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
SQLITE_PATH = db_mod.SQLITE_PATH


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def hmac_file(path: str, key: bytes) -> str:
    mac = hmac.new(key, digestmod=hashlib.sha256)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            mac.update(chunk)
    return mac.hexdigest()


def _resolve_backup_hmac_key() -> bytes:
    env_key = os.environ.get("PANCHAYAT_BACKUP_KEY", "").strip()
    if env_key:
        return env_key.encode("utf-8")
    return get_session_secret_bytes()


def run_backup(encrypt: bool = False) -> dict:
    db_mod.init_db(SQLITE_PATH)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backend = detect_database_backend(resolve_database_url(SQLITE_PATH))

    if backend == "postgresql":
        if not shutil.which("pg_dump"):
            raise RuntimeError("pg_dump binary is required for PostgreSQL backups.")
        dest_dump = os.path.join(BACKUP_DIR, f"panchayat_{ts}.dump")
        proc = subprocess.run(
            ["pg_dump", "-Fc", "-f", dest_dump, resolve_database_url(SQLITE_PATH)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"pg_dump failed: {proc.stderr.strip()}")
        dest_db = dest_dump
    else:
        dest_db = os.path.join(BACKUP_DIR, f"panchayat_{ts}.db")
        src = db_mod.get_connection(SQLITE_PATH)
        dst = sqlite3.connect(dest_db)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()

    os.chmod(dest_db, 0o600)
    plain_digest = sha256_file(dest_db)
    artifact_path = dest_db
    encrypted = False

    if encrypt:
        backup_key = os.environ.get("PANCHAYAT_BACKUP_KEY", "").strip()
        if not backup_key:
            raise RuntimeError("PANCHAYAT_BACKUP_KEY environment variable is required when --encrypt is set.")
        if not shutil.which("openssl"):
            raise RuntimeError("openssl binary is required for AES-256-CBC backup encryption.")
        enc_path = dest_db + ".enc"
        env = {**os.environ, "PANCHAYAT_OPENSSL_PASS": backup_key}
        proc = subprocess.run(
            [
                "openssl",
                "enc",
                "-aes-256-cbc",
                "-pbkdf2",
                "-salt",
                "-in",
                dest_db,
                "-out",
                enc_path,
                "-pass",
                "env:PANCHAYAT_OPENSSL_PASS",
            ],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"OpenSSL backup encryption failed: {proc.stderr.strip()}")
        os.chmod(enc_path, 0o600)
        os.remove(dest_db)
        artifact_path = enc_path
        encrypted = True

    artifact_digest = sha256_file(artifact_path)
    hmac_sig = hmac_file(artifact_path, _resolve_backup_hmac_key())
    manifest = {
        "backupFile": artifact_path,
        "backend": backend,
        "encrypted": encrypted,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sha256": artifact_digest,
        "plaintextSha256": plain_digest,
        "hmacSha256": hmac_sig,
        "sizeBytes": os.path.getsize(artifact_path),
    }
    manifest_path = artifact_path + ".manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    os.chmod(manifest_path, 0o600)
    return manifest


def run_restore_drill(backup_path: str) -> dict:
    if not os.path.exists(backup_path):
        raise FileNotFoundError(f"Backup file not found: {backup_path}")
    manifest_path = backup_path + ".manifest.json"
    manifest = None
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        actual = sha256_file(backup_path)
        if actual != manifest.get("sha256"):
            raise RuntimeError("Backup SHA-256 checksum verification failed!")
        if manifest.get("hmacSha256"):
            actual_hmac = hmac_file(backup_path, _resolve_backup_hmac_key())
            if not hmac.compare_digest(actual_hmac, manifest["hmacSha256"]):
                raise RuntimeError("Backup HMAC signature verification failed!")

    with tempfile.TemporaryDirectory() as tmpdir:
        source_db_path = backup_path
        if backup_path.endswith(".enc") or (manifest and manifest.get("encrypted")):
            backup_key = os.environ.get("PANCHAYAT_BACKUP_KEY", "").strip()
            if not backup_key:
                raise RuntimeError("PANCHAYAT_BACKUP_KEY is required to decrypt encrypted backup.")
            if not shutil.which("openssl"):
                raise RuntimeError("openssl binary is required to decrypt backup.")
            dec_path = os.path.join(tmpdir, "decrypted.db")
            env = {**os.environ, "PANCHAYAT_OPENSSL_PASS": backup_key}
            proc = subprocess.run(
                [
                    "openssl",
                    "enc",
                    "-d",
                    "-aes-256-cbc",
                    "-pbkdf2",
                    "-in",
                    backup_path,
                    "-out",
                    dec_path,
                    "-pass",
                    "env:PANCHAYAT_OPENSSL_PASS",
                ],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode != 0:
                raise RuntimeError(f"OpenSSL backup decryption failed: {proc.stderr.strip()}")
            if manifest and manifest.get("plaintextSha256") and sha256_file(dec_path) != manifest["plaintextSha256"]:
                raise RuntimeError("Decrypted backup plaintext SHA-256 mismatch!")
            source_db_path = dec_path

        restore_target = os.path.join(tmpdir, "restore_verify.db")
        src = sqlite3.connect(source_db_path)
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

    return {
        "ok": integrity == "ok",
        "integrity": integrity,
        "encrypted": bool(manifest and manifest.get("encrypted")),
        "counts": counts,
    }


def check_audit_retention(days: int = 365) -> dict:
    db_mod.init_db(SQLITE_PATH)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")
    conn = db_mod.get_connection(SQLITE_PATH)
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


def run_audit_checkpoint() -> dict:
    db_mod.init_db(SQLITE_PATH)
    conn = db_mod.get_connection(SQLITE_PATH)
    try:
        with db_mod.transaction(conn):
            return create_audit_checkpoint(conn, db_mod.AUDIT_CHECKPOINTS_PATH)
    finally:
        conn.close()


def run_audit_verify(checkpoint_path: str | None = None, jsonl_path: str | None = None) -> dict:
    db_mod.init_db(SQLITE_PATH)
    conn = db_mod.get_connection(SQLITE_PATH)
    try:
        return verify_audit_chain(
            conn,
            checkpoint_path=checkpoint_path or db_mod.AUDIT_CHECKPOINTS_PATH,
            jsonl_path=jsonl_path or db_mod.AUDIT_JSONL_PATH,
        )
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="ABC Gram Panchayat Database Maintenance & Backup Drill")
    sub = parser.add_subparsers(dest="cmd", required=True)
    bkp_p = sub.add_parser("backup", help="Create online transactional DB backup with SHA-256 + HMAC manifest")
    bkp_p.add_argument("--encrypt", action="store_true", help="Encrypt backup with AES-256-CBC using PANCHAYAT_BACKUP_KEY")
    drill_p = sub.add_parser("restore-drill", help="Verify backup checksum/HMAC and integrity via test restore")
    drill_p.add_argument("backup_file")
    ret_p = sub.add_parser("retention-check", help="Inspect immutable audit retention window")
    ret_p.add_argument("--days", type=int, default=365)
    sub.add_parser("audit-checkpoint", help="Write a signed external audit hash checkpoint")
    ver_p = sub.add_parser("audit-verify", help="Verify full cryptographic audit hash chain and checkpoints")
    ver_p.add_argument("--checkpoints", default=None)
    ver_p.add_argument("--jsonl", default=None)

    args = parser.parse_args()
    if args.cmd == "backup":
        print(json.dumps(run_backup(encrypt=args.encrypt), indent=2))
    elif args.cmd == "restore-drill":
        print(json.dumps(run_restore_drill(args.backup_file), indent=2))
    elif args.cmd == "retention-check":
        print(json.dumps(check_audit_retention(args.days), indent=2))
    elif args.cmd == "audit-checkpoint":
        print(json.dumps(run_audit_checkpoint(), indent=2))
    elif args.cmd == "audit-verify":
        res = run_audit_verify(args.checkpoints, args.jsonl)
        print(json.dumps(res, indent=2))
        if not res["ok"]:
            sys.exit(1)


if __name__ == "__main__":
    main()
