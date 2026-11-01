"""
Rate limiting middleware for Aspiro FastAPI backend.

In-memory sliding-window implementation using collections.defaultdict + time.
State is not persisted across restarts, which is acceptable for this project.
"""

import logging
import time
from collections import defaultdict
from typing import Callable, Dict, Deque
from collections import deque

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from ..core.config import get_settings
from ..utils.client_ip import get_client_ip

logger = logging.getLogger(__name__)
settings = get_settings()


# ---------------------------------------------------------------------------
# Module-level in-memory state
# Each bucket key -> deque of request timestamps (float, seconds since epoch)
# ---------------------------------------------------------------------------
_window_buckets: Dict[str, Deque[float]] = defaultdict(deque)
_burst_buckets: Dict[str, Deque[float]] = defaultdict(deque)

_BURST_WINDOW_SECONDS = 10  # burst window duration

# Buckets are keyed by client and raw path, and the middleware runs before
# routing, so every distinct path (a 404 included) used to add two keys that
# were never removed. Sweep idle keys periodically, and hard-cap the total.
_SWEEP_EVERY = 1000
_MAX_BUCKET_KEYS = 50_000
_IDLE_SECONDS = 120  # longer than any rule's window
_calls_since_sweep = 0


def _sweep(now: float) -> None:
    cutoff = now - _IDLE_SECONDS
    for buckets in (_window_buckets, _burst_buckets):
        for key in [k for k, b in buckets.items() if not b or b[-1] < cutoff]:
            del buckets[key]
        if len(buckets) > _MAX_BUCKET_KEYS:
            buckets.clear()


