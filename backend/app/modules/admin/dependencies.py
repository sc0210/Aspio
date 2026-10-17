"""
Admin authentication and authorization dependencies.

Provides middleware and dependencies for protecting admin endpoints.
"""

from typing import Optional
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.modules.users.dependencies import (
    get_current_active_user as get_current_user,
    get_optional_current_user
)
from app.modules.users.models import User
from app.core.exceptions import AuthorizationException
from .models import AdminUser, AdminPermission, AdminRole
from .repositories import AdminRepository


async def get_admin_repository(session: AsyncSession = Depends(get_db_session)) -> AdminRepository:
    """Get admin repository instance"""
    return AdminRepository(session)


async def get_current_admin(
    current_user: User = Depends(get_current_user),
    admin_repo: AdminRepository = Depends(get_admin_repository)
) -> AdminUser:
    """
    Get current admin user.

    Raises:
        HTTPException: If user is not an admin or admin account is suspended
    """
    admin = await admin_repo.get_by_user_id(current_user.id)

    if not admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )

    if not admin.is_active or admin.is_suspended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin account is suspended or inactive"
        )

    # Update last login
    await admin_repo.update_last_login(admin.id)

    return admin


async def get_optional_admin(
    current_user: Optional[User] = Depends(get_optional_current_user),
    admin_repo: AdminRepository = Depends(get_admin_repository)
) -> Optional[AdminUser]:
    """Get current admin user (optional, returns None if not admin)"""
    if not current_user:
        return None

    admin = await admin_repo.get_by_user_id(current_user.id)
    if admin and admin.is_active and not admin.is_suspended:
        await admin_repo.update_last_login(admin.id)
        return admin

    return None


class RequirePermission:
    """Dependency to require specific admin permission"""

    def __init__(self, permission: AdminPermission):
        self.permission = permission

    async def __call__(
        self,
        current_admin: AdminUser = Depends(get_current_admin)
    ) -> AdminUser:
        """Check if admin has required permission"""
        if not current_admin.has_permission(self.permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission '{self.permission.value}' required"
            )

        return current_admin


class RequireRole:
    """Dependency to require specific admin role"""

    def __init__(self, *roles: AdminRole):
        self.roles = roles

    async def __call__(
        self,
        current_admin: AdminUser = Depends(get_current_admin)
    ) -> AdminUser:
        """Check if admin has required role"""
        if AdminRole(current_admin.role) not in self.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"One of roles {[r.value for r in self.roles]} required"
            )

        return current_admin


# Convenience dependencies
require_super_admin = RequireRole(AdminRole.SUPER_ADMIN)
require_admin = RequireRole(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
require_view_users = RequirePermission(AdminPermission.VIEW_USERS)
require_edit_users = RequirePermission(AdminPermission.EDIT_USERS)
require_view_system_stats = RequirePermission(AdminPermission.VIEW_SYSTEM_STATS)
require_view_analytics = RequirePermission(AdminPermission.VIEW_ANALYTICS)
