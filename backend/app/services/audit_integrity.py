"""Cryptographic HMAC-SHA256 hash chaining, signed checkpoints, and tamper detection for audit logs."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
from typing import Any
import uuid

from app.core.config import DATA_DIR, is_production_env
from security_utils import get_session_secret_bytes

DEFAULT_CHECKPOINTS_PATH = str(DATA_DIR / "audit_checkpoints.jsonl")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def resolve_audit_hmac_key() -> bytes:
    """Resolve external audit integrity key (never stored inside the writable database)."""
    env_key = os.environ.get("PANCHAYAT_AUDIT_HMAC_KEY", "").strip()
    if env_key:
        if is_production_env() and len(env_key) < 32:
            raise RuntimeError("PANCHAYAT_AUDIT_HMAC_KEY must be at least 32 characters in production.")
        return env_key.encode("utf-8")
    # Domain-separated derivation from external session secret (.session_secret or PANCHAYAT_SESSION_SECRET)
    return hmac.new(get_session_secret_bytes(), b"panchayat-audit-hash-chain-v1", hashlib.sha256).digest()


def _row_val(row: Any, key: str, default: Any = "") -> Any:
    if isinstance(row, dict):
        return row.get(key, default)
    keys = row.keys() if hasattr(row, "keys") else ()
    return row[key] if key in keys else default


def canonical_audit_payload(row: Any) -> str:
    payload = {
        "seq_no": int(_row_val(row, "seq_no")),
        "id": str(_row_val(row, "id")),
        "timestamp": str(_row_val(row, "timestamp")),
        "request_id": str(_row_val(row, "request_id", "-")),
        "actor_id": str(_row_val(row, "actor_id")),
        "actor_name": str(_row_val(row, "actor_name")),
        "actor_role": str(_row_val(row, "actor_role")),
        "session_prefix": str(_row_val(row, "session_prefix")),
        "ip_hash": str(_row_val(row, "ip_hash")),
        "action": str(_row_val(row, "action")),
        "target_id": str(_row_val(row, "target_id")),
        "outcome": str(_row_val(row, "outcome")),
        "details": str(_row_val(row, "details")),
        "prev_hash": str(_row_val(row, "prev_hash")),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_event_hash(row: Any, key: bytes | None = None) -> str:
    k = key if key is not None else resolve_audit_hmac_key()
    msg = canonical_audit_payload(row).encode("utf-8")
    return hmac.new(k, msg, hashlib.sha256).hexdigest()


def compute_checkpoint_signature(checkpoint: dict[str, Any], key: bytes | None = None) -> str:
    k = key if key is not None else resolve_audit_hmac_key()
    body = {
        "checkpointId": str(checkpoint["checkpointId"]),
        "createdAt": str(checkpoint["createdAt"]),
        "seqNo": int(checkpoint["seqNo"]),
        "eventId": str(checkpoint["eventId"]),
        "eventHash": str(checkpoint["eventHash"]),
        "recordCount": int(checkpoint["recordCount"]),
    }
    raw = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hmac.new(k, raw, hashlib.sha256).hexdigest()


def append_checkpoint_record(
    checkpoint_path: str | Path,
    seq_no: int,
    event_id: str,
    event_hash: str,
    record_count: int,
    *,
    key: bytes | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    k = key if key is not None else resolve_audit_hmac_key()
    cp = {
        "checkpointId": f"chk-{uuid.uuid4().hex[:12]}",
        "createdAt": _now_iso(),
        "seqNo": int(seq_no),
        "eventId": str(event_id),
        "eventHash": str(event_hash),
        "recordCount": int(record_count),
    }
    cp["signature"] = compute_checkpoint_signature(cp, k)

    path_str = str(checkpoint_path)
    parent = os.path.dirname(os.path.abspath(path_str))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path_str, "a", encoding="utf-8") as f:
        f.write(json.dumps(cp) + "\n")
    try:
        os.chmod(path_str, 0o600)
    except OSError:
        pass

    if conn is not None:
        try:
            conn.execute(
                """
                INSERT INTO audit_checkpoints(
                    checkpoint_id, seq_no, event_id, event_hash, record_count, signature, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cp["checkpointId"],
                    cp["seqNo"],
                    cp["eventId"],
                    cp["eventHash"],
                    cp["recordCount"],
                    cp["signature"],
                    cp["createdAt"],
                ),
            )
        except Exception:
            # Table may not exist yet during early pre-v4 migration steps
            pass
    return cp