def _prune(bucket: Deque[float], cutoff: float) -> None:
    """Remove timestamps older than cutoff from the left of the deque."""
    while bucket and bucket[0] < cutoff:
        bucket.popleft()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory sliding-window rate limiting middleware."""

    def __init__(self, app: FastAPI):
        super().__init__(app)
        self.enabled = settings.RATE_LIMIT_ENABLED
        self.default_limit = settings.RATE_LIMIT_PER_MINUTE
        self.burst_limit = settings.RATE_LIMIT_BURST

        # Loosen the strict auth limits for React strict mode's double-invoked
        # effects. Explicit config, not `DEBUG`, so a deployment serving real
        # users cannot inherit a 10x-looser login limit from its env shape.
        dev_multiplier = max(1, settings.RATE_LIMIT_DEV_MULTIPLIER)

        # Rate limit rules for different endpoints
        self.rate_limits = {
            # Auth - strict limits for security-sensitive endpoints
            "/api/v1/auth/login": {
                "requests": 5 * dev_multiplier,
                "window": 60,
                "burst": 2 * dev_multiplier,
            },
            # Registration lives under /users, not /auth: keyed to the real path,
            # or the /api/v1/users rule (2000/min) applies instead.
            "/api/v1/users/register": {
                "requests": 3 * dev_multiplier,
                "window": 60,
                "burst": 1 * dev_multiplier,
            },
            "/api/v1/auth/resend-verification": {
                "requests": 3 * dev_multiplier,
                "window": 60,
                "burst": 1 * dev_multiplier,
            },
            "/api/v1/auth/verify-email": {
                "requests": 10 * dev_multiplier,
                "window": 60,
                "burst": 3 * dev_multiplier,
            },
            "/api/v1/auth/refresh": {
                "requests": 10 * dev_multiplier,
                "window": 60,
                "burst": 5 * dev_multiplier,
            },
            "/api/v1/auth/password": {
                "requests": 5 * dev_multiplier,
                "window": 60,
                "burst": 2 * dev_multiplier,
            },
            # Auth - very high limits for frequent checks
            "/api/v1/auth/session": {"requests": 2000, "window": 60, "burst": 500},
            "/api/v1/auth/me": {"requests": 2000, "window": 60, "burst": 500},
            "/api/v1/auth/status": {"requests": 2000, "window": 60, "burst": 500},
            "/api/auth/session": {"requests": 2000, "window": 60, "burst": 500},
            # Core feature endpoints - very high limits for SPA usage
            "/api/v1/portfolio": {"requests": 2000, "window": 60, "burst": 500},
            "/api/v1/transactions": {"requests": 2000, "window": 60, "burst": 500},
            "/api/v1/dashboard": {"requests": 2000, "window": 60, "burst": 500},
            "/api/v1/goals": {"requests": 2000, "window": 60, "burst": 500},
            "/api/v1/notifications": {"requests": 2000, "window": 60, "burst": 500},
            "/api/v1/users": {"requests": 2000, "window": 60, "burst": 500},
            "/api/v1/admin": {"requests": 2000, "window": 60, "burst": 500},
        }

        # Exempt paths from rate limiting
        self.exempt_paths = [
            "/health",
            "/health/detailed",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/api/auth/session",  # NextAuth session checks
        ]

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if (
            not self.enabled
            or request.method == "OPTIONS"
            or self._is_exempt(request.url.path)
        ):
            return await call_next(request)

        client_id = self._get_client_id(request)
        is_allowed, remaining, reset_time = self._check_rate_limit(
            client_id, request.url.path, request.method
        )

        if not is_allowed:
            logger.warning(
                f"Rate limit exceeded for client {client_id} on "
                f"{request.method} {request.url.path}"
            )
            rate_config = self._get_rate_limit(request.url.path)
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Rate limit exceeded. Please try again later.",
                    "error_code": "RATE_LIMIT_EXCEEDED",
                },
                headers={
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(reset_time)),
                    "X-RateLimit-Limit": str(rate_config["requests"]),
                    "Retry-After": str(rate_config["window"]),
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(reset_time))
        response.headers["X-RateLimit-Limit"] = str(
            self._get_rate_limit(request.url.path)["requests"]
        )
        return response

    def _check_rate_limit(
        self, client_id: str, path: str, method: str
    ) -> tuple[bool, int, float]:
        """Sliding-window rate limit check using in-memory deques."""
        rate_config = self._get_rate_limit(path)
        window_size = rate_config["window"]
        window_limit = rate_config["requests"]
        burst_limit = rate_config["burst"]

        now = time.time()
        window_cutoff = now - window_size
        burst_cutoff = now - _BURST_WINDOW_SECONDS

        global _calls_since_sweep
        _calls_since_sweep += 1
        if _calls_since_sweep >= _SWEEP_EVERY or len(_window_buckets) > _MAX_BUCKET_KEYS:
            _calls_since_sweep = 0
            _sweep(now)

        window_key = f"{client_id}:{path}:{method}:window"
        burst_key = f"{client_id}:{path}:{method}:burst"

        window_bucket = _window_buckets[window_key]
        burst_bucket = _burst_buckets[burst_key]

        # Prune expired entries
        _prune(window_bucket, window_cutoff)
        _prune(burst_bucket, burst_cutoff)

        window_count = len(window_bucket)
        burst_count = len(burst_bucket)

        is_allowed = window_count < window_limit and burst_count < burst_limit

        if is_allowed:
            window_bucket.append(now)
            burst_bucket.append(now)

        remaining = max(
            0,
            min(window_limit - window_count - 1, burst_limit - burst_count - 1),
        )
        reset_time = now + window_size

        return is_allowed, remaining, reset_time

    def _get_client_id(self, request: Request) -> str:
        user_id = getattr(request.state, "user_id", None)
        if user_id:
            return f"user:{user_id}"

        return f"ip:{get_client_ip(request)}"

    def _get_rate_limit(self, path: str) -> dict:
        if path in self.rate_limits:
            return self.rate_limits[path]

        best_match = None
        best_match_len = 0
        for pattern, config in self.rate_limits.items():
            if path.startswith(pattern) and len(pattern) > best_match_len:
                best_match = config
                best_match_len = len(pattern)

        if best_match:
            return best_match

        return {"requests": self.default_limit, "window": 60, "burst": self.burst_limit}

    def _is_exempt(self, path: str) -> bool:
        return any(exempt in path for exempt in self.exempt_paths)


def setup_rate_limiting(app: FastAPI) -> None:
    if settings.RATE_LIMIT_ENABLED:
        app.add_middleware(RateLimitMiddleware)
        logger.info("Rate limiting middleware configured (in-memory)")
    else:
        logger.info("Rate limiting disabled")
