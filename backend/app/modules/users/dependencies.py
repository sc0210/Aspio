"""
User dependencies for FastAPI dependency injection.

This module provides authentication and authorization dependencies
for FastAPI endpoints with comprehensive security validation.
"""

from typing import Optional, Annotated
from uuid import UUID
import logging
import time

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User, UserStatus, UserRole
from .repositories import get_user_repository
from .security import jwt_manager
from ...core.database import get_async_session
from ...utils.client_ip import get_client_ip

logger = logging.getLogger(__name__)


class _AuthUser:
    """Lightweight, detached, read-only user for fast auth checks.

    Duck-types as ``User`` for the handful of attributes the auth/permission layer
    reads. Used by the optional-auth path so the per-request user lookup can be served
    from an in-process cache without holding a live ORM instance across sessions.
    """

    def __init__(self, *, id, email, name, is_active, is_verified, status, role):
        self.id = id
        self.email = email
        self.name = name
        self.is_active = is_active
        self.is_verified = is_verified
        self.status = status
        self.role = role
        self.deleted_at = None


# In-process TTL cache for the optional-auth user lookup. This query runs on every
# request to optional-auth endpoints (e.g. the whole dashboard); caching it removes a
# DB round-trip from the hot path. Staleness window is bounded by _AUTH_CACHE_TTL —
# a user deactivated/suspended mid-window keeps access to optional-auth endpoints (low
# risk, since those also serve anonymous users) until the entry expires or is
# invalidated via invalidate_user_auth_cache().
_AUTH_CACHE_TTL = 30.0  # seconds
_AUTH_CACHE_MAX = 2048
# Maps str(user_id) -> (cached_at_monotonic, immutable field dict). We cache the raw
# fields (not the object) and build a fresh _AuthUser per request, so a consumer that
# mutates its user object can't leak that change into another request's cache hit.
_user_auth_cache: dict[str, tuple[float, dict]] = {}


def invalidate_user_auth_cache(user_id) -> None:
    """Drop a user's cached auth entry (call after suspend/deactivate/verify changes)."""
    _user_auth_cache.pop(str(user_id), None)

# Security scheme for JWT tokens
security = HTTPBearer(
    scheme_name="JWT Authentication",
    description="JWT token required for authentication",
)


async def get_current_user_from_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: AsyncSession = Depends(get_async_session),
) -> User:
    """
    Get current authenticated user from JWT token.

    Args:
        credentials: JWT token credentials
        session: Database session

    Returns:
        Authenticated user

    Raises:
        HTTPException: If authentication fails
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        # Verify JWT token — signature verification is ALWAYS enforced regardless of
        # environment. Bypassing signature verification lets any attacker forge a token
        # with an arbitrary user_id and impersonate any account.
        payload = jwt_manager.verify_token(credentials.credentials, "access")
        if payload is None:
            raise credentials_exception

        # Extract user ID from token
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception

        try:
            user_id = UUID(user_id_str)
        except ValueError:
            raise credentials_exception

        # Get user from database
        user_repo = get_user_repository(session)
        user = await user_repo.get_user_by_id(user_id)

        if user is None:
            raise credentials_exception

        # Check if user is active
        if not user.is_active or user.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is deactivated",
            )

        # Check account status
        if user.status == UserStatus.SUSPENDED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is suspended",
            )

        # Check if account is locked
        if user.is_account_locked:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail="User account is temporarily locked",
            )

        return user

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating user token: {str(e)}")
        raise credentials_exception


async def get_current_active_user(
    current_user: User = Depends(get_current_user_from_token),
) -> User:
    """
    Get current active user (alias for get_current_user_from_token).

    Args:
        current_user: Current authenticated user

    Returns:
        Active user
    """
    return current_user


async def get_current_verified_user(
    current_user: User = Depends(get_current_user_from_token),
) -> User:
    """
    Get current verified user (email must be verified).

    Args:
        current_user: Current authenticated user

    Returns:
        Verified user

    Raises:
        HTTPException: If user is not verified
    """
    if not current_user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Email verification required"
        )

    return current_user


async def get_current_premium_user(
    current_user: User = Depends(get_current_verified_user),
) -> User:
    """
    Get current premium user (role must be premium or admin).

    Args:
        current_user: Current verified user

    Returns:
        Premium user

    Raises:
        HTTPException: If user is not premium
    """
    if current_user.role not in [UserRole.PREMIUM, UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Premium subscription required",
        )

    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_verified_user),
) -> User:
    """
    Get current admin user (role must be admin).

    Args:
        current_user: Current verified user

    Returns:
        Admin user

    Raises:
        HTTPException: If user is not admin
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required"
        )

    return current_user


async def get_current_moderator_user(
    current_user: User = Depends(get_current_verified_user),
) -> User:
    """
    Get current moderator user (role must be moderator or admin).

    Args:
        current_user: Current verified user

    Returns:
        Moderator user

    Raises:
        HTTPException: If user is not moderator or admin
    """
    if current_user.role not in [UserRole.MODERATOR, UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Moderator privileges required",
        )

    return current_user


