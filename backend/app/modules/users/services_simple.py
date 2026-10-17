"""
Simplified user service implementation for Aspiro FastAPI backend.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    User, UserStatus, UserRole, RefreshToken,
    PreferredCurrency, PreferredLanguage,
)
from .schemas import (
    UserCreate, UserRegistration, UserUpdate, UserResponse, 
    LoginRequest, LoginResponse, 
    TokenRefreshRequest, TokenRefreshResponse,
    GoogleOAuthRequest, GoogleOAuthResponse
)
from .repositories import UserRepository
from .security import security_utils, jwt_manager, google_oauth, password_validator
from ...core.config import get_settings

settings = get_settings()

logger = logging.getLogger(__name__)


class UserService:
    """Simplified user service for core functionality"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
        self.user_repo = UserRepository(session)
    
    async def register_user(
        self, 
        user_data: UserRegistration,
        ip_address: Optional[str] = None
    ) -> Tuple[UserResponse, bool]:
        """Register a new user"""
        try:
            # Check if email already exists
            existing_user = await self.user_repo.get_user_by_email(user_data.email)
            if existing_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email address already registered"
                )
            
            # Validate password strength
            password_validation = password_validator.validate_password_strength(user_data.password)
            if not password_validation["is_valid"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Password requirements not met: {', '.join(password_validation['feedback'])}"
                )
            
            # Create user data dict
            create_data = {
                'email': user_data.email.lower(),
                'name': user_data.name,
                'password': user_data.password,
                'avatar_url': user_data.avatar_url,
                'status': UserStatus.PENDING_APPROVAL,  # Require admin approval before login
                'role': UserRole.USER,
                'is_active': False,  # Not active until admin approves
                'is_verified': False
            }
            
            # Initialize preferences
            if user_data.preferences:
                create_data['preferences'] = user_data.preferences.model_dump()
            
            # Create user
            user = await self.user_repo.create_user(create_data)
            
            # Initialize user preferences if not set
            if not user.preferences:
                user.initialize_preferences()
                await self.session.commit()
                await self.session.refresh(user)
            
            user_response = UserResponse.model_validate(user)
            
            logger.info(f"User registered successfully: {user.email}")
            return user_response, True  # Email verification required
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error registering user: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Registration failed"
            )
    
    async def authenticate_user(
        self,
        login_data: LoginRequest,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> LoginResponse:
        """Authenticate user and create session"""
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
                    detail="Account is temporarily locked"
                )

            # Check if account is pending admin approval
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
            if not user.hashed_password or not security_utils.verify_password(login_data.password, user.hashed_password):
                # Update failed login attempts
                await self.user_repo.update_login_info(user.id, ip_address or "", success=False)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password"
                )
            
            # Update last login info for successful login
            await self.user_repo.update_login_info(user.id, ip_address or "", success=True)
            await self.session.refresh(user)
            
            # Create tokens
            token_data = {"sub": str(user.id), "email": user.email}
            access_token = jwt_manager.create_access_token(token_data)
            
            # Create refresh token with longer expiry for remember_me
            expires_delta = timedelta(days=30) if getattr(login_data, 'remember_me', False) else timedelta(days=7)
            refresh_token = jwt_manager.create_refresh_token(token_data, expires_delta)
            
            # Store refresh token (using RefreshTokenRepository)
            from .repositories import RefreshTokenRepository
            refresh_token_repo = RefreshTokenRepository(self.session)
            await refresh_token_repo.create_refresh_token(
                user_id=user.id,
                token=refresh_token,
                expires_at=datetime.now(timezone.utc) + expires_delta,
                user_agent=user_agent,
                ip_address=ip_address
            )
            
            user_response = UserResponse.model_validate(user)
            
            return LoginResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="bearer",
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                user=user_response
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
        """Refresh JWT tokens"""
        try:
            # Verify refresh token
            payload = jwt_manager.verify_token(token_data.refresh_token, "refresh")
            if not payload:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid refresh token"
                )
            
            user_id = UUID(payload.get("sub"))
            
            # Verify refresh token exists in database
            from .repositories import RefreshTokenRepository
            refresh_token_repo = RefreshTokenRepository(self.session)
            refresh_token_record = await refresh_token_repo.get_refresh_token(token_data.refresh_token)
            if not refresh_token_record or not refresh_token_record.is_active or refresh_token_record.is_expired:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Refresh token not found or invalid"
                )
            
            # Get user
            user = await self.user_repo.get_user_by_id(user_id)
            if not user or not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found or inactive"
                )
            
            # Create new tokens
            new_token_data = {"sub": str(user.id), "email": user.email}
            new_access_token = jwt_manager.create_access_token(new_token_data)
            new_refresh_token = jwt_manager.create_refresh_token(new_token_data)
            
            # Revoke old refresh token and create new one
            await refresh_token_repo.revoke_refresh_token(token_data.refresh_token)
            await refresh_token_repo.create_refresh_token(
                user_id=user.id,
                token=new_refresh_token,
                expires_at=datetime.now(timezone.utc) + timedelta(days=7)
            )
            
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
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token refresh failed"
            )
    
    async def logout_user(
        self, 
        user_id: UUID, 
        refresh_token: str, 
        logout_all_devices: bool = False
    ) -> bool:
        """Logout user by revoking tokens"""
        try:
            from .repositories import RefreshTokenRepository
            refresh_token_repo = RefreshTokenRepository(self.session)
            
            if logout_all_devices:
                # Revoke all refresh tokens for user
                await refresh_token_repo.revoke_user_tokens(user_id)
            else:
                # Revoke specific refresh token
                await refresh_token_repo.revoke_refresh_token(refresh_token)
            
            return True
            
        except Exception as e:
            logger.error(f"Error logging out user: {str(e)}")
            return False
    
    async def get_user_profile(self, user_id: UUID) -> UserResponse:
        """Get user profile by ID"""
        try:
            user = await self.user_repo.get_user_by_id(user_id)
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found"
                )
            
            return UserResponse.model_validate(user)
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting user profile: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get user profile"
            )
    
    async def update_user_profile(self, user_id: UUID, update_data: UserUpdate) -> UserResponse:
        """Update user profile"""
        try:
            # Convert update data to dict, excluding unset values
            update_dict = update_data.model_dump(exclude_unset=True)

            # Check username uniqueness if being changed
            if 'username' in update_dict and update_dict['username'] is not None:
                from sqlalchemy import select as _select, and_ as _and_
                stmt = _select(User.id).where(
                    _and_(
                        User.username == update_dict['username'],
                        User.id != user_id,
                    )
                )
                taken = (await self.user_repo.session.execute(stmt)).scalar_one_or_none()
                if taken:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Username already taken",
                    )

            # Convert monthly_income from dollars to cents if provided
            if 'monthly_income' in update_dict and update_dict['monthly_income'] is not None:
                update_dict['monthly_income'] = int(update_dict['monthly_income'] * 100)

            # update_user returns None when the row does not exist
            updated_user = await self.user_repo.update_user(user_id, update_dict)
            if not updated_user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found",
                )

            return UserResponse.model_validate(updated_user)

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating user profile: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update user profile"
            )

    async def update_user_data(self, user_id: UUID, update_data: dict) -> User:
        """Apply a raw dict of user fields and return the updated ORM user.

        Unlike update_user_profile (which takes the UserUpdate schema), this
        accepts an already-built dict so callers like the regional-preferences
        endpoint can set columns — preferred_currency / preferred_language /
        timezone — that aren't part of UserUpdate. Enum-backed columns are
        coerced from their string codes so the Core UPDATE binds a valid enum
        member instead of raising a LookupError.
        """
        try:
            data = dict(update_data)

            if isinstance(data.get("preferred_currency"), str):
                try:
                    data["preferred_currency"] = PreferredCurrency(data["preferred_currency"])
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Unsupported currency: {data['preferred_currency']}",
                    )
            if isinstance(data.get("preferred_language"), str):
                try:
                    data["preferred_language"] = PreferredLanguage(data["preferred_language"])
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Unsupported language: {data['preferred_language']}",
                    )

            updated_user = await self.user_repo.update_user(user_id, data)
            if not updated_user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found",
                )
            return updated_user

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating user data: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update user data",
            )


def get_user_service(session: AsyncSession) -> UserService:
    """Dependency to get user service instance"""
    return UserService(session)