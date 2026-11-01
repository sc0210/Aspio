"""
Authentication router for Aspiro FastAPI backend.

This module contains authentication-specific endpoints that are separate
from user management, focusing purely on token validation and security.
"""

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..users.schemas import (
    LoginRequest,
    LoginResponse,
    TokenRefreshRequest,
    TokenRefreshResponse,
    LogoutRequest,
    GoogleOAuthRequest,
    GoogleOAuthResponse,
    GoogleCallbackRequest,
    GoogleCallbackResponse,
    VerifyEmailRequest,
    ResendVerificationRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from ..users.services import get_user_service
from ..users.dependencies import CurrentUser, ClientIP, UserAgent, rate_limit_check
from ...core.database import get_async_session
from ...common.schemas import ApiResponse

router = APIRouter()

# ===== Token Validation Endpoints =====


@router.get("/me", response_model=ApiResponse[dict])
async def validate_token(current_user: CurrentUser):
    """
    Validate current authentication token.

    This endpoint can be used by frontend applications to verify
    if the current JWT token is valid and get basic user info.
    """
    return ApiResponse.success_response(
        data={
            "user_id": str(current_user.id),
            "email": current_user.email,
            "is_verified": current_user.is_verified,
            "role": current_user.role.value,
            "status": current_user.status.value,
        },
        message="Token is valid",
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    login_data: LoginRequest,
    client_ip: ClientIP,
    user_agent: UserAgent,
    session: AsyncSession = Depends(get_async_session),
    _: None = Depends(rate_limit_check),
):
    """
    Authenticate user credentials.

    This is an alias for the user login endpoint, provided here
    for consistency with traditional auth API patterns.
    """
    user_service = get_user_service(session)
    return await user_service.authenticate_user(login_data, client_ip, user_agent)


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh_access_token(
    token_data: TokenRefreshRequest, session: AsyncSession = Depends(get_async_session)
):
    """
    Refresh JWT access token.

    This is an alias for the user refresh endpoint, provided here
    for consistency with traditional auth API patterns.
    """
    user_service = get_user_service(session)
    return await user_service.refresh_token(token_data)


@router.post("/logout", response_model=ApiResponse[dict])
async def logout(
    logout_data: LogoutRequest,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Logout and revoke tokens.

    This is an alias for the user logout endpoint, provided here
    for consistency with traditional auth API patterns.
    """
    user_service = get_user_service(session)
    success = await user_service.logout_user(
        current_user.id, logout_data.refresh_token, logout_data.logout_all_devices
    )

    if success:
        return ApiResponse.success_response(
            data={"logged_out": True}, message="Successfully logged out"
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Logout failed"
        )


# ===== OAuth Endpoints =====


@router.post("/oauth/google", response_model=GoogleOAuthResponse)
async def google_oauth(
    oauth_data: GoogleOAuthRequest,
    client_ip: ClientIP,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Google OAuth authentication.

    This is an alias for the user Google OAuth endpoint, provided here
    for consistency with traditional auth API patterns.
    """
    user_service = get_user_service(session)
    return await user_service.google_oauth_login(oauth_data, client_ip)


@router.get("/google/login", response_model=ApiResponse[dict])
async def google_oauth_login():
    """
    Initiate Google OAuth login.

    Returns the Google OAuth URL for frontend redirection.
    This endpoint provides the URL that the frontend should redirect to
    for Google OAuth authentication.
    """
    from ...core.config import get_settings
    from ..users.security import google_oauth

    settings = get_settings()

    if not settings.google_oauth_enabled:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth is not configured",
        )

    auth_url = google_oauth.get_authorization_url()

    return ApiResponse.success_response(
        data={"auth_url": auth_url, "provider": "google"},
        message="Google OAuth URL generated successfully",
    )


@router.get("/google/callback", response_model=ApiResponse[dict])
async def google_oauth_callback_get(
    code: str = None, state: str = None, error: str = None, request: Request = None
):
    """
    Google OAuth callback (GET) - Standard OAuth2 flow.

    Handles the redirect from Google OAuth with authorization code.
    This endpoint receives the authorization code from Google and should
    redirect to the frontend with the code for NextAuth processing.
    """
    from fastapi.responses import RedirectResponse
    from ...core.config import get_settings as _get_settings

    frontend_url = (_get_settings().FRONTEND_URL or "http://localhost:3000").rstrip("/")

    # The target is always our own frontend; the query values come from the caller,
    # so they are encoded — a raw `&` in one would smuggle in extra parameters.
    if error:
        return RedirectResponse(
            url=f"{frontend_url}/auth/error?{urlencode({'error': error})}",
            status_code=302,
        )

    if code:
        params = {"code": code}
        if state is not None:
            params["state"] = state
        return RedirectResponse(
            url=f"{frontend_url}/api/auth/callback/google?{urlencode(params)}",
            status_code=302,
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail="Missing authorization code"
    )


@router.post("/google/callback", response_model=GoogleCallbackResponse)
async def google_oauth_callback(
    callback_data: GoogleCallbackRequest,
    client_ip: ClientIP,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Google OAuth callback from NextAuth.

    Handles the callback from NextAuth after Google OAuth authentication,
    creating or signing in users based on Google profile data.
    """
    user_service = get_user_service(session)
    return await user_service.google_oauth_callback(callback_data, client_ip)


# ===== Token Information Endpoints =====


@router.get("/token/info", response_model=ApiResponse[dict])
async def get_token_info(current_user: CurrentUser):
    """
    Get detailed information about the current token.

    Returns token metadata and user information for debugging
    and frontend state management.
    """
    return ApiResponse.success_response(
        data={
            "user_id": str(current_user.id),
            "email": current_user.email,
            "name": current_user.name,
            "is_verified": current_user.is_verified,
            "is_active": current_user.is_active,
            "role": current_user.role.value,
            "status": current_user.status.value,
            "preferences": current_user.preferences,
            "level": current_user.level,
            "experience_points": current_user.experience_points,
            "last_login_at": (
                current_user.last_login_at.isoformat()
                if current_user.last_login_at
                else None
            ),
        },
        message="Token information retrieved",
    )


# ===== Health Check Endpoints =====


@router.get("/status", response_model=ApiResponse[dict])
async def auth_status():
    """
    Get authentication service status.

    Basic health check endpoint to verify that the authentication service
    is operational and responding to requests.
    """
    return ApiResponse.success_response(
        data={"service": "auth", "status": "operational"},
        message="Authentication service is ready",
    )


@router.get("/health", response_model=ApiResponse[dict])
async def auth_health_check():
    """
    Detailed health check for authentication service.

    Verifies that JWT configuration and security components
    are properly configured and operational.
    """
    from ..users.security import jwt_manager
    from ...core.config import get_settings

    settings = get_settings()

    # Test JWT functionality
    try:
        test_payload = {"test": "auth_health_check", "sub": "test-user"}
        test_token = jwt_manager.create_access_token(test_payload)
        decoded_payload = jwt_manager.verify_token(test_token, "access")
        jwt_functional = (
            decoded_payload is not None
            and decoded_payload.get("test") == "auth_health_check"
        )
    except Exception:
        jwt_functional = False

    overall_status = (
        "healthy"
        if (bool(settings.SECRET_KEY) and jwt_functional)
        else "unhealthy"
    )

    # Public route: status only. The JWT algorithm and expiries are not the
    # caller's business.
    return ApiResponse.success_response(
        data={"service": "auth", "status": overall_status},
        message="Authentication service health check completed",
    )


# ===== Email Verification Endpoints =====


@router.post("/verify-email", response_model=ApiResponse[dict])
async def verify_user_email(
    verify_data: VerifyEmailRequest, session: AsyncSession = Depends(get_async_session)
):
    """
    Verify user's email address using verification token.

    Validates verification token and marks email as verified,
    activating the user account and awarding experience points.
    """
    user_service = get_user_service(session)
    success = await user_service.verify_email(verify_data.token)

    if success:
        return ApiResponse.success_response(
            data={"email_verified": True},
            message="Email verified successfully. Your account is now active.",
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )


@router.post("/resend-verification", response_model=ApiResponse[dict])
async def resend_verification_email(
    resend_data: ResendVerificationRequest,
    session: AsyncSession = Depends(get_async_session),
    _: None = Depends(rate_limit_check),
):
    """
    Resend email verification instructions.

    Sends a new verification email to the specified email address.
    Rate limited to prevent abuse.
    """
    user_service = get_user_service(session)
    await user_service.resend_verification_email(resend_data.email)

    return ApiResponse.success_response(
        data={"email_sent": True},
        message="If the email exists, you will receive verification instructions.",
    )


# ===== Password Reset Endpoints =====


@router.post("/password/reset-request", response_model=ApiResponse[dict])
async def request_password_reset(
    email_data: ForgotPasswordRequest,
    session: AsyncSession = Depends(get_async_session),
    _: None = Depends(rate_limit_check),
):
    """
    Request password reset email.

    Sends password reset instructions to user's email if the account exists.
    Always returns success for security (doesn't reveal if email exists).
    """
    user_service = get_user_service(session)
    await user_service.request_password_reset(email_data)

    return ApiResponse.success_response(
        data={"email_sent": True},
        message="If the email exists, you will receive password reset instructions.",
    )


@router.post("/password/reset-confirm", response_model=ApiResponse[dict])
async def reset_user_password(
    reset_data: ResetPasswordRequest,
    session: AsyncSession = Depends(get_async_session),
    _: None = Depends(rate_limit_check),
):
    """
    Reset password using reset token.

    Validates reset token, enforces password strength requirements,
    and revokes all existing sessions for security.
    """
    user_service = get_user_service(session)
    success = await user_service.reset_password(reset_data)

    if success:
        return ApiResponse.success_response(
            data={"password_reset": True},
            message="Password reset successfully. Please log in with your new password.",
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset password",
        )
