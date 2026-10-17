"""
Notification service layer.

Contains business logic that orchestrates repositories and implements
behavior required by router endpoints. Keeps queries efficient.
"""

import uuid
from typing import Optional, Tuple, List
from sqlalchemy.ext.asyncio import AsyncSession

from .repositories import (
    NotificationRepository,
    NotificationPreferenceRepository,
    NotificationTemplateRepository,
)
from .schemas import NotificationFilterParams
from .models import (
    Notification,
    NotificationType,
    NotificationPriority,
    NotificationStatus,
    NotificationChannel,
)


class NotificationService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = NotificationRepository(db)
        self.pref_repo = NotificationPreferenceRepository(db)
        self.template_repo = NotificationTemplateRepository(db)

    async def list_notifications_for_user(
        self,
        user_id,
        filters: Optional[NotificationFilterParams],
        page: int = 1,
        limit: int = 20,
    ):
        skip = (page - 1) * limit
        items, total = await self.repo.list_for_user(
            user_id, filters=filters, skip=skip, limit=limit
        )
        return items, total

    async def get_notification(self, notification_id, user_id):
        return await self.repo.get_by_id_for_user(notification_id, user_id)

    async def mark_notification_read(self, notification_id, user_id):
        return await self.repo.mark_as_read(notification_id, user_id)

    async def mark_all_read(self, user_id) -> int:
        return await self.repo.mark_all_read_for_user(user_id)

    async def get_preferences(self, user_id):
        return await self.pref_repo.get_by_user(user_id)

    async def update_preferences(self, user_id, updates: dict):
        pref = await self.pref_repo.get_by_user(user_id)
        if not pref:
            # create default pref
            pref = await self.pref_repo.create(user_id=user_id, **updates)
            return pref

        # apply updates
        for key, value in updates.items():
            if hasattr(pref, key):
                setattr(pref, key, value)

        await self.db.flush()
        return pref

    async def list_templates(self, page: int = 1, limit: int = 20):
        skip = (page - 1) * limit
        return await self.template_repo.get_all(skip=skip, limit=limit)

    async def create_template(self, data: dict):
        return await self.template_repo.create(**data)


def get_notifications_service(db: AsyncSession) -> NotificationService:
    return NotificationService(db)


async def create_notification(
    db: AsyncSession,
    *,
    user_id,
    type: NotificationType,
    title: str,
    message: str,
    priority: NotificationPriority = NotificationPriority.MEDIUM,
    data: Optional[dict] = None,
    action_url: Optional[str] = None,
    related_entity_type: Optional[str] = None,
    related_entity_id=None,
) -> Notification:
    """Create an in-app notification for a user.

    This is the shared producer used by domain events (goal completion,
    achievement unlock, payment reminders, budget alerts). It flushes so the id
    is populated but does NOT commit — the caller's transaction owns the commit,
    keeping the notification atomic with the event that triggered it.
    """
    notification = Notification(
        id=uuid.uuid4(),
        user_id=user_id,
        type=type,
        priority=priority,
        status=NotificationStatus.PENDING,
        title=title,
        message=message,
        data=data or {},
        channels=[NotificationChannel.IN_APP],
        action_url=action_url,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
    )
    db.add(notification)
    await db.flush()
    return notification
