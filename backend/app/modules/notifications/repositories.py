from datetime import timezone
"""
Notification repositories using BaseRepository patterns.

Provides efficient, eager-loaded queries to avoid N+1 patterns.
"""

from typing import Optional, List, Tuple
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ...common.base_repository import BaseRepository
from .models import (
    Notification,
    NotificationPreference,
    NotificationStatus,
    NotificationTemplate,
)


class NotificationRepository(BaseRepository[Notification]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, Notification)

    async def list_for_user(
        self, user_id, filters=None, skip: int = 0, limit: int = 50
    ) -> Tuple[List[Notification], int]:
        """List notifications for a user with optional filters.

        Returns (items, total_count).
        Uses selectinload to prefetch related `user` to avoid N+1 when accessing user fields.
        """
        stmt = select(Notification).where(Notification.user_id == user_id)

        # Apply simple filters if provided
        if filters:
            if filters.type:
                stmt = stmt.where(Notification.type == filters.type)
            if filters.priority:
                stmt = stmt.where(Notification.priority == filters.priority)
            if filters.status:
                stmt = stmt.where(Notification.status == filters.status)
            if filters.is_read is not None:
                if filters.is_read:
                    stmt = stmt.where(
                        Notification.status == NotificationStatus.READ
                    )
                else:
                    stmt = stmt.where(
                        Notification.status != NotificationStatus.READ
                    )
            if filters.category:
                stmt = stmt.where(Notification.category == filters.category)
            if filters.search:
                # basic ILIKE on title/message
                stmt = stmt.where(
                    (Notification.title.ilike(f"%{filters.search}%"))
                    | (Notification.message.ilike(f"%{filters.search}%"))
                )

        # Count before adding loading options so the subquery stays clean
        total_stmt = select(func.count()).select_from(stmt.subquery())

        stmt = stmt.options(selectinload(Notification.user)).offset(skip).limit(limit)

        result = await self.db.execute(stmt)
        items = result.scalars().unique().all()

        total = 0
        try:
            total_res = await self.db.execute(total_stmt)
            total = int(total_res.scalar_one())
        except Exception:
            total = len(items)

        return items, total

    async def get_by_id_for_user(
        self, notification_id, user_id
    ) -> Optional[Notification]:
        stmt = (
            select(Notification)
            .where(
                and_(
                    Notification.id == notification_id, Notification.user_id == user_id
                )
            )
            .options(selectinload(Notification.user))
        )

        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def mark_as_read(self, notification_id, user_id) -> Optional[Notification]:
        obj = await self.get_by_id_for_user(notification_id, user_id)
        if not obj:
            return None

        from datetime import datetime

        obj.status = NotificationStatus.READ
        obj.read_at = datetime.now(timezone.utc)
        await self.db.flush()
        # updated_at's onupdate is SQL-side, so the flush expires it; reading it
        # later (response serialisation) would lazy-load outside the greenlet.
        await self.db.refresh(obj)
        return obj

    async def mark_all_read_for_user(self, user_id) -> int:
        # Bulk update for efficiency
        from sqlalchemy import update
        from datetime import datetime

        stmt = (
            update(Notification)
            .where(Notification.user_id == user_id)
            .where(Notification.status != NotificationStatus.READ)
            .values(
                status=NotificationStatus.READ, read_at=datetime.now(timezone.utc)
            )
            .execution_options(synchronize_session=False)
        )

        res = await self.db.execute(stmt)
        await self.db.flush()
        return res.rowcount or 0


class NotificationPreferenceRepository(BaseRepository[NotificationPreference]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, NotificationPreference)

    async def get_by_user(self, user_id):
        stmt = select(NotificationPreference).where(
            NotificationPreference.user_id == user_id
        )
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()


class NotificationTemplateRepository(BaseRepository[NotificationTemplate]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, NotificationTemplate)
