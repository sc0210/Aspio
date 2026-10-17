"""Regression tests for marking notifications read.

The notifications module had no tests at all, which is how this shipped: the
repository reached the READ enum member via ``Notification.status.__class__``.
On a *class* attribute that expression is the SQLAlchemy ``InstrumentedAttribute``
type, not the enum, so ``.READ`` raised AttributeError every single time. The
"Mark all read" button therefore never worked, and filtering the list by read
state 500'd too.

These tests pin the behaviour rather than the spelling: they assert that marking
actually flips state, so any future rewrite that breaks persistence fails here.
"""

import uuid

import pytest
from sqlalchemy import select

from app.modules.notifications.models import (
    Notification,
    NotificationPriority,
    NotificationStatus,
    NotificationType,
)
from app.modules.notifications.repositories import NotificationRepository


def _make_notification(user_id, *, title="Test notification"):
    return Notification(
        id=uuid.uuid4(),
        user_id=user_id,
        type=NotificationType.SYSTEM_UPDATE,
        priority=NotificationPriority.MEDIUM,
        status=NotificationStatus.PENDING,
        title=title,
        message="body",
        channels=["in_app"],
    )


@pytest.mark.asyncio
async def test_mark_all_read_marks_every_unread_notification(async_session, test_user):
    """The bug: this raised AttributeError instead of updating anything."""
    for i in range(3):
        async_session.add(_make_notification(test_user.id, title=f"n{i}"))
    await async_session.flush()

    repo = NotificationRepository(async_session)
    updated = await repo.mark_all_read_for_user(test_user.id)

    assert updated == 3, f"expected 3 notifications marked read, got {updated}"

    rows = (
        await async_session.execute(
            select(Notification).where(Notification.user_id == test_user.id)
        )
    ).scalars().all()
    assert len(rows) == 3
    for row in rows:
        await async_session.refresh(row)
        assert row.status is NotificationStatus.READ
        assert row.read_at is not None
        assert row.is_read is True


@pytest.mark.asyncio
async def test_mark_all_read_is_idempotent_and_counts_only_unread(
    async_session, test_user
):
    already_read = _make_notification(test_user.id, title="old")
    already_read.status = NotificationStatus.READ
    async_session.add(already_read)
    async_session.add(_make_notification(test_user.id, title="new"))
    await async_session.flush()

    repo = NotificationRepository(async_session)
    assert await repo.mark_all_read_for_user(test_user.id) == 1
    # Nothing left unread, so a second call is a no-op rather than an error.
    assert await repo.mark_all_read_for_user(test_user.id) == 0


@pytest.mark.asyncio
async def test_mark_single_notification_read(async_session, test_user):
    notif = _make_notification(test_user.id)
    async_session.add(notif)
    await async_session.flush()

    repo = NotificationRepository(async_session)
    result = await repo.mark_as_read(notif.id, test_user.id)

    assert result is not None
    assert result.status is NotificationStatus.READ
    assert result.is_read is True
    assert result.read_at is not None


@pytest.mark.asyncio
async def test_mark_read_does_not_touch_another_users_notification(
    async_session, test_user
):
    """user_id scoping — marking must not reach across accounts."""
    other_user_id = uuid.uuid4()
    foreign = _make_notification(other_user_id, title="not yours")
    async_session.add(foreign)
    await async_session.flush()

    repo = NotificationRepository(async_session)

    assert await repo.mark_as_read(foreign.id, test_user.id) is None
    assert await repo.mark_all_read_for_user(test_user.id) == 0

    await async_session.refresh(foreign)
    assert foreign.status is NotificationStatus.PENDING


@pytest.mark.asyncio
async def test_list_filtered_by_read_state(async_session, test_user):
    """The same antipattern lived in the is_read filter, which 500'd when used."""
    read_one = _make_notification(test_user.id, title="read")
    read_one.status = NotificationStatus.READ
    async_session.add(read_one)
    async_session.add(_make_notification(test_user.id, title="unread"))
    await async_session.flush()

    class _Filters:
        type = None
        priority = None
        status = None
        category = None
        search = None

        def __init__(self, is_read):
            self.is_read = is_read

    repo = NotificationRepository(async_session)

    unread_items, _ = await repo.list_for_user(test_user.id, filters=_Filters(False))
    assert [n.title for n in unread_items] == ["unread"]

    read_items, _ = await repo.list_for_user(test_user.id, filters=_Filters(True))
    assert [n.title for n in read_items] == ["read"]
