"""
Granting admin roles outside the admin panel: the ADMIN_EMAILS setting, applied at
startup, and scripts/create_admin.py (`aspiro admin grant`). Both go through
grant_admin, so they approve the account and set the role the same way.
"""
import logging
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.users.models import User, UserStatus
from .models import AdminRole, AdminUser
from .repositories import AdminRepository

logger = logging.getLogger(__name__)
settings = get_settings()


async def grant_admin(session: AsyncSession, email: str, role: str) -> Optional[AdminUser]:
    """Make the account registered as `email` an active admin with `role`.

    A registration still pending approval is approved, as AdminService.approve_user
    does, so the new admin can log in. Returns None when no account has that email.
    Raises ValueError for an unknown role.
    """
    role = AdminRole(role).value
    user = (
        await session.execute(select(User).where(func.lower(User.email) == email.strip().lower()))
    ).scalar_one_or_none()
    if not user:
        return None

    if user.status == UserStatus.PENDING_APPROVAL or not user.is_active:
        user.status = UserStatus.ACTIVE
        user.is_active = True
        await session.commit()
        from app.modules.users.dependencies import invalidate_user_auth_cache

        invalidate_user_auth_cache(user.id)
        logger.info(f"Approved {user.email} while granting {role}")

    repo = AdminRepository(session)
    admin = await repo.get_by_user_id(user.id)
    if admin:
        if admin.role != role or not admin.is_active:
            admin = await repo.update(admin.id, {"role": role, "is_active": True})
        return admin
    return await repo.create({
        "user_id": user.id,
        "role": role,
        "is_active": True,
        "notes": "Granted outside the admin panel (ADMIN_EMAILS or create_admin.py)",
    })


async def init_admin_users(session: AsyncSession):
    """Apply ADMIN_EMAILS ("email:role,email:role") at startup.

    It runs on every start, so a listed account is re-granted its role even after
    it was changed in the admin panel. Remove an entry to stop that.
    """
    for entry in (settings.ADMIN_EMAILS or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        email, sep, role = entry.rpartition(":")
        if not sep or not email:
            logger.warning(f"Invalid ADMIN_EMAILS entry (want email:role): {entry}")
            continue
        try:
            admin = await grant_admin(session, email, role.strip())
        except ValueError:
            logger.error(f"Invalid admin role '{role}' for {email}")
            continue
        if admin is None:
            logger.warning(f"ADMIN_EMAILS: no account registered as {email} yet")
        else:
            logger.info(f"ADMIN_EMAILS: {email} is {admin.role}")
