"""
Admin repositories for database operations.
"""

from datetime import datetime, timezone
from typing import Optional, List
from uuid import UUID
from sqlalchemy import select, func, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AdminUser, AdminAuditLog


class AdminRepository:
    """Repository for admin user operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, admin_id: UUID) -> Optional[AdminUser]:
        """Get admin by ID"""
        result = await self.session.execute(
            select(AdminUser).where(AdminUser.id == admin_id)
        )
        return result.scalar_one_or_none()

    async def get_by_user_id(self, user_id: UUID) -> Optional[AdminUser]:
        """Get admin by user ID"""
        result = await self.session.execute(
            select(AdminUser).where(AdminUser.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def create(self, admin_data: dict) -> AdminUser:
        """Create new admin user"""
        admin = AdminUser(**admin_data)
        self.session.add(admin)
        await self.session.commit()
        await self.session.refresh(admin)
        return admin

    async def update(self, admin_id: UUID, update_data: dict) -> Optional[AdminUser]:
        """Update admin user"""
        admin = await self.get_by_id(admin_id)
        if not admin:
            return None

        for key, value in update_data.items():
            setattr(admin, key, value)

        admin.updated_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(admin)
        return admin

    async def update_last_login(self, admin_id: UUID):
        """Update last login timestamp (single UPDATE, no pre-SELECT)."""
        await self.session.execute(
            update(AdminUser)
            .where(AdminUser.id == admin_id)
            .values(last_login_at=datetime.now(timezone.utc))
        )

class AuditLogRepository:
    """Repository for audit log operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, log_data: dict) -> AdminAuditLog:
        """Create audit log entry"""
        log = AdminAuditLog(**log_data)
        self.session.add(log)
        await self.session.commit()
        await self.session.refresh(log)
        return log

    async def search(
        self,
        action: Optional[str] = None,
        resource_type: Optional[str] = None,
        admin_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[AdminAuditLog], int]:
        """Search audit logs"""
        query = select(AdminAuditLog)

        conditions = []
        if action:
            conditions.append(AdminAuditLog.action.contains(action))
        if resource_type:
            conditions.append(AdminAuditLog.resource_type == resource_type)
        if admin_id:
            conditions.append(AdminAuditLog.admin_user_id == admin_id)

        if conditions:
            query = query.where(and_(*conditions))

        query = query.order_by(AdminAuditLog.created_at.desc())

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.session.execute(count_query)
        total = total_result.scalar()

        # Get paginated results
        query = query.offset(skip).limit(limit)
        result = await self.session.execute(query)
        logs = result.scalars().all()

        return list(logs), total
