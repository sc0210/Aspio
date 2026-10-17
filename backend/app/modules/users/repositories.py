"""
User repository layer for database operations.

This module provides async database operations for user management,
including CRUD operations, authentication, and session management.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any, Tuple
from uuid import UUID
import logging

from sqlalchemy import select, update, delete, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from .models import (
    User, RefreshToken, EmailVerificationToken,
    UserStatus
)
from .security import security_utils
# NOTE: get_async_session was imported here but never used; removed dead import.

logger = logging.getLogger(__name__)


class UserRepository:
    """Repository for user database operations"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create_user(self, user_data: Dict[str, Any]) -> User:
        """
        Create a new user with secure password hashing.
        
        Args:
            user_data: Dictionary containing user data
            
        Returns:
            Created user instance
            
        Raises:
            IntegrityError: If email already exists
        """
        try:
            # Hash password if provided
            if 'password' in user_data:
                user_data['hashed_password'] = security_utils.hash_password(user_data.pop('password'))
            
            # Generate referral code
            user_data['referral_code'] = security_utils.generate_secure_token(8)
            
            user = User(**user_data)
            self.session.add(user)
            await self.session.commit()
            await self.session.refresh(user)
            
            logger.info(f"Created new user: {user.email}")
            return user
            
        except IntegrityError as e:
            await self.session.rollback()
            logger.warning(f"Failed to create user - email exists: {user_data.get('email')}")
            raise ValueError("Email address already registered")
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error creating user: {str(e)}")
            raise
    
    async def get_user_by_id(self, user_id: UUID, include_deleted: bool = False) -> Optional[User]:
        """
        Get user by ID with optional soft delete filtering.
        
        Args:
            user_id: User's UUID
            include_deleted: Whether to include soft-deleted users
            
        Returns:
            User instance or None if not found
        """
        try:
            query = select(User).where(User.id == user_id)
            
            if not include_deleted:
                query = query.where(User.deleted_at.is_(None))
            
            result = await self.session.execute(query)
            return result.scalar_one_or_none()
            
        except Exception as e:
            logger.error(f"Error getting user by ID {user_id}: {str(e)}")
            return None
    
    async def get_user_by_email(self, email: str, include_deleted: bool = False) -> Optional[User]:
        """
        Get user by email address.
        
        Args:
            email: User's email address
            include_deleted: Whether to include soft-deleted users
            
        Returns:
            User instance or None if not found
        """
        try:
            query = select(User).where(User.email == email.lower())
            
            if not include_deleted:
                query = query.where(User.deleted_at.is_(None))
            
            result = await self.session.execute(query)
            return result.scalar_one_or_none()
            
        except Exception as e:
            logger.error(f"Error getting user by email: {str(e)}")
            return None
    
    async def get_user_by_referral_code(self, referral_code: str) -> Optional[User]:
        """
        Get user by referral code.
        
        Args:
            referral_code: User's referral code
            
        Returns:
            User instance or None if not found
        """
        try:
            query = select(User).where(
                and_(
                    User.referral_code == referral_code,
                    User.deleted_at.is_(None),
                    User.is_active == True
                )
            )
            
            result = await self.session.execute(query)
            return result.scalar_one_or_none()
            
        except Exception as e:
            logger.error(f"Error getting user by referral code {referral_code}: {str(e)}")
            return None
    
    async def update_user(self, user_id: UUID, user_data: Dict[str, Any]) -> Optional[User]:
        """
        Update user information.
        
        Args:
            user_id: User's UUID
            user_data: Dictionary containing fields to update
            
        Returns:
            Updated user instance or None if not found
        """
        try:
            # Remove sensitive fields that shouldn't be updated directly
            sensitive_fields = {'id', 'hashed_password', 'created_at', 'email'}
            user_data = {k: v for k, v in user_data.items() if k not in sensitive_fields}
            
            if not user_data:
                return await self.get_user_by_id(user_id)

            query = (
                update(User)
                .where(and_(User.id == user_id, User.deleted_at.is_(None)))
                .values(**user_data, updated_at=datetime.now(timezone.utc))
            )

            result = await self.session.execute(query)
            await self.session.commit()

            if result.rowcount == 0:
                return None

            logger.info(f"Updated user: {user_id}")
            # Re-fetch via identity map so the returned object is fully tracked
            # and has up-to-date column values (avoids stale data from .returning()).
            return await self.get_user_by_id(user_id)
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error updating user {user_id}: {str(e)}")
            return None
    
    async def update_user_password(self, user_id: UUID, new_password: str) -> bool:
        """
        Update user password with secure hashing.
        
        Args:
            user_id: User's UUID
            new_password: New plain text password
            
        Returns:
            True if password was updated successfully
        """
        try:
            hashed_password = security_utils.hash_password(new_password)
            
            query = (
                update(User)
                .where(and_(User.id == user_id, User.deleted_at.is_(None)))
                .values(
                    hashed_password=hashed_password,
                    updated_at=datetime.now(timezone.utc),
                    failed_login_attempts=0,  # Reset failed attempts
                    account_locked_until=None  # Unlock account
                )
            )
            
            result = await self.session.execute(query)
            await self.session.commit()
            
            success = result.rowcount > 0
            if success:
                logger.info(f"Updated password for user: {user_id}")
            
            return success
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error updating password for user {user_id}: {str(e)}")
            return False
    
    async def verify_user_email(self, user_id: UUID) -> bool:
        """
        Mark user's email as verified.
        
        Args:
            user_id: User's UUID
            
        Returns:
            True if email was verified successfully
        """
        try:
            query = (
                update(User)
                .where(and_(User.id == user_id, User.deleted_at.is_(None)))
                .values(
                    is_verified=True,
                    email_verified_at=datetime.now(timezone.utc),
                    status=UserStatus.ACTIVE,
                    updated_at=datetime.now(timezone.utc)
                )
            )
            
            result = await self.session.execute(query)
            await self.session.commit()
            
            success = result.rowcount > 0
            if success:
                logger.info(f"Verified email for user: {user_id}")
            
            return success
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error verifying email for user {user_id}: {str(e)}")
            return False
    
    async def update_login_info(
        self, 
        user_id: UUID, 
        ip_address: str,
        success: bool = True
    ) -> bool:
        """
        Update user login information and handle failed attempts.
        
        Args:
            user_id: User's UUID
            ip_address: IP address of login attempt
            success: Whether login was successful
            
        Returns:
            True if update was successful
        """
        try:
            if success:
                # Successful login - reset failed attempts and update last login
                update_data = {
                    'last_login_at': datetime.now(timezone.utc),
                    'last_login_ip': ip_address,
                    'failed_login_attempts': 0,
                    'account_locked_until': None,
                    'updated_at': datetime.now(timezone.utc)
                }
            else:
                # Failed login - increment failed attempts
                user = await self.get_user_by_id(user_id)
                if not user:
                    return False
                
                failed_attempts = user.failed_login_attempts + 1
                update_data = {
                    'failed_login_attempts': failed_attempts,
                    'updated_at': datetime.now(timezone.utc)
                }
                
                # Lock account if too many failed attempts
                from .security import account_security
                if account_security.should_lock_account(failed_attempts):
                    lockout_duration = account_security.calculate_lockout_duration(failed_attempts)
                    update_data['account_locked_until'] = datetime.now(timezone.utc) + lockout_duration
                    logger.warning(f"Locked user account {user_id} due to {failed_attempts} failed attempts")
            
            query = (
                update(User)
                .where(and_(User.id == user_id, User.deleted_at.is_(None)))
                .values(**update_data)
            )
            
            result = await self.session.execute(query)
            await self.session.commit()
            
            return result.rowcount > 0
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error updating login info for user {user_id}: {str(e)}")
            return False
    
    async def list_users(
        self,
        page: int = 1,
        limit: int = 20,
        filters: Optional[Dict[str, Any]] = None,
        include_deleted: bool = False
    ) -> Tuple[List[User], int]:
        """
        List users with pagination and filtering.
        
        Args:
            page: Page number (1-based)
            limit: Number of users per page
            filters: Optional filters dictionary
            include_deleted: Whether to include soft-deleted users
            
        Returns:
            Tuple of (users list, total count)
        """
        try:
            # Base query
            query = select(User)
            count_query = select(func.count(User.id))
            
            # Apply filters
            conditions = []
            
            if not include_deleted:
                conditions.append(User.deleted_at.is_(None))
            
            if filters:
                if 'status' in filters:
                    conditions.append(User.status == filters['status'])
                
                if 'role' in filters:
                    conditions.append(User.role == filters['role'])
                
                if 'is_verified' in filters:
                    conditions.append(User.is_verified == filters['is_verified'])
                
                if 'is_active' in filters:
                    conditions.append(User.is_active == filters['is_active'])
                
                # Add other filters as needed based on User model fields
                
                if 'created_after' in filters:
                    conditions.append(User.created_at >= filters['created_after'])
                
                if 'created_before' in filters:
                    conditions.append(User.created_at <= filters['created_before'])
                
                if 'search' in filters and filters['search']:
                    search_term = f"%{filters['search']}%"
                    conditions.append(
                        or_(
                            User.email.ilike(search_term),
                            User.name.ilike(search_term)
                        )
                    )
            
            # Apply conditions
            if conditions:
                query = query.where(and_(*conditions))
                count_query = count_query.where(and_(*conditions))
            
            # Get total count
            count_result = await self.session.execute(count_query)
            total = count_result.scalar()
            
            # Apply pagination and ordering
            offset = (page - 1) * limit
            query = query.order_by(User.created_at.desc()).offset(offset).limit(limit)
            
            # Execute query
            result = await self.session.execute(query)
            users = result.scalars().all()
            
            return list(users), total
            
        except Exception as e:
            logger.error(f"Error listing users: {str(e)}")
            return [], 0
    
    async def get_user_statistics(self) -> Dict[str, Any]:
        """
        Get user statistics for analytics.
        
        Returns:
            Dictionary containing user statistics
        """
        try:
            # Base counts
            total_users_query = select(func.count(User.id)).where(User.deleted_at.is_(None))
            active_users_query = select(func.count(User.id)).where(
                and_(User.deleted_at.is_(None), User.is_active == True)
            )
            verified_users_query = select(func.count(User.id)).where(
                and_(User.deleted_at.is_(None), User.is_verified == True)
            )
            
            # Time-based counts
            today = datetime.now(timezone.utc).date()
            week_ago = today - timedelta(days=7)
            month_ago = today - timedelta(days=30)
            
            new_today_query = select(func.count(User.id)).where(
                and_(
                    User.deleted_at.is_(None),
                    func.date(User.created_at) == today
                )
            )
            
            new_week_query = select(func.count(User.id)).where(
                and_(
                    User.deleted_at.is_(None),
                    func.date(User.created_at) >= week_ago
                )
            )
            
            new_month_query = select(func.count(User.id)).where(
                and_(
                    User.deleted_at.is_(None),
                    func.date(User.created_at) >= month_ago
                )
            )
            
            # Execute count queries
            total_users = (await self.session.execute(total_users_query)).scalar()
            active_users = (await self.session.execute(active_users_query)).scalar()
            verified_users = (await self.session.execute(verified_users_query)).scalar()
            new_today = (await self.session.execute(new_today_query)).scalar()
            new_week = (await self.session.execute(new_week_query)).scalar()
            new_month = (await self.session.execute(new_month_query)).scalar()
            
            # Skip advanced statistics for now - can be added based on actual User model fields
            users_by_country = {}
            users_by_currency = {}
            
            # Level and experience statistics
            level_query = select(
                func.avg(User.level).label('avg_level'),
                func.sum(User.experience_points).label('total_exp')
            ).where(User.deleted_at.is_(None))
            
            level_result = await self.session.execute(level_query)
            level_stats = level_result.first()
            
            return {
                'total_users': total_users,
                'active_users': active_users,
                'verified_users': verified_users,
                'new_users_today': new_today,
                'new_users_this_week': new_week,
                'new_users_this_month': new_month,
                'users_by_country': users_by_country,
                'users_by_currency': users_by_currency,
                'average_level': float(level_stats.avg_level or 0),
                'total_experience_points': int(level_stats.total_exp or 0)
            }
            
        except Exception as e:
            logger.error(f"Error getting user statistics: {str(e)}")
            return {}


