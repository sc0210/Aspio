"""
Per-user rate limiting decorator for expensive operations.

In-memory sliding-window implementation — state is not persisted across
restarts, which is acceptable for this project. Redis has been removed.
"""

import functools
import logging
import time
from collections import defaultdict, deque
from typing import Callable, Dict, Deque

from fastapi import Request

from app.core.exceptions import RateLimitException

logger = logging.getLogger(__name__)

# Module-level in-memory store: operation:user_id -> deque of timestamps
_rate_limit_buckets: Dict[str, Deque[float]] = defaultdict(deque)


def _prune(bucket: Deque[float], cutoff: float) -> None:
    """Remove timestamps older than cutoff from the left of the deque."""
    while bucket and bucket[0] < cutoff:
        bucket.popleft()


class UserRateLimiter:
    """Per-user rate limiter for expensive operations (in-memory sliding window)."""

    def __init__(
        self,
        max_requests: int = 10,
        window_seconds: int = 60,
        operation_name: str = "operation",
    ):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.operation_name = operation_name

    async def check_rate_limit(self, user_id: str) -> tuple[bool, int, float]:
        """
        Check if user is within rate limits.

        Returns:
            tuple: (is_allowed, remaining_requests, reset_time)
        """
        bucket_key = f"{self.operation_name}:{user_id}"
        now = time.time()
        cutoff = now - self.window_seconds

        bucket = _rate_limit_buckets[bucket_key]
        _prune(bucket, cutoff)

        count = len(bucket)
        is_allowed = count < self.max_requests

        if is_allowed:
            bucket.append(now)

        remaining = max(0, self.max_requests - count - 1)
        reset_time = now + self.window_seconds

        return is_allowed, remaining, reset_time

    def __call__(self, func: Callable) -> Callable:
        """Decorator to apply rate limiting to async route handlers."""

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            user_id = None

            if "user_id" in kwargs:
                user_id = kwargs["user_id"]
            elif "current_user" in kwargs:
                user_id = (
                    kwargs["current_user"].id
                    if hasattr(kwargs["current_user"], "id")
                    else str(kwargs["current_user"])
                )

            for arg in args:
                if isinstance(arg, Request):
                    user_id = getattr(arg.state, "user_id", None)
                    if user_id:
                        break

            if not user_id:
                logger.warning(
                    f"Cannot identify user for rate limiting {self.operation_name}"
                )
                return await func(*args, **kwargs)

            is_allowed, remaining, reset_time = await self.check_rate_limit(
                str(user_id)
            )

            if not is_allowed:
                logger.warning(
                    f"User rate limit exceeded: user={user_id}, "
                    f"operation={self.operation_name}"
                )
                raise RateLimitException(
                    f"Rate limit exceeded for {self.operation_name}. "
                    f"Please try again in "
                    f"{int(reset_time - time.time())} seconds."
                )

            return await func(*args, **kwargs)

        return wrapper


def rate_limit_user(
    max_requests: int = 10,
    window_seconds: int = 60,
    operation_name: str = "operation",
) -> Callable:
    """
    Decorator factory for per-user rate limiting.

    Args:
        max_requests: Maximum requests allowed in the time window
        window_seconds: Time window in seconds
        operation_name: Name of the operation for logging and error messages

    Returns:
        Decorator function
    """
    return UserRateLimiter(max_requests, window_seconds, operation_name)


# Predefined rate limiters for common operations
rate_limit_market_data = rate_limit_user(
    max_requests=10, window_seconds=60, operation_name="market_data"
)

rate_limit_analytics = rate_limit_user(
    max_requests=10,
    window_seconds=60,
    operation_name="analytics",
)

rate_limit_portfolio_sync = rate_limit_user(
    max_requests=3, window_seconds=60, operation_name="portfolio_sync"
)

rate_limit_bulk_import = rate_limit_user(
    max_requests=2, window_seconds=300, operation_name="bulk_import"
)
