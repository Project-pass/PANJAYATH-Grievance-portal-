from __future__ import annotations


class AppError(Exception):
    status_code: int = 500
    error_code: str = "INTERNAL_ERROR"

    def __init__(self, message: str, status_code: int | None = None, error_code: str | None = None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code
        if error_code is not None:
            self.error_code = error_code


class ValidationError(AppError):
    status_code = 400
    error_code = "VALIDATION_ERROR"


class AuthenticationError(AppError):
    status_code = 401
    error_code = "AUTHENTICATION_REQUIRED"


class AuthorizationError(AppError):
    status_code = 403
    error_code = "FORBIDDEN"


class NotFoundError(AppError):
    status_code = 404
    error_code = "NOT_FOUND"


class ConflictError(AppError):
    status_code = 409
    error_code = "CONFLICT"


class PayloadTooLargeError(AppError):
    status_code = 413
    error_code = "PAYLOAD_TOO_LARGE"


class LockedAccountError(AppError):
    status_code = 423
    error_code = "ACCOUNT_LOCKED"

    def __init__(self, message: str, retry_after: int = 900):
        super().__init__(message)
        self.retry_after = max(1, int(retry_after))


class RateLimitError(AppError):
    status_code = 429
    error_code = "RATE_LIMIT_EXCEEDED"

    def __init__(self, message: str, retry_after: int = 60):
        super().__init__(message)
        self.retry_after = max(1, int(retry_after))


class ServiceUnavailableError(AppError):
    status_code = 503
    error_code = "SERVICE_UNAVAILABLE"