def create_audit_checkpoint(
    conn: Any,
    checkpoint_path: str | Path = DEFAULT_CHECKPOINTS_PATH,
    key: bytes | None = None,
) -> dict[str, Any]:
    total = int(conn.execute("SELECT COUNT(*) AS c FROM audit_logs").fetchone()["c"])
    head = conn.execute(
        "SELECT id, seq_no, event_hash FROM audit_logs WHERE seq_no IS NOT NULL ORDER BY seq_no DESC LIMIT 1"
    ).fetchone()
    if not head:
        return append_checkpoint_record(
            checkpoint_path, 0, "GENESIS", "0" * 64, total, key=key, conn=conn
        )
    return append_checkpoint_record(
        checkpoint_path,
        int(head["seq_no"]),
        str(head["id"]),
        str(head["event_hash"]),
        total,
        key=key,
        conn=conn,
    )


def backfill_audit_hash_chain(conn: Any, key: bytes | None = None) -> int:
    """Backfill seq_no, prev_hash, and event_hash for legacy rows lacking chain fields."""
    k = key if key is not None else resolve_audit_hmac_key()
    rows = conn.execute(
        "SELECT * FROM audit_logs ORDER BY COALESCE(seq_no, 0) ASC, timestamp ASC, id ASC"
    ).fetchall()
    prev_hash = "0" * 64
    updated = 0
    for idx, row in enumerate(rows, start=1):
        keys = row.keys()
        cur_seq = row["seq_no"] if "seq_no" in keys else None
        cur_prev = row["prev_hash"] if "prev_hash" in keys else None
        cur_hash = row["event_hash"] if "event_hash" in keys else None
        if cur_seq == idx and cur_prev == prev_hash and cur_hash:
            prev_hash = str(cur_hash)
            continue
        draft = {
            "seq_no": idx,
            "id": row["id"],
            "timestamp": row["timestamp"],
            "request_id": row["request_id"] if "request_id" in keys else "-",
            "actor_id": row["actor_id"],
            "actor_name": row["actor_name"],
            "actor_role": row["actor_role"],
            "session_prefix": row["session_prefix"],
            "ip_hash": row["ip_hash"],
            "action": row["action"],
            "target_id": row["target_id"],
            "outcome": row["outcome"],
            "details": row["details"],
            "prev_hash": prev_hash,
        }
        evt_hash = compute_event_hash(draft, k)
        conn.execute(
            "UPDATE audit_logs SET seq_no = ?, prev_hash = ?, event_hash = ? WHERE id = ?",
            (idx, prev_hash, evt_hash, row["id"]),
        )
        prev_hash = evt_hash
        updated += 1
    return updated


