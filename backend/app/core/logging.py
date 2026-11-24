from __future__ import annotations

import contextvars
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone

_REQUEST_ID_CTX: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

_REDACTED_KEYS = {"passcode", "password", "token", "secret", "authorization", "cookie", "csrf"}


def set_request_id(request_id: str | None = None) -> str:
    rid = request_id or uuid.uuid4().hex[:16]
    _REQUEST_ID_CTX.set(rid)
    return rid


def get_request_id() -> str:
    return _REQUEST_ID_CTX.get()


def sanitize_log_extra(extra: dict | None) -> dict:
    if not extra:
        return {}
    clean = {}
    for k, v in extra.items():
        if any(marker in str(k).lower() for marker in _REDACTED_KEYS):
            clean[k] = "[REDACTED]"
        else:
            clean[k] = v
    return clean


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "requestId": get_request_id(),
            "message": record.getMessage(),
        }
        extra_data = getattr(record, "structured_data", None)
        if isinstance(extra_data, dict):
            payload["data"] = sanitize_log_extra(extra_data)
        return json.dumps(payload, ensure_ascii=False)


def get_logger(name: str = "panchayat") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        level_name = os.environ.get("PANCHAYAT_LOG_LEVEL", "INFO").upper()
        logger.setLevel(getattr(logging, level_name, logging.INFO))
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.propagate = False
    return logger