async def get_optional_current_user(
    request: Request, session: AsyncSession = Depends(get_async_session)
) -> Optional[User]:
    """
    Get current user if authenticated, otherwise return None.

    Args:
        request: FastAPI request object
        session: Database session

    Returns:
        User if authenticated, None otherwise
    """
    # No credentials at all → a legitimate anonymous / demo request.
    authorization = request.headers.get("Authorization")
    if not authorization or not authorization.startswith("Bearer "):
        return None

    # A token WAS presented, so from here any validation failure MUST surface as
    # 401 (the client should refresh) — never a silent fallback to demo data,
    # which would poison an authenticated user's requests with demo ids (#189).
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token = authorization.split(" ")[1]

        # Verify JWT signature using the same verified path as get_current_user_from_token.
        # Never skip signature verification — an unverified token allows anyone to forge
        # a payload with an arbitrary user_id and impersonate any account.
        payload = jwt_manager.verify_token(token, "access")
        if payload is None:
            raise credentials_exception

        # Extract user ID from token
        user_id_str: str = payload.get("sub") or payload.get("id")
        if user_id_str is None:
            raise credentials_exception

        try:
            user_id = UUID(user_id_str)
        except ValueError:
            raise credentials_exception

        # Serve from the in-process TTL cache when fresh — avoids a DB round-trip on
        # every optional-auth request (the dashboard hits this on each call).
        cache_key = str(user_id)
        cached = _user_auth_cache.get(cache_key)
        if cached is not None:
            cached_at, fields = cached
            if (time.monotonic() - cached_at) < _AUTH_CACHE_TTL:
                return _AuthUser(**fields)
            # Expired — drop it and fall through to a fresh lookup.
            _user_auth_cache.pop(cache_key, None)

        # Get user from database. A typed Core select, not raw SQL: binding a
        # stringified UUID into text() silently depends on how the dialect renders
        # UUIDs — Postgres coerces '45811286-a8b0-…' fine, but SQLite stores bare
        # 32-char hex and the comparison never matches, so every authenticated
        # request under the test harness 401'd. Selecting typed columns also yields
        # real UserStatus / UserRole members instead of raw strings, so _AuthUser
        # actually matches the User it claims to duck-type. Still a single
        # primary-key lookup of 7 columns — no ORM entity load on the hot path.
        result = await session.execute(
            select(
                User.id,
                User.email,
                User.name,
                User.is_active,
                User.is_verified,
                User.status,
                User.role,
            ).where(User.id == user_id)
        )
        row = result.fetchone()

        if row:
            fields = {
                "id": user_id,
                "email": row.email,
                "name": row.name,
                "is_active": row.is_active,
                "is_verified": row.is_verified,
                "status": row.status,
                "role": row.role,
            }
            # Bound the cache so a flood of distinct ids can't grow it without limit.
            if len(_user_auth_cache) >= _AUTH_CACHE_MAX:
                _user_auth_cache.clear()
            _user_auth_cache[cache_key] = (time.monotonic(), fields)
            return _AuthUser(**fields)

        # Token references a user that no longer exists → unauthorized.
        raise credentials_exception

    except HTTPException:
        raise
    except Exception:
        # A presented token we couldn't validate (unexpected error) is still an
        # auth failure — don't silently fall back to demo data (#189).
        raise credentials_exception


def get_user_agent(request: Request) -> str:
    """
    Extract user agent from request.

    Args:
        request: FastAPI request object

    Returns:
        User agent string
    """
    return request.headers.get("User-Agent", "unknown")


async def rate_limit_check(
    request: Request,
    limit: int = 10,
    window: int = 60,
) -> None:
    """
    Per-IP rate limit guard for sensitive auth endpoints (in-memory sliding window).

    This dependency provides a second line of defence for endpoints that declare
    it explicitly (login, register, password-reset, resend-verification).  The
    global RateLimitMiddleware is the first line; this guard runs inside the route
    handler so it can use request-specific defaults tuned for auth operations.

    Args:
        request: FastAPI request object
        limit: Maximum requests allowed in the window (default 10 per minute)
        window: Time window in seconds

    Raises:
        HTTPException 429: If rate limit exceeded
    """
    import time
    from collections import deque

    # Module-level bucket store shared across all invocations
    if not hasattr(rate_limit_check, "_buckets"):
        from collections import defaultdict
        rate_limit_check._buckets = defaultdict(deque)  # type: ignore[attr-defined]

    client_ip = get_client_ip(request)
    # Namespace by endpoint path so each auth endpoint has its own counter
    bucket_key = f"{client_ip}:{request.url.path}"
    now = time.time()
    cutoff = now - window

    bucket = rate_limit_check._buckets[bucket_key]  # type: ignore[attr-defined]
    # Prune expired entries
    while bucket and bucket[0] < cutoff:
        bucket.popleft()

    if len(bucket) >= limit:
        import logging as _logging
        _logging.getLogger(__name__).warning(
            f"Auth rate limit exceeded for IP {client_ip} on {request.url.path}"
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait before trying again.",
            headers={"Retry-After": str(window)},
        )

    bucket.append(now)


# Type aliases for dependency injection
CurrentUser = Annotated[User, Depends(get_current_active_user)]
CurrentVerifiedUser = Annotated[User, Depends(get_current_verified_user)]
CurrentPremiumUser = Annotated[User, Depends(get_current_premium_user)]
CurrentAdminUser = Annotated[User, Depends(get_current_admin_user)]
CurrentModeratorUser = Annotated[User, Depends(get_current_moderator_user)]
OptionalCurrentUser = Annotated[Optional[User], Depends(get_optional_current_user)]
ClientIP = Annotated[str, Depends(get_client_ip)]
UserAgent = Annotated[str, Depends(get_user_agent)]


# Export dependencies
__all__ = [
    # Authentication dependencies
    "get_current_user_from_token",
    "get_current_active_user",
    "get_current_verified_user",
    "get_current_premium_user",
    "get_current_admin_user",
    "get_current_moderator_user",
    "get_optional_current_user",
    # Utility dependencies
    "get_client_ip",
    "get_user_agent",
    "rate_limit_check",
    # Type aliases
    "CurrentUser",
    "CurrentVerifiedUser",
    "CurrentPremiumUser",
    "CurrentAdminUser",
    "CurrentModeratorUser",
    "OptionalCurrentUser",
    "ClientIP",
    "UserAgent",
]