class RefreshTokenRepository:
    """Repository for refresh token operations"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create_refresh_token(
        self,
        user_id: UUID,
        token: str,
        expires_at: datetime,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> RefreshToken:
        """
        Create a new refresh token.
        
        Args:
            user_id: User's UUID
            token: Refresh token string
            expires_at: Token expiration datetime
            device_info: Optional device information
            ip_address: Optional IP address
            
        Returns:
            Created refresh token instance
        """
        try:
            token_hash = security_utils.hash_token(token)

            refresh_token = RefreshToken(
                user_id=user_id,
                token_hash=token_hash,
                expires_at=expires_at,
                ip_address=ip_address,
                user_agent=user_agent
            )

            self.session.add(refresh_token)
            await self.session.commit()
            await self.session.refresh(refresh_token)

            return refresh_token

        except Exception as e:
            await self.session.rollback()
            # If the exact same token hash was already stored (race condition),
            # look up and return the existing record rather than raising.
            if isinstance(e, IntegrityError) and "token_hash" in str(e):
                existing = await self.session.execute(
                    select(RefreshToken).where(RefreshToken.token_hash == security_utils.hash_token(token))
                )
                existing_token = existing.scalar_one_or_none()
                if existing_token:
                    return existing_token
            logger.error(f"Error creating refresh token: {str(e)}")
            raise
    
    async def get_refresh_token(self, token: str) -> Optional[RefreshToken]:
        """
        Get refresh token by token string.
        
        Args:
            token: Refresh token string
            
        Returns:
            RefreshToken instance or None if not found
        """
        try:
            token_hash = security_utils.hash_token(token)
            
            query = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
            result = await self.session.execute(query)
            
            return result.scalar_one_or_none()
            
        except Exception as e:
            logger.error(f"Error getting refresh token: {str(e)}")
            return None
    
    async def revoke_refresh_token(self, token: str) -> bool:
        """
        Revoke a specific refresh token.
        
        Args:
            token: Refresh token string to revoke
            
        Returns:
            True if token was revoked successfully
        """
        try:
            token_hash = security_utils.hash_token(token)
            
            query = (
                update(RefreshToken)
                .where(RefreshToken.token_hash == token_hash)
                .values(is_active=False)
            )
            
            result = await self.session.execute(query)
            await self.session.commit()
            
            return result.rowcount > 0
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error revoking refresh token: {str(e)}")
            return False
    
    async def revoke_user_tokens(self, user_id: UUID, exclude_token: Optional[str] = None) -> bool:
        """
        Revoke all refresh tokens for a user.
        
        Args:
            user_id: User's UUID
            exclude_token: Optional token to exclude from revocation
            
        Returns:
            True if tokens were revoked successfully
        """
        try:
            conditions = [RefreshToken.user_id == user_id, RefreshToken.is_active == True]
            
            if exclude_token:
                exclude_hash = security_utils.hash_token(exclude_token)
                conditions.append(RefreshToken.token_hash != exclude_hash)
            
            query = (
                update(RefreshToken)
                .where(and_(*conditions))
                .values(is_active=False)
            )
            
            result = await self.session.execute(query)
            await self.session.commit()
            
            logger.info(f"Revoked {result.rowcount} refresh tokens for user {user_id}")
            return True
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error revoking user tokens: {str(e)}")
            return False
    
class EmailVerificationRepository:
    """Repository for email verification tokens"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create_verification_token(
        self,
        user_id: UUID,
        token: str,
        token_type: str,
        expires_at: datetime
    ) -> EmailVerificationToken:
        """
        Create an email verification token.
        
        Args:
            user_id: User's UUID
            email: Email address to verify
            token: Verification token string
            token_type: Type of token (email_verification, password_reset)
            expires_at: Token expiration datetime
            
        Returns:
            Created email verification token
        """
        try:
            token_hash = security_utils.hash_token(token)
            
            verification_token = EmailVerificationToken(
                user_id=user_id,
                token_hash=token_hash,
                expires_at=expires_at
            )
            
            self.session.add(verification_token)
            await self.session.commit()
            await self.session.refresh(verification_token)
            
            return verification_token
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error creating verification token: {str(e)}")
            raise
    
    async def get_verification_token(
        self, 
        token: str, 
        token_type: str = None
    ) -> Optional[EmailVerificationToken]:
        """
        Get verification token by token string and type.
        
        Args:
            token: Verification token string
            token_type: Token type
            
        Returns:
            EmailVerificationToken or None if not found
        """
        try:
            token_hash = security_utils.hash_token(token)
            
            query = select(EmailVerificationToken).where(
                EmailVerificationToken.token_hash == token_hash
            )
            result = await self.session.execute(query)
            
            return result.scalar_one_or_none()
            
        except Exception as e:
            logger.error(f"Error getting verification token: {str(e)}")
            return None
    
    async def use_verification_token(self, token_id: UUID) -> bool:
        """
        Mark verification token as used.
        
        Args:
            token_id: Token's UUID
            
        Returns:
            True if token was marked as used
        """
        try:
            query = (
                update(EmailVerificationToken)
                .where(EmailVerificationToken.id == token_id)
                .values(is_used=True)
            )
            
            result = await self.session.execute(query)
            await self.session.commit()
            
            return result.rowcount > 0
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error marking token as used: {str(e)}")
            return False

    async def delete_expired_by_user(self, user_id: UUID, token_type: str) -> int:
        """
        Delete all used or expired verification tokens of a given type for a user.
        Returns the number of rows deleted.
        """
        try:
            now = datetime.now(timezone.utc)
            stmt = (
                delete(EmailVerificationToken)
                .where(
                    and_(
                        EmailVerificationToken.user_id == user_id,
                        or_(
                            EmailVerificationToken.is_used == True,  # noqa: E712
                            EmailVerificationToken.expires_at < now,
                        ),
                    )
                )
            )
            result = await self.session.execute(stmt)
            await self.session.commit()
            count = result.rowcount
            if count:
                logger.debug("Deleted %d stale %s tokens for user %s", count, token_type, user_id)
            return count
        except Exception as e:
            await self.session.rollback()
            logger.error("Error cleaning up verification tokens: %s", e)
            return 0


# Repository factory functions
def get_user_repository(session: AsyncSession) -> UserRepository:
    """Get user repository instance"""
    return UserRepository(session)


def get_refresh_token_repository(session: AsyncSession) -> RefreshTokenRepository:
    """Get refresh token repository instance"""
    return RefreshTokenRepository(session)


def get_email_verification_repository(session: AsyncSession) -> EmailVerificationRepository:
    """Get email verification repository instance"""
    return EmailVerificationRepository(session)


# Export repositories
__all__ = [
    "UserRepository",
    "RefreshTokenRepository", 
    "EmailVerificationRepository",
    "get_user_repository",
    "get_refresh_token_repository",
    "get_email_verification_repository"
]