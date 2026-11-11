"""Reminding a partner who owes you to settle up."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.notifications.models import (
    Notification, NotificationPriority, NotificationStatus, NotificationType,
)
from test_peer_splits import _bill, couple  # noqa: F401  (fixture)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


async def _reminders(session, user, action="settle_reminder"):
    rows = (await session.execute(select(Notification).where(Notification.user_id == user.id))).scalars().all()
    return [n for n in rows if (n.data or {}).get("action") == action]


async def _bob_owes_alice(c):
    """Alice paid NT$1,000 and Bob accepted his half: he owes her NT$500."""
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")


async def test_reminds_the_partner_who_owes_you_once_a_day(async_session, couple):
    c = couple
    await _bob_owes_alice(c)
    await c["svc"].remind(c["alice"].id, c["conn"].id)
    [n] = await _reminders(async_session, c["bob"])
    assert n.title == f"Reminder from {c['alice'].name}"
    assert "TWD 500" in n.message and n.action_url == "/savings?tab=splits"

    with pytest.raises(HTTPException) as err:  # again the same day
        await c["svc"].remind(c["alice"].id, c["conn"].id)
    assert err.value.status_code == 429

    # The sender keeps a receipt, already read; a day later it may go again.
    [receipt] = await _reminders(async_session, c["alice"], "settle_reminder_sent")
    assert receipt.title == f"You reminded {c['bob'].name}" and receipt.status.value == "read"
    receipt.created_at = datetime.now(timezone.utc) - timedelta(hours=25)
    await async_session.commit()
    await c["svc"].remind(c["alice"].id, c["conn"].id)
    assert len(await _reminders(async_session, c["bob"])) == 2


async def test_refused_when_nothing_is_owed_to_you(async_session, couple):
    c = couple
    with pytest.raises(HTTPException) as err:  # no bills at all
        await c["svc"].remind(c["alice"].id, c["conn"].id)
    assert err.value.status_code == 422
    await _bob_owes_alice(c)
    with pytest.raises(HTTPException) as err:  # Bob owes; Alice owes Bob nothing
        await c["svc"].remind(c["bob"].id, c["conn"].id)
    assert err.value.status_code == 422
    assert await _reminders(async_session, c["alice"]) == []


async def test_only_on_your_own_connection(async_session, couple):
    c = couple
    await _bob_owes_alice(c)
    with pytest.raises(HTTPException) as err:
        await c["svc"].remind(c["eve"].id, c["conn"].id)
    assert err.value.status_code == 404


async def test_a_partner_who_muted_you_gets_nothing_and_you_cannot_tell(async_session, couple):
    c = couple
    await _bob_owes_alice(c)
    await c["svc"].set_prefs(c["bob"].id, c["conn"].id, notify=False)
    await c["svc"].remind(c["alice"].id, c["conn"].id)  # succeeds, as for anyone
    assert await _reminders(async_session, c["bob"]) == []
    # And is refused the second time, as for anyone: retrying can't tell a mute apart.
    with pytest.raises(HTTPException) as err:
        await c["svc"].remind(c["alice"].id, c["conn"].id)
    assert err.value.status_code == 429


async def test_a_busy_bell_does_not_reopen_the_day(async_session, couple):
    c = couple
    await _bob_owes_alice(c)
    await c["svc"].remind(c["alice"].id, c["conn"].id)
    for i in range(60):  # Alice's own bell fills with other things
        async_session.add(Notification(
            id=uuid.uuid4(), user_id=c["alice"].id, type=NotificationType.SYSTEM_UPDATE,
            priority=NotificationPriority.LOW, status=NotificationStatus.PENDING,
            title=f"Other {i}", message="", data={"action": "other"}, channels=[]))
    await async_session.commit()
    with pytest.raises(HTTPException) as err:
        await c["svc"].remind(c["alice"].id, c["conn"].id)
    assert err.value.status_code == 429


async def test_the_route_resolves_over_http(authenticated_client):
    # Not someone's connection: 404 from the service, not a 405/422 from routing.
    assert authenticated_client.post(f"/api/v1/peers/{uuid.uuid4()}/remind").status_code == 404
