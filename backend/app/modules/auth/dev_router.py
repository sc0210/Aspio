"""Password-less sign-in for local development.

Issues a real JWT pair for any account in the local database given only an
email address — no password, no OAuth round-trip. It exists so developers (and
agents driving a browser) can open authenticated pages as a specific user
without typing credentials into a form.

**This is an authentication bypass.** It is only mounted when
``settings.dev_login_active`` is true, which requires an explicit
``DEV_LOGIN_ENABLED``, a development ``ENVIRONMENT``, a configured
``DEV_TOOLS_TOKEN``, and a local database — see that property for why each is
needed. Callers must additionally present the token as ``X-Dev-Tools-Token``
(enforced by the shared ``require_dev_tools_token`` dependency).

Network reachability is *not* part of the boundary: the base compose file
publishes port 8000 to the host, and the lan/Pi overlays republish it on
``0.0.0.0``, so anything that can route to the API can reach this route. The
shared token is what makes that safe.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..users.repositories import get_refresh_token_repository, get_user_repository
from ..users.schemas import LoginResponse, UserResponse
from ..users.security import jwt_manager
from ...core.config import get_settings
from ...core.database import get_async_session
from ...core.dev_tools import require_dev_tools_token

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


class DevLoginRequest(BaseModel):
    """Request body for password-less dev sign-in."""

    email: EmailStr = Field(..., description="Email of the local account to sign in as")


def _assert_enabled() -> None:
    """Fail closed if anything about the environment looks non-development.

    Defence in depth — ``require_dev_tools_token`` already checks this, but the
    router must stay safe if it is ever mounted unconditionally.
    """
    if not settings.dev_login_active:
        # 404 rather than 403: don't advertise that the route exists at all.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
        )


@router.post("/dev-login", response_model=LoginResponse)
async def dev_login(
    payload: DevLoginRequest,
    session: AsyncSession = Depends(get_async_session),
    _: None = Depends(require_dev_tools_token),
):
    """Issue tokens for ``payload.email`` without checking a password.

    There is deliberately no companion "list accounts" endpoint: it would hand
    every registered email and role to an unauthenticated caller, and the
    sign-in UI does not need it.
    """
    _assert_enabled()

    user_repo = get_user_repository(session)
    user = await user_repo.get_user_by_email(payload.email)

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active local account for {payload.email}",
        )

    token_data = {"sub": str(user.id), "email": user.email}
    access_token = jwt_manager.create_access_token(token_data)
    refresh_token = jwt_manager.create_refresh_token(token_data)

    # Persist the refresh token so the session behaves like a normal one and
    # survives past the 30-minute access-token expiry.
    await get_refresh_token_repository(session).create_refresh_token(
        user_id=user.id,
        token=refresh_token,
        expires_at=datetime.now(timezone.utc)
        + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )

    # Deliberately skips _update_user_activity: hopping between accounts while
    # developing shouldn't rewrite last_login_at or inflate login streaks and
    # XP. Note this means dev sign-in does not exercise the streak path — use a
    # real login to test that.
    logger.warning(
        "DEV LOGIN: issued tokens for %s without a password (dev-only route)",
        user.email,
    )

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserResponse.model_validate(user),
    )
