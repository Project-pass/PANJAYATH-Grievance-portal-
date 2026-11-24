from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
import json
import math
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

PERF_DIR = os.path.dirname(os.path.abspath(__file__))
TESTS_DIR = os.path.dirname(PERF_DIR)
BACKEND_DIR = os.path.dirname(TESTS_DIR)
for p in (BACKEND_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import logging

import db  # noqa: E402
from app.database.connection import dispose_all_adapters, resolve_database_url  # noqa: E402
from security_utils import hash_token  # noqa: E402
import server  # noqa: E402


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, math.ceil((pct / 100.0) * len(ordered)) - 1))
    return round(ordered[idx], 2)


def summarize_latencies(values: list[float]) -> dict[str, float]:
    return {
        "count": len(values),
        "p50Ms": percentile(values, 50),
        "p95Ms": percentile(values, 95),
        "p99Ms": percentile(values, 99),
        "maxMs": round(max(values), 2) if values else 0.0,
    }


def http_json(base_url: str, method: str, path: str, payload=None, cookie_header: str = "", csrf: str = ""):
    data = None
    headers = {"X-Requested-With": "PanchayatPortal"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if cookie_header:
        headers["Cookie"] = cookie_header
    if csrf:
        headers["X-CSRF-Token"] = csrf
    req = urllib.request.Request(f"{base_url}{path}", data=data, method=method, headers=headers)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return resp.status, elapsed_ms, json.loads(raw), resp.headers.get_all("Set-Cookie") or []
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        try:
            body = json.loads(raw)
        except Exception:
            body = {"ok": False}
        return exc.code, elapsed_ms, body, []


def run_benchmark(counts: list[int], iterations: int, concurrent_workers: int) -> dict:
    tmpdir = tempfile.mkdtemp(prefix="panchayat_perf_")
    db_path = os.path.join(tmpdir, "perf.sqlite")
    orig_sqlite = db.SQLITE_PATH
    orig_server_sqlite = server.SQLITE_PATH
    server.SQLITE_PATH = db_path
    db.SQLITE_PATH = db_path
    os.environ["PANCHAYAT_ENV"] = "test"
    os.environ["PANCHAYAT_TEST_DB"] = db_path
    os.environ["PANCHAYAT_AUDIT_KEY_FILE"] = os.path.join(tmpdir, ".audit_hmac.key")
    logging.getLogger("panchayat.api").setLevel(logging.WARNING)

    httpd = None
    thread = None
    try:
        db.init_db(db_path)
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.PanchayatApiHandler)
        port = httpd.server_address[1]
        base_url = f"http://127.0.0.1:{port}"
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()

        # Bootstrap Secretary session
        status, _, body, cookies = http_json(
            base_url, "POST", "/api/auth/bootstrap-claim", {"passcode": "PerfBench#2026"}
        )
        if status != 200 or not body.get("ok"):
            raise RuntimeError(f"Bootstrap failed: status={status} body={body}")
        cookie_pairs = [c.split(";", 1)[0] for c in cookies]
        cookie_header = "; ".join(cookie_pairs)
        csrf = body.get("csrfToken", "")

        scale_reports = []
        offset = 10_000

        for target_count in counts:
            conn = db.get_connection(db_path)
            try:
                cur = conn.execute("SELECT COUNT(*) FROM grievances")
                current_rows = int(cur.fetchone()[0])
                to_insert = max(0, target_count - current_rows)
                t_ins = time.perf_counter()
                if to_insert > 0:
                    batch_params = []
                    for i in range(to_insert):
                        idx = offset + i
                        gid = f"ABC-GRV-2026-{idx:06d}"
                        batch_params.append(
                            (
                                gid,
                                str(uuid.uuid4()),
                                f"Citizen {idx}",
                                (idx % 15) + 1,
                                hash_token(f"TK-PERF-{idx}"),
                            )
                        )
                    with db.transaction(conn):
                        for params in batch_params:
                            conn.execute(
                                """
                                INSERT INTO grievances(
                                    id, external_uuid, citizen_name, mobile, mobile_last4, ward, category, department,
                                    priority, sla_limit_days, paused_seconds, hold_started_at, escalated_at,
                                    escalation_level, consent_recorded, landmark, description, status,
                                    created_at, updated_at, resolved_at, assigned_officer_id, assigned_officer_name,
                                    filed_by_role, before_photo_url, after_photo_url, public_remark, internal_remark,
                                    rating, feedback_comment, timeline_json, tracking_token_hash
                                ) VALUES (?, ?, ?, '9876543210', '3210', ?, 'Water Supply', 'Water & Sanitation',
                                          'NORMAL', 5, 0, NULL, NULL, 0, TRUE, 'Main Junction', 'Benchmark record',
                                          'IN_PROGRESS', '2026-11-20T09:00:00Z', '2026-11-20T09:00:00Z', NULL, NULL, NULL,
                                          'CITIZEN', NULL, NULL, 'Queued', NULL, NULL, NULL, '[]', ?)
                                """,
                                params,
                            )
                    offset += to_insert
                insert_ms = round((time.perf_counter() - t_ins) * 1000.0, 2)
            finally:
                conn.close()

            paginated_latencies = []
            overview_latencies = []
            for _ in range(iterations):
                st_pg, ms_pg, _, _ = http_json(
                    base_url,
                    "GET",
                    "/api/staff/grievances?page=2&pageSize=25&ward=3&status=IN_PROGRESS",
                    cookie_header=cookie_header,
                )
                if st_pg != 200:
                    raise RuntimeError(f"Paginated query returned {st_pg}")
                paginated_latencies.append(ms_pg)

                st_ov, ms_ov, _, _ = http_json(base_url, "GET", "/api/public/overview")
                if st_ov != 200:
                    raise RuntimeError(f"Overview returned {st_ov}")
                overview_latencies.append(ms_ov)

            scale_reports.append(
                {
                    "totalRows": target_count,
                    "insertedRows": to_insert,
                    "bulkInsertMs": insert_ms,
                    "insertRowsPerSec": round((to_insert / (insert_ms / 1000.0)), 1) if insert_ms > 0 else 0.0,
                    "paginatedQuery": summarize_latencies(paginated_latencies),
                    "publicOverview": summarize_latencies(overview_latencies),
                }
            )

        # Concurrency spike test: mixed reads + public citizen submissions
        concurrent_latencies = []
        server_errors = 0

        def worker(i: int):
            if i % 3 == 0:
                st, ms, _, _ = http_json(
                    base_url,
                    "POST",
                    "/api/public/grievances",
                    {
                        "citizenName": f"Load Citizen {i}",
                        "mobile": "9847000111",
                        "ward": (i % 15) + 1,
                        "category": "Water Supply",
                        "priority": "NORMAL",
                        "landmark": f"Load Marker {i}",
                        "description": "Concurrent load benchmark grievance submission check.",
                        "consentAccepted": True,
                    },
                )
                return st, ms
            st, ms, _, _ = http_json(
                base_url,
                "GET",
                "/api/staff/grievances?page=1&pageSize=25",
                cookie_header=cookie_header,
            )
            return st, ms

        with ThreadPoolExecutor(max_workers=concurrent_workers) as pool:
            for st, ms in pool.map(worker, range(concurrent_workers * 3)):
                concurrent_latencies.append(ms)
                if st >= 500:
                    server_errors += 1

        # Graceful shutdown verification
        t_shut = time.perf_counter()
        httpd.shutdown()
        httpd.server_close()
        httpd = None
        dispose_all_adapters()
        shutdown_ms = round((time.perf_counter() - t_shut) * 1000.0, 2)

        return {
            "backend": db.detect_database_backend(resolve_database_url(db_path)),
            "scales": scale_reports,
            "concurrency": {
                "workers": concurrent_workers,
                "requests": len(concurrent_latencies),
                "server5xxErrors": server_errors,
                "latency": summarize_latencies(concurrent_latencies),
            },
            "gracefulShutdownMs": shutdown_ms,
            "csrfTokenLength": len(csrf),
        }
    finally:
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
        dispose_all_adapters()
        db.SQLITE_PATH = orig_sqlite
        server.SQLITE_PATH = orig_server_sqlite
        shutil.rmtree(tmpdir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="ABC Gram Panchayat Performance & Resilience Benchmark")
    parser.add_argument("--counts", nargs="+", type=int, default=[500, 5000])
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    report = run_benchmark(args.counts, args.iterations, args.workers)
    print(json.dumps(report, indent=2))
    if report["concurrency"]["server5xxErrors"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
