"""/notifications HTTP surface: auth, scoping, route order, stats, preferences, bulk actions."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.modules.notifications.models import (
    Notification, NotificationPriority, NotificationStatus, NotificationType,
)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

BASE = "/api/v1/notifications"


def note(user_id, *, status=NotificationStatus.PENDING, type_=NotificationType.SYSTEM_UPDATE,
         priority=NotificationPriority.MEDIUM, expires_at=None, title="n"):
    return Notification(id=uuid.uuid4(), user_id=user_id, type=type_, priority=priority, status=status,
                        title=title, message="body", channels=["in_app"], expires_at=expires_at)


def data_of(r, code=200):
    assert r.status_code == code, r.text[:300]
    return r.json()["data"]


@pytest.mark.parametrize("method,path", [
    ("get", "/"), ("get", f"/{uuid.uuid4()}"), ("post", "/mark-all-read"),
    ("get", "/preferences"), ("get", "/stats/summary"),
])
async def test_anonymous_callers_are_refused(client, method, path):
    assert getattr(client, method)(f"{BASE}{path}").status_code == 401


async def test_stats_never_count_another_users_notifications(client, async_session, test_user):
    async_session.add(note(uuid.uuid4(), title="someone else's"))
    await async_session.commit()
    assert client.get(f"{BASE}/stats/summary").status_code == 401


async def test_status_and_health_are_public(client):
    assert data_of(client.get(f"{BASE}/status"))["status"] == "operational"
    assert data_of(client.get(f"{BASE}/health"))["features"]["sms_notifications"] is False


async def test_list_get_and_mark_one_read(authenticated_client, async_session, test_user):
    mine, theirs = note(test_user.id, title="mine"), note(uuid.uuid4(), title="theirs")
    async_session.add_all([mine, theirs])
    await async_session.commit()

    r = authenticated_client.get(f"{BASE}/")
    assert [n["title"] for n in data_of(r)] == ["mine"] and r.json()["meta"]["total"] == 1
    assert data_of(authenticated_client.get(f"{BASE}/{mine.id}"))["title"] == "mine"
    assert authenticated_client.get(f"{BASE}/{theirs.id}").status_code == 404

    updated = data_of(authenticated_client.patch(f"{BASE}/{mine.id}", json={"status": "read"}))
    assert updated["status"] == "read"
    assert authenticated_client.patch(f"{BASE}/{theirs.id}", json={"status": "read"}).status_code == 404
    assert authenticated_client.patch(f"{BASE}/{mine.id}", json={"status": "dismissed"}).status_code == 400


async def test_read_at_alone_marks_read(authenticated_client, async_session, test_user):
    n = note(test_user.id)
    async_session.add(n)
    await async_session.commit()
    r = authenticated_client.patch(f"{BASE}/{n.id}", json={"read_at": datetime.now(timezone.utc).isoformat()})
    assert data_of(r)["status"] == "read"


async def test_bulk_mark_read_counts_only_own_notifications(authenticated_client, async_session, test_user):
    a, b, other = note(test_user.id), note(test_user.id), note(uuid.uuid4())
    async_session.add_all([a, b, other])
    await async_session.commit()
    ids = [str(a.id), str(b.id), str(other.id)]
    assert data_of(authenticated_client.post(
        f"{BASE}/bulk-action", json={"notification_ids": ids, "action": "mark_read"}))["updated"] == 2
    assert authenticated_client.post(
        f"{BASE}/bulk-action", json={"notification_ids": ids, "action": "delete"}).status_code == 400


async def test_mark_all_read(authenticated_client, async_session, test_user):
    async_session.add_all([note(test_user.id), note(test_user.id), note(test_user.id, status=NotificationStatus.READ)])
    await async_session.commit()
    assert data_of(authenticated_client.post(f"{BASE}/mark-all-read"))["updated"] == 2


async def test_stats_summarise_only_the_callers_notifications(authenticated_client, async_session, test_user):
    past = datetime.now(timezone.utc) - timedelta(days=1)
    async_session.add_all([
        note(test_user.id),
        note(test_user.id, status=NotificationStatus.SENT, priority=NotificationPriority.HIGH),
        note(test_user.id, status=NotificationStatus.READ, expires_at=past),
        note(test_user.id, status=NotificationStatus.DISMISSED, type_=NotificationType.ACHIEVEMENT_UNLOCKED),
        note(test_user.id, status=NotificationStatus.FAILED),
        note(uuid.uuid4()), note(uuid.uuid4(), status=NotificationStatus.READ),
    ])
    await async_session.commit()

    s = data_of(authenticated_client.get(f"{BASE}/stats/summary"))
    assert s["total_notifications"] == 5 and s["unread_notifications"] == 2
    assert (s["read_notifications"], s["dismissed_notifications"], s["failed_notifications"]) == (1, 1, 1)
    assert s["expired_notifications"] == 1
    assert s["notifications_by_type"] == {"system_update": 4, "achievement_unlocked": 1}
    assert s["notifications_by_priority"] == {"medium": 4, "high": 1}
    assert len(s["recent_notifications"]) == 5


async def test_preferences_round_trip(authenticated_client):
    r = authenticated_client.get(f"{BASE}/preferences")
    assert r.status_code == 200 and r.json()["data"] is None

    body = {"email_enabled": False, "quiet_hours_start": "22:00", "digest_frequency": "weekly"}
    saved = data_of(authenticated_client.patch(f"{BASE}/preferences", json=body))
    assert saved["email_enabled"] is False and saved["quiet_hours_start"] == "22:00"

    again = data_of(authenticated_client.get(f"{BASE}/preferences"))
    assert again["digest_frequency"] == "weekly" and again["email_enabled"] is False
    assert authenticated_client.patch(f"{BASE}/preferences", json={"quiet_hours_start": "25:00"}).status_code == 422


async def test_templates_are_admin_only(authenticated_client):
    assert authenticated_client.get(f"{BASE}/templates").status_code == 403
    body = {"template_key": "k", "name": "n", "type": "system_update", "title_template": "t",
            "message_template": "m"}
    assert authenticated_client.post(f"{BASE}/templates", json=body).status_code == 403
