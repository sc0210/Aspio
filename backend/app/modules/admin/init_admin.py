"""
Admin initialization script.

Automatically creates admin accounts based on environment configuration.
Run this on application startup to ensure admin accounts exist.
"""

import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.users.models import User
from .models import AdminRole
from .repositories import AdminRepository

logger = logging.getLogger(__name__)
settings = get_settings()


async def init_admin_users(session: AsyncSession):
    """
    Initialize admin users from environment configuration.
    
    Reads ADMIN_EMAILS from .env and creates/updates admin accounts.
    Format: ADMIN_EMAILS=admin1@example.com:super_admin,admin2@example.com:admin
    """
    
    if not settings.ADMIN_EMAILS:
        logger.info("No admin emails configured in environment")
        return
    
    admin_config = settings.ADMIN_EMAILS.strip()
    if not admin_config:
        return
    
    # Parse admin configuration
    # Format: email1:role1,email2:role2
    admin_entries = admin_config.split(',')
    
    admin_repo = AdminRepository(session)
    created_count = 0
    updated_count = 0
    
    for entry in admin_entries:
        entry = entry.strip()
        if not entry:
            continue
        
        parts = entry.split(':')
        if len(parts) != 2:
            logger.warning(f"Invalid admin config format: {entry}")
            continue
        
        email, role = parts[0].strip(), parts[1].strip()
        
        # Validate role
        try:
            admin_role = AdminRole(role)
        except ValueError:
            logger.error(f"Invalid admin role '{role}' for {email}")
            continue
        
        # Find user by email
        result = await session.execute(
            select(User).where(User.email == email)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            logger.warning(f"User not found for admin email: {email}")
            continue
        
        # Check if admin account exists
        existing_admin = await admin_repo.get_by_user_id(user.id)
        
        if existing_admin:
            # Update existing admin role if changed
            if existing_admin.role != role:
                await admin_repo.update(existing_admin.id, {
                    "role": role,
                    "is_active": True
                })
                updated_count += 1
                logger.info(f"Updated admin role for {email}: {role}")
            else:
                logger.debug(f"Admin account already exists for {email}")
        else:
            # Create new admin account
            await admin_repo.create({
                "user_id": user.id,
                "role": role,
                "is_active": True,
                "notes": "Auto-created from environment configuration"
            })
            created_count += 1
            logger.info(f"Created admin account for {email}: {role}")
    
    if created_count > 0 or updated_count > 0:
        logger.info(f"Admin initialization complete: {created_count} created, {updated_count} updated")
    else:
        logger.debug("No admin accounts created or updated")


# Example .env configuration:
"""
# Admin Configuration
# Format: email1:role1,email2:role2
# Roles: super_admin, admin, moderator, analyst, support
ADMIN_EMAILS=admin@aspiro.com:super_admin,support@aspiro.com:support

# Alternative: Single super admin
ADMIN_EMAILS=admin@aspiro.com:super_admin
"""