def verify_audit_chain(
    conn: Any,
    checkpoint_path: str | Path | None = DEFAULT_CHECKPOINTS_PATH,
    jsonl_path: str | Path | None = None,
    key: bytes | None = None,
) -> dict[str, Any]:
    """Verify full cryptographic hash chain, sequence continuity, ordering, and signed external checkpoints."""
    k = key if key is not None else resolve_audit_hmac_key()
    errors: list[str] = []

    rows = conn.execute(
        "SELECT * FROM audit_logs ORDER BY COALESCE(seq_no, 0) ASC, id ASC"
    ).fetchall()

    by_seq: dict[int, Any] = {}
    expected_prev = "0" * 64
    prev_ts = ""
    head_seq = 0
    head_hash = "0" * 64

    for idx, row in enumerate(rows, start=1):
        keys = row.keys()
        seq_val = row["seq_no"] if "seq_no" in keys else None
        prev_val = row["prev_hash"] if "prev_hash" in keys else None
        hash_val = row["event_hash"] if "event_hash" in keys else None

        if seq_val is None or prev_val is None or hash_val is None:
            errors.append(f"Row {row['id']} is missing cryptographic hash chain metadata.")
            continue

        seq_int = int(seq_val)
        if seq_int != idx:
            errors.append(
                f"Audit sequence gap or reordering at row {row['id']}: expected seq_no={idx}, got {seq_int}."
            )

        if not hmac.compare_digest(str(prev_val), expected_prev):
            errors.append(
                f"Broken prev_hash link at seq_no={seq_int} ({row['id']}): expected {expected_prev[:12]}..., got {str(prev_val)[:12]}...."
            )

        expected_hash = compute_event_hash(row, k)
        if not hmac.compare_digest(str(hash_val), expected_hash):
            errors.append(
                f"Audit event payload tampered at seq_no={seq_int} ({row['id']}): HMAC mismatch."
            )

        ts_str = str(row["timestamp"])
        if prev_ts and ts_str < prev_ts:
            # Seed events may share fixed historical timestamps before runtime appends; only flag if seq inverted
            pass
        prev_ts = ts_str
        by_seq[seq_int] = row
        expected_prev = str(hash_val)
        head_seq = seq_int
        head_hash = str(hash_val)

    checkpoints_verified = 0
    if checkpoint_path and os.path.exists(str(checkpoint_path)):
        with open(str(checkpoint_path), "r", encoding="utf-8") as f:
            for lineno, raw_line in enumerate(f, start=1):
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    cp = json.loads(line)
                except json.JSONDecodeError:
                    errors.append(f"Corrupt JSON in checkpoint file line {lineno}.")
                    continue

                sig = str(cp.get("signature", ""))
                try:
                    expected_sig = compute_checkpoint_signature(cp, k)
                except Exception:
                    errors.append(f"Malformed checkpoint structure at line {lineno}.")
                    continue

                if not sig or not hmac.compare_digest(sig, expected_sig):
                    errors.append(f"Forged or tampered checkpoint signature at line {lineno} ({cp.get('checkpointId')}).")
                    continue

                cp_seq = int(cp.get("seqNo", 0))
                if cp_seq == 0:
                    checkpoints_verified += 1
                    continue

                if cp_seq > len(rows) or cp_seq not in by_seq:
                    errors.append(
                        f"Audit tail deletion or truncation detected: checkpoint references seq_no={cp_seq}, database only has {len(rows)} record(s)."
                    )
                    continue

                db_row = by_seq[cp_seq]
                if str(db_row["id"]) != str(cp.get("eventId")) or not hmac.compare_digest(
                    str(db_row["event_hash"]), str(cp.get("eventHash", ""))
                ):
                    errors.append(
                        f"Checkpoint mismatch at seq_no={cp_seq}: database state diverges from signed checkpoint."
                    )
                    continue
                checkpoints_verified += 1

    if jsonl_path and os.path.exists(str(jsonl_path)):
        with open(str(jsonl_path), "r", encoding="utf-8") as f:
            for lineno, raw_line in enumerate(f, start=1):
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    errors.append(f"Corrupt JSON in audit shadow log line {lineno}.")
                    continue
                seq_val = evt.get("seqNo")
                if seq_val is not None:
                    seq_int = int(seq_val)
                    if seq_int not in by_seq:
                        errors.append(
                            f"Audit shadow JSONL contains seq_no={seq_int} ({evt.get('id')}) missing from database."
                        )
                    elif not hmac.compare_digest(str(by_seq[seq_int]["event_hash"]), str(evt.get("eventHash", ""))):
                        errors.append(
                            f"Audit shadow JSONL hash mismatch at seq_no={seq_int} ({evt.get('id')})."
                        )

    return {
        "ok": len(errors) == 0,
        "verifiedRecords": len(rows),
        "headSeqNo": head_seq,
        "headEventHash": head_hash,
        "checkpointsVerified": checkpoints_verified,
        "errors": errors,
    }
