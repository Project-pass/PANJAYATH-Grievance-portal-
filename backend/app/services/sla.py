from __future__ import annotations

import json
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from app.policies.rbac import CLOSED_OR_DONE_GRIEVANCE_STATUSES, normalize_grievance_status

DEFAULT_CATEGORY_SLA_DAYS: dict[str, int] = {
    "Public Health": 3,
    "Waste Management": 3,
    "Water Supply": 5,
    "Streetlights": 5,
    "Roads & Drainage": 7,
    "Encroachment": 10,
}

PRIORITY_ADJUSTMENTS: dict[str, int] = {
    "CRITICAL": -2,
    "HIGH": -1,
    "NORMAL": 0,
    "LOW": 3,
}


def parse_utc_iso(iso_str: str | None) -> datetime:
    if not iso_str:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(iso_str.replace("Z", "+00:00")).astimezone(timezone.utc)


def count_working_days(
    start_dt: datetime,
    end_dt: datetime,
    holidays: set[str] | None = None,
    exclude_sundays: bool = True,
) -> int:
    if end_dt <= start_dt:
        return 0
    hol = holidays or set()
    cur_date: date = start_dt.date()
    end_date: date = end_dt.date()
    if cur_date == end_date:
        return 0
    days = 0
    cursor = cur_date
    while cursor < end_date:
        cursor = cursor + timedelta(days=1)
        is_sunday = cursor.weekday() == 6
        if exclude_sundays and is_sunday:
            continue
        if cursor.isoformat() in hol:
            continue
        days += 1
    return days


def resolve_effective_sla_limit(
    category: str,
    priority: str = "NORMAL",
    base_limit_days: int = 7,
    category_policies: dict[str, int] | None = None,
) -> int:
    cat_map = {**DEFAULT_CATEGORY_SLA_DAYS, **(category_policies or {})}
    base = cat_map.get(category, base_limit_days)
    adj = PRIORITY_ADJUSTMENTS.get((priority or "NORMAL").upper(), 0)
    return max(1, min(30, int(base) + int(adj)))


def compute_sla_metrics(
    created_at_iso: str,
    status: str,
    sla_limit_days: int,
    *,
    now_dt: datetime | None = None,
    resolved_at_iso: str | None = None,
    paused_seconds: int = 0,
    hold_started_at_iso: str | None = None,
    holidays: set[str] | None = None,
    exclude_sundays: bool = True,
    c_engine_bin: Path | None = None,
) -> dict:
    """Compute accurate UTC working-day SLA metrics with ON_HOLD pause support."""
    canonical = normalize_grievance_status(status)
    is_closed = canonical in CLOSED_OR_DONE_GRIEVANCE_STATUSES
    is_on_hold = canonical == "ON_HOLD"

    created_dt = parse_utc_iso(created_at_iso)
    current_dt = now_dt or datetime.now(timezone.utc)
    end_dt = parse_utc_iso(resolved_at_iso) if (is_closed and resolved_at_iso) else current_dt

    total_paused = max(0, int(paused_seconds or 0))
    if is_on_hold and hold_started_at_iso:
        hold_dt = parse_utc_iso(hold_started_at_iso)
        total_paused += max(0, int((end_dt - hold_dt).total_seconds()))

    effective_end_dt = max(created_dt, end_dt - timedelta(seconds=total_paused))
    age_days = count_working_days(created_dt, effective_end_dt, holidays=holidays, exclude_sundays=exclude_sundays)

    # Optionally validate label formatting through compiled C binary when available and executable
    if c_engine_bin is not None and c_engine_bin.exists():
        proc = subprocess.run(
            [str(c_engine_bin), "sla", str(min(36500, age_days)), str(max(1, min(30, int(sla_limit_days)))), "1" if is_closed else "0"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            c_res = json.loads(proc.stdout.strip())
            c_res["isOnHold"] = is_on_hold
            c_res["pausedDays"] = round(total_paused / 86400.0, 2)
            c_res["limitDays"] = int(sla_limit_days)
            if is_on_hold:
                c_res["label"] = f"Paused ({age_days}d)"
            return c_res

    remaining = int(sla_limit_days) - age_days
    is_breached = (not is_closed) and (not is_on_hold) and (age_days > int(sla_limit_days))
    if is_closed:
        label = f"Closed ({age_days}d)"
    elif is_on_hold:
        label = f"Paused ({age_days}d)"
    elif is_breached:
        label = f"SLA BREACHED ({age_days}d)"
    elif remaining == 0:
        label = "Due Today"
    else:
        label = f"{remaining}d left"

    return {
        "ageDays": age_days,
        "remainingDays": remaining,
        "limitDays": int(sla_limit_days),
        "isBreached": is_breached,
        "isClosed": is_closed,
        "isOnHold": is_on_hold,
        "pausedDays": round(total_paused / 86400.0, 2),
        "label": label,
    }
