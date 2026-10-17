"""
User service layer for business logic.

This module contains the business logic for user management, authentication,
and profile operations with comprehensive error handling and validation.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, Tuple
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from .models import User, UserStatus
from .schemas import (
    UserRegistration, UserUpdate, UserResponse, UserProfileResponse,
    LoginRequest, LoginResponse, TokenRefreshRequest, TokenRefreshResponse,
    ForgotPasswordRequest, ResetPasswordRequest,
    GoogleOAuthRequest, GoogleOAuthResponse, GoogleCallbackRequest, GoogleCallbackResponse,
    UserStatsResponse
)
from .repositories import (
    get_user_repository, get_refresh_token_repository, get_email_verification_repository
)
from .security import (
    security_utils, jwt_manager, google_oauth, password_validator
)
from .gamification_service import GamificationService, compute_login_streak
from .gamification_repository import level_for_experience
from ...core.config import get_settings
from ...core.email_service import get_email_service

settings = get_settings()
logger = logging.getLogger(__name__)


class UserService:
    """Service for user management operations"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
        self.user_repo = get_user_repository(session)
        self.refresh_token_repo = get_refresh_token_repository(session)
        self.email_verification_repo = get_email_verification_repository(session)
    
    async def register_user(
        self, 
        user_data: UserRegistration,
        ip_address: Optional[str] = None
    ) -> Tuple[UserResponse, bool]:
        """
        Register a new user with comprehensive validation.
        
        Args:
            user_data: User registration data
            ip_address: Optional IP address for tracking
            
        Returns:
            Tuple of (user response, email verification required)
            
        Raises:
            HTTPException: If registration fails
        """
        try:
            # Check if email already exists
            existing_user = await self.user_repo.get_user_by_email(user_data.email)
            if existing_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email address already registered"
                )
            
            # Validate password strength
            password_validation = password_validator.validate_password_strength(
                user_data.password
            )
            if not password_validation["is_valid"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Password requirements not met: {', '.join(password_validation['feedback'])}"
                )
            
            # Handle referral code if provided
            referred_by_user_id = None
            if user_data.referral_code:
                referring_user = await self.user_repo.get_user_by_referral_code(user_data.referral_code)
                if referring_user:
                    referred_by_user_id = referring_user.id
                    logger.info(f"New user referred by: {referring_user.email}")
            
            # Prepare user data for creation
            create_data = user_data.model_dump(exclude={'password', 'confirm_password', 'referral_code', 'terms_accepted'})
            create_data.update({
                'password': user_data.password,
                'referred_by_user_id': referred_by_user_id,
                'status': UserStatus.PENDING_APPROVAL,  # Require admin approval
            })
            
            # Create user
            user = await self.user_repo.create_user(create_data)

            # Skip email verification for pending approval users
            # They will be activated when admin approves them
            email_verification_required = False

            # Note: Experience points and referral bonuses will be awarded upon approval
            # to prevent spam registrations from gaining benefits

            logger.info(f"Successfully registered user (pending approval): {user.email}")

            return UserResponse.model_validate(user), email_verification_required
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error registering user: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to register user"
            )
    
    async def authenticate_user(
        self, 
        login_data: LoginRequest,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> LoginResponse:
        """
        Authenticate user and create session tokens.
        
        Args:
            login_data: Login credentials
            ip_address: Optional IP address
            user_agent: Optional user agent string
            
        Returns:
            Login response with tokens and user data
            
        Raises:
            HTTPException: If authentication fails
        """
        try:
            # Get user by email
            user = await self.user_repo.get_user_by_email(login_data.email)
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password"
                )
            
            # Check if account is locked
            if user.is_account_locked:
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail=f"Account is locked until {user.account_locked_until.isoformat()}"
                )
            
            # Check if account is pending approval
            if user.status == UserStatus.PENDING_APPROVAL:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your account is pending admin approval. Please wait for an administrator to approve your registration."
                )

            # Check if account is active
            if not user.is_active or user.status == UserStatus.SUSPENDED:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Account is suspended or deactivated"
                )
            
            # Verify password
            if not user.hashed_password or not security_utils.verify_password(
                login_data.password, user.hashed_password
            ):
                # Update failed login attempts
                await self.user_repo.update_login_info(user.id, ip_address or "", success=False)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password"
                )
            
            # Update successful login info
            await self.user_repo.update_login_info(user.id, ip_address or "", success=True)
            
            # Create JWT tokens
            token_data = {"sub": str(user.id), "email": user.email}
            
            access_token = jwt_manager.create_access_token(token_data)
            
            # Create refresh token with longer expiration if "remember me"
            refresh_expires = timedelta(days=30) if login_data.remember_me else timedelta(days=7)
            refresh_token = jwt_manager.create_refresh_token(token_data, refresh_expires)
            
            # Store refresh token in database
            await self.refresh_token_repo.create_refresh_token(
                user_id=user.id,
                token=refresh_token,
                expires_at=datetime.now(timezone.utc) + refresh_expires,
                ip_address=ip_address
            )
            
            # Update user streak and activity
            await self._update_user_activity(user.id)
            
            logger.info(f"Successful login for user: {user.email}")
            
            return LoginResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="bearer",
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                user=UserResponse.model_validate(user)
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error authenticating user: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication failed"
            )
    
    async def refresh_token(self, token_data: TokenRefreshRequest) -> TokenRefreshResponse:
        """
        Refresh JWT access token using refresh token.
        
        Args:
            token_data: Refresh token request
            
        Returns:
            New access and refresh tokens
            
        Raises:
            HTTPException: If refresh fails
        """
        try:
            # Verify refresh token format
            payload = jwt_manager.verify_token(token_data.refresh_token, "refresh")
            if not payload:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid refresh token"
                )
            
            # Get refresh token from database
            stored_token = await self.refresh_token_repo.get_refresh_token(token_data.refresh_token)
            if not stored_token or not stored_token.is_active or stored_token.is_expired:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Refresh token is expired or revoked"
                )
            
            # Get user
            user = await self.user_repo.get_user_by_id(stored_token.user_id)
            if not user or not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User account is not active"
                )
            
            # Create new tokens
            token_payload = {"sub": str(user.id), "email": user.email}
            
            new_access_token = jwt_manager.create_access_token(token_payload)
            new_refresh_token = jwt_manager.create_refresh_token(token_payload)
            
            # Revoke old refresh token and create new one
            await self.refresh_token_repo.revoke_refresh_token(token_data.refresh_token)
            await self.refresh_token_repo.create_refresh_token(
                user_id=user.id,
                token=new_refresh_token,
                expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
                user_agent=stored_token.user_agent,
                ip_address=stored_token.ip_address
            )

            # A user with a live session refreshes their 30-minute access token
            # long before they ever re-enter credentials, so this — not the login
            # endpoint — is where a daily visit usually gets noticed. No-ops if
            # today has already been counted.
            await self._record_daily_visit(user, touch_last_login=False)

            return TokenRefreshResponse(
                access_token=new_access_token,
                refresh_token=new_refresh_token,
                token_type="bearer",
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error refreshing token: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Token refresh failed"
            )
    
    async def logout_user(
        self, 
        user_id: UUID,
        refresh_token: Optional[str] = None,
        logout_all_devices: bool = False
    ) -> bool:
        """
        Logout user by revoking tokens.
        
        Args:
            user_id: User's UUID
            refresh_token: Optional specific refresh token to revoke
            logout_all_devices: Whether to logout from all devices
            
        Returns:
            True if logout was successful
        """
        try:
            if logout_all_devices:
                # Revoke all refresh tokens for user
                await self.refresh_token_repo.revoke_user_tokens(user_id)
                logger.info(f"Logged out user {user_id} from all devices")
            elif refresh_token:
                # Revoke specific refresh token
                await self.refresh_token_repo.revoke_refresh_token(refresh_token)
                logger.info(f"Logged out user {user_id} from current device")
            
            return True
            
        except Exception as e:
            logger.error(f"Error logging out user {user_id}: {str(e)}")
            return False
    
    async def get_user_profile(self, user_id: UUID) -> UserProfileResponse:
        """
        Get detailed user profile information.
        
        Args:
            user_id: User's UUID
            
        Returns:
            Detailed user profile
            
        Raises:
            HTTPException: If user not found
        """
        user = await self.user_repo.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        return UserProfileResponse.model_validate(user)
    
    async def update_user_profile(
        self, 
        user_id: UUID, 
        update_data: UserUpdate
    ) -> UserProfileResponse:
        """
        Update user profile information.
        
        Args:
            user_id: User's UUID
            update_data: Profile update data
            
        Returns:
            Updated user profile
            
        Raises:
            HTTPException: If update fails
        """
        try:
            # Prepare update data
            update_dict = update_data.model_dump(exclude_unset=True)
            
            # Update user
            updated_user = await self.user_repo.update_user(user_id, update_dict)
            if not updated_user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found"
                )
            
            logger.info(f"Updated profile for user: {user_id}")
            
            return UserProfileResponse.model_validate(updated_user)
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating user profile {user_id}: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update profile"
            )
    
    async def request_password_reset(self, email_data: ForgotPasswordRequest) -> bool:
        """
        Request password reset by sending reset email.
        
        Args:
            email_data: Email for password reset
            
        Returns:
            True if reset email was sent (or would be sent)
        """
        try:
            # Always return True for security (don't reveal if email exists)
            user = await self.user_repo.get_user_by_email(email_data.email)
            if user and user.is_active:
                # Create password reset token
                reset_token = security_utils.generate_secure_token(32)
                expires_at = datetime.now(timezone.utc) + timedelta(hours=1)  # 1 hour expiry
                
                await self.email_verification_repo.create_verification_token(
                    user_id=user.id,
                    token=reset_token,
                    token_type="password_reset",
                    expires_at=expires_at
                )
                
                # Send password reset email (would be implemented with email service)
                await self._send_password_reset_email(user, reset_token)
                
                logger.info(f"Password reset requested for user: {user.email}")
            
            return True
            
        except Exception as e:
            logger.error(f"Error requesting password reset: {str(e)}")
            return True  # Still return True for security
    
    async def reset_password(self, reset_data: ResetPasswordRequest) -> bool:
        """
        Reset password using reset token.
        
        Args:
            reset_data: Password reset data with token
            
        Returns:
            True if password was reset successfully
            
        Raises:
            HTTPException: If reset fails
        """
        try:
            # Get and validate reset token
            verification_token = await self.email_verification_repo.get_verification_token(
                reset_data.token, "password_reset"
            )
            
            if not verification_token or verification_token.is_used or verification_token.is_expired:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid or expired reset token"
                )
            
            # Validate new password strength
            password_validation = password_validator.validate_password_strength(
                reset_data.new_password
            )
            if not password_validation["is_valid"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Password requirements not met: {', '.join(password_validation['feedback'])}"
                )
            
            # Update password
            success = await self.user_repo.update_user_password(
                verification_token.user_id, reset_data.new_password
            )
            
            if success:
                # Mark token as used
                await self.email_verification_repo.use_verification_token(verification_token.id)
                
                # Revoke all refresh tokens
                await self.refresh_token_repo.revoke_user_tokens(verification_token.user_id)
                
                logger.info(f"Password reset for user: {verification_token.user_id}")
            
            return success
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error resetting password: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to reset password"
            )
    
    async def google_oauth_login(
        self,
        oauth_data: GoogleOAuthRequest,
        ip_address: Optional[str] = None
    ) -> GoogleOAuthResponse:
        """
        Authenticate or register user via Google OAuth.
        
        Args:
            oauth_data: Google OAuth authorization data
            ip_address: Optional IP address
            
        Returns:
            OAuth login response with tokens and user data
            
        Raises:
            HTTPException: If OAuth authentication fails
        """
        try:
            if not settings.google_oauth_enabled:
                raise HTTPException(
                    status_code=status.HTTP_501_NOT_IMPLEMENTED,
                    detail="Google OAuth is not configured"
                )
            
            # Exchange authorization code for tokens
            token_response = await google_oauth.exchange_code_for_tokens(
                oauth_data.authorization_code, oauth_data.redirect_uri
            )
            
            if not token_response:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to exchange authorization code"
                )
            
            # Get user info from Google
            user_info = await google_oauth.get_user_info(token_response["access_token"])
            if not user_info:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to get user information from Google"
                )
            
            # Check if user exists
            user = await self.user_repo.get_user_by_email(user_info["email"])
            is_new_user = False
            
            if not user:
                # Create new user from Google data
                user_data = {
                    'email': user_info["email"],
                    'name': user_info.get("name", user_info["email"].split('@')[0]),
                    'is_verified': True,  # Google email is pre-verified
                    'status': UserStatus.ACTIVE,
                    'google_id': user_info.get("id"),
                    'avatar_url': user_info.get("picture")
                }
                
                user = await self.user_repo.create_user(user_data)
                is_new_user = True
                
                # Award registration bonus
                await self._award_experience_points(user.id, 100, "oauth_registration")
                
                logger.info(f"Created new user via Google OAuth: {user.email}")
            
            else:
                # Update login info for existing user
                await self.user_repo.update_login_info(user.id, ip_address or "", success=True)
                await self._update_user_activity(user.id)
            
            # Create JWT tokens
            token_data = {"sub": str(user.id), "email": user.email}
            access_token = jwt_manager.create_access_token(token_data)
            refresh_token = jwt_manager.create_refresh_token(token_data)
            
            # Store refresh token
            await self.refresh_token_repo.create_refresh_token(
                user_id=user.id,
                token=refresh_token,
                expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
                ip_address=ip_address
            )
            
            return GoogleOAuthResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="bearer",
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                user=UserResponse.model_validate(user),
                is_new_user=is_new_user
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error with Google OAuth: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="OAuth authentication failed"
            )
    
    async def google_oauth_callback(
        self,
        callback_data: 'GoogleCallbackRequest',
        ip_address: Optional[str] = None
    ) -> 'GoogleCallbackResponse':
        """
        Handle Google OAuth callback from NextAuth.
        
        Args:
            callback_data: Google OAuth callback data from NextAuth
            ip_address: Optional IP address
            
        Returns:
            Callback response with tokens and user data
            
        Raises:
            HTTPException: If callback processing fails
        """
        try:
            # Check if user exists by email or Google ID
            user = await self.user_repo.get_user_by_email(callback_data.email)
            is_new_user = False

            if not user:
                # Create new user from Google data — pending approval required
                user_data = {
                    'email': callback_data.email,
                    'name': callback_data.name or callback_data.email.split('@')[0],
                    'google_id': callback_data.id,
                    'is_verified': callback_data.verified_email,
                    'status': UserStatus.PENDING_APPROVAL,  # Must be approved by admin
                    'is_active': False,
                    'email_verified_at': datetime.now(timezone.utc) if callback_data.verified_email else None,
                    'avatar_url': callback_data.picture
                }

                user = await self.user_repo.create_user(user_data)
                is_new_user = True

                logger.info(f"Created new Google OAuth user (pending approval): {user.email}")

                # Return 403 so NextAuth rejects the sign-in
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your account has been registered and is pending admin approval. Please wait for an administrator to approve your account before logging in."
                )

            # Existing user — check approval status before issuing tokens
            if user.status == UserStatus.PENDING_APPROVAL:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your account is pending admin approval. Please wait for an administrator to approve your registration."
                )

            if not user.is_active or user.status == UserStatus.SUSPENDED:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Account is suspended or deactivated."
                )

            # Update existing user's Google ID if not set
            if not user.google_id:
                await self.user_repo.update_user(user.id, {"google_id": callback_data.id})

            # Update login info
            await self.user_repo.update_login_info(user.id, ip_address or "", success=True)
            await self._update_user_activity(user.id)

            # Create JWT tokens
            token_data = {"sub": str(user.id), "email": user.email}
            access_token = jwt_manager.create_access_token(token_data)
            refresh_token = jwt_manager.create_refresh_token(token_data)

            # Store refresh token
            await self.refresh_token_repo.create_refresh_token(
                user_id=user.id,
                token=refresh_token,
                expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
                ip_address=ip_address
            )

            from .schemas import UserResponse, GoogleCallbackResponse

            return GoogleCallbackResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="bearer",
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                user=UserResponse.model_validate(user),
                is_new_user=is_new_user
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error with Google OAuth callback: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="OAuth callback processing failed"
            )
    
    async def verify_email(self, token: str) -> bool:
        """
        Verify user email using verification token.
        
        Args:
            token: Email verification token
            
        Returns:
            True if email was verified successfully
            
        Raises:
            HTTPException: If verification fails
        """
        try:
            # Get verification token
            verification_token = await self.email_verification_repo.get_verification_token(
                token, "email_verification"
            )
            
            if not verification_token or verification_token.is_used or verification_token.is_expired:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid or expired verification token"
                )
            
            # Verify user email
            success = await self.user_repo.verify_user_email(verification_token.user_id)
            
            if success:
                # Mark token as used
                await self.email_verification_repo.use_verification_token(verification_token.id)
                
                # Award email verification bonus
                await self._award_experience_points(
                    verification_token.user_id, 50, "email_verification"
                )
                
                logger.info(f"Email verified for user: {verification_token.user_id}")
            
            return success
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error verifying email: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Email verification failed"
            )
    
    async def get_user_statistics(self) -> UserStatsResponse:
        """
        Get comprehensive user statistics.
        
        Returns:
            User statistics response
        """
        stats = await self.user_repo.get_user_statistics()
        return UserStatsResponse(**stats)
    
    async def resend_verification_email(self, email: str) -> bool:
        """
        Resend email verification to user.
        
        Args:
            email: User's email address
            
        Returns:
            True if email was sent (or would be sent)
        """
        try:
            # Always return True for security (don't reveal if email exists)
            user = await self.user_repo.get_user_by_email(email)
            if user and not user.is_verified and user.is_active:
                # Send verification email
                await self._send_email_verification(user)
                logger.info(f"Resent verification email to: {email}")
            
            return True
            
        except Exception as e:
            logger.error(f"Error resending verification email: {str(e)}")
            return True  # Still return True for security
    
    # Private helper methods
    
    async def _send_email_verification(self, user: User) -> bool:
        """Send email verification token to user"""
        try:
            await self._cleanup_old_verification_tokens(user.id, "email_verification")

            verification_token = security_utils.generate_secure_token(32)
            expires_at = datetime.now(timezone.utc) + timedelta(hours=24)

            await self.email_verification_repo.create_verification_token(
                user_id=user.id,
                token=verification_token,
                token_type="email_verification",
                expires_at=expires_at,
            )

            await get_email_service().send_verification_email(user.email, verification_token)
            logger.info("Verification email dispatched for user: %s", user.email)
            return True

        except Exception as e:
            logger.error("Error sending email verification: %s", e)
            return False
    
    async def _cleanup_old_verification_tokens(
        self,
        user_id: UUID,
        token_type: str,
    ) -> None:
        """Delete used or expired verification tokens of the given type for a user."""
        try:
            await self.email_verification_repo.delete_expired_by_user(user_id, token_type)
        except Exception as e:
            logger.error("Error cleaning up old tokens: %s", e)
    
    async def _send_password_reset_email(self, user: User, reset_token: str) -> bool:
        """Send password reset email to user"""
        try:
            await self._cleanup_old_verification_tokens(user.id, "password_reset")
            await get_email_service().send_password_reset_email(user.email, reset_token)
            logger.info("Password reset email dispatched for user: %s", user.email)
            return True

        except Exception as e:
            logger.error("Error sending password reset email: %s", e)
            return False
    
    async def _award_experience_points(
        self, 
        user_id: UUID, 
        points: int, 
        reason: str
    ) -> None:
        """Award experience points to user"""
        try:
            user = await self.user_repo.get_user_by_id(user_id)
            if user:
                new_points = user.experience_points + points
                new_level = level_for_experience(new_points)

                await self.user_repo.update_user(user_id, {
                    'experience_points': new_points,
                    'level': new_level
                })
                
                logger.info(f"Awarded {points} XP to user {user_id} for {reason}")
                
        except Exception as e:
            logger.error(f"Error awarding experience points: {str(e)}")
    
    async def _update_user_activity(self, user_id: UUID) -> None:
        """Record a fresh login: timestamp, login streak and the daily XP award."""
        try:
            user = await self.user_repo.get_user_by_id(user_id)
            if not user:
                return

            await self._record_daily_visit(user, touch_last_login=True)

        except Exception as e:
            logger.error(f"Error updating user activity: {str(e)}")

    async def _record_daily_visit(self, user: User, touch_last_login: bool) -> None:
        """Advance the login streak and daily XP if this is a new calendar day.

        The streak has to be maintained here rather than only in the
        ``/me/streak/update`` endpoint: that endpoint is pinged by the
        achievements page, so a user who shows up daily but never opens that
        page would never build a streak.

        Idempotent per calendar day — a second visit writes nothing, so XP can't
        be farmed by re-authenticating.

        Best-effort: gamification must never break authentication, so failures
        are logged and swallowed.
        """
        try:
            now = datetime.now(timezone.utc)
            new_streak, streak_advanced = compute_login_streak(
                user.last_streak_update, user.current_login_streak, now
            )

            updates: Dict[str, Any] = {}
            if touch_last_login:
                updates['last_login_at'] = now

            if streak_advanced:
                new_points = user.experience_points + 5
                updates['experience_points'] = new_points
                updates['level'] = level_for_experience(new_points)
                updates['current_login_streak'] = new_streak
                updates['longest_login_streak'] = max(
                    user.longest_login_streak, new_streak
                )
                updates['last_streak_update'] = now

            if not updates:
                return

            await self.user_repo.update_user(user.id, updates)

            if streak_advanced:
                # Award any streak badge the new count just unlocked.
                await GamificationService(self.session).trigger_achievement_check(
                    user.id, "login", {"new_streak": new_streak}
                )

        except Exception as e:
            logger.error(f"Error recording daily visit: {str(e)}")
    
# Service factory function
def get_user_service(session: AsyncSession) -> UserService:
    """Get user service instance"""
    return UserService(session)


# Export service
__all__ = ["UserService", "get_user_service"]