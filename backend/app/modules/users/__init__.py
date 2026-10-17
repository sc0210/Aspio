"""
Users module for Aspiro FastAPI backend.

This module provides comprehensive user management functionality including
authentication, authorization, profile management, and security features.
"""

from .models import (
    User, RefreshToken, UserSession, OAuthProvider,
    EmailVerificationToken, UserStatus, UserRole, PreferredLanguage,
    PreferredCurrency
)
from .schemas import (
    UserCreate, UserUpdate, UserResponse, UserProfileResponse,
    LoginRequest, LoginResponse, TokenRefreshRequest, TokenRefreshResponse,
    ChangePasswordRequest, ForgotPasswordRequest, ResetPasswordRequest,
    GoogleOAuthRequest, GoogleOAuthResponse, UserStatsResponse
)
from .services import UserService, get_user_service
from .repositories import (
    UserRepository, RefreshTokenRepository, EmailVerificationRepository,
    get_user_repository, get_refresh_token_repository, get_email_verification_repository
)
from .dependencies import (
    get_current_user_from_token, get_current_active_user, get_current_verified_user,
    get_current_premium_user, get_current_admin_user, get_current_moderator_user,
    CurrentUser, CurrentVerifiedUser, CurrentPremiumUser, CurrentAdminUser,
    CurrentModeratorUser, OptionalCurrentUser, ClientIP, UserAgent
)
from .security import (
    SecurityUtils, JWTManager, GoogleOAuthManager, PasswordValidator,
    AccountSecurity, DataEncryption, security_utils, jwt_manager,
    google_oauth, password_validator, account_security, data_encryption
)
from .router_simple import router

__all__ = [
    # Models
    "User", "RefreshToken", "UserSession", "OAuthProvider",
    "EmailVerificationToken", "UserStatus", "UserRole", "PreferredLanguage",
    "PreferredCurrency",
    
    # Schemas
    "UserCreate", "UserUpdate", "UserResponse", "UserProfileResponse",
    "LoginRequest", "LoginResponse", "TokenRefreshRequest", "TokenRefreshResponse",
    "ChangePasswordRequest", "ForgotPasswordRequest", "ResetPasswordRequest",
    "GoogleOAuthRequest", "GoogleOAuthResponse", "UserStatsResponse",
    
    # Services
    "UserService", "get_user_service",
    
    # Repositories
    "UserRepository", "RefreshTokenRepository", "EmailVerificationRepository",
    "get_user_repository", "get_refresh_token_repository", "get_email_verification_repository",
    
    # Dependencies
    "get_current_user_from_token", "get_current_active_user", "get_current_verified_user",
    "get_current_premium_user", "get_current_admin_user", "get_current_moderator_user",
    "CurrentUser", "CurrentVerifiedUser", "CurrentPremiumUser", "CurrentAdminUser",
    "CurrentModeratorUser", "OptionalCurrentUser", "ClientIP", "UserAgent",
    
    # Security
    "SecurityUtils", "JWTManager", "GoogleOAuthManager", "PasswordValidator",
    "AccountSecurity", "DataEncryption", "security_utils", "jwt_manager",
    "google_oauth", "password_validator", "account_security", "data_encryption",
    
    # Router
    "router"
]