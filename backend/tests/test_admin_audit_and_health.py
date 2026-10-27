"""Admin audit log and system health endpoints.

The audit log used to hand SQLAlchemy rows straight to the response; the health
check used to report a hard-coded latency of 0 and a Redis that was never there.
The removed endpoints (api-usage, /admins) returned stubbed zeros or duplicated
`aspiro admin grant`, and must stay gone.
"""

from datetime import timedelta
from decimal import Decimal

import pytest

from app.modules.portfolio.models import HistoricalPrice
from app.utils.datetime_helpers import business_today
from tests.test_superadmin_management import seeded  # noqa: F401  (fixture)


class TestAuditLogs:
    def test_lists_actions_with_admin_email(self, client, seeded):  # noqa: F811
        uid = str(seeded["pending_user"].id)
        assert client.post(
            f"/api/v1/admin/approve-user/{uid}", headers=seeded["admin_headers"]
        ).status_code == 200

        resp = client.get("/api/v1/admin/audit-logs", headers=seeded["admin_headers"])

        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["total"] == 1
        entry = data["logs"][0]
        assert entry["action"] == "approve_user"
        assert entry["resource_id"] == uid
        assert entry["admin_email"] == "sadmin@example.com"
        assert entry["status"] == "success"
        assert entry["created_at"]

    def test_filters_by_action(self, client, seeded):  # noqa: F811
        client.post(
            f"/api/v1/admin/approve-user/{seeded['pending_user'].id}",
            headers=seeded["admin_headers"],
        )
        resp = client.get(
            "/api/v1/admin/audit-logs?action=delete_user", headers=seeded["admin_headers"]
        )
        assert resp.json()["data"]["total"] == 0

    def test_regular_user_rejected(self, client, seeded):  # noqa: F811
        resp = client.get("/api/v1/admin/audit-logs", headers=seeded["regular_headers"])
        assert resp.status_code == 403


class TestSystemHealth:
    def test_reports_real_database_round_trip(self, client, seeded):  # noqa: F811
        resp = client.get("/api/v1/admin/health/detailed", headers=seeded["admin_headers"])

        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["database"]["status"] == "healthy"
        assert data["database"]["latency_ms"] >= 0
        assert "redis" not in data
        assert data["app"]["version"]
        assert data["scheduler"]["status"] in {"healthy", "unhealthy", "unknown", "disabled"}

    def test_empty_feeds_are_not_stale(self, client, seeded):  # noqa: F811
        """A fresh install has no snapshots or prices yet; that must not read as broken."""
        data = client.get(
            "/api/v1/admin/health/detailed", headers=seeded["admin_headers"]
        ).json()["data"]
        assert set(data["data_freshness"]) == {"historical_prices", "fx_rates"}
        for feed in ("historical_prices", "fx_rates"):
            assert data["data_freshness"][feed]["status"] == "empty"

    @staticmethod
    async def _add_price(session, days_ago):
        session.add(
            HistoricalPrice(
                symbol="2330",
                market="TW",
                date=business_today() - timedelta(days=days_ago),
                close=Decimal("1000"),
                currency="TWD",
            )
        )
        await session.commit()

    @pytest.mark.asyncio
    async def test_recent_prices_are_fresh(self, client, seeded, async_session):  # noqa: F811
        await self._add_price(async_session, days_ago=1)

        prices = client.get(
            "/api/v1/admin/health/detailed", headers=seeded["admin_headers"]
        ).json()["data"]["data_freshness"]["historical_prices"]

        assert prices["status"] == "fresh"
        assert prices["age_days"] == 1

    @pytest.mark.asyncio
    async def test_old_prices_are_stale_and_degrade(self, client, seeded, async_session):  # noqa: F811
        await self._add_price(async_session, days_ago=10)

        data = client.get(
            "/api/v1/admin/health/detailed", headers=seeded["admin_headers"]
        ).json()["data"]

        prices = data["data_freshness"]["historical_prices"]
        assert prices["status"] == "stale"
        assert prices["age_days"] == 10
        assert data["status"] == "degraded"

    def test_regular_user_rejected(self, client, seeded):  # noqa: F811
        resp = client.get("/api/v1/admin/health/detailed", headers=seeded["regular_headers"])
        assert resp.status_code == 403


class TestRemovedEndpoints:
    @pytest.mark.parametrize(
        "method,path",
        [
            ("GET", "/api/v1/admin/stats/api-usage"),
            ("GET", "/api/v1/admin/users/00000000-0000-0000-0000-000000000000/api-usage"),
            ("GET", "/api/v1/admin/admins"),
            ("POST", "/api/v1/admin/admins"),
        ],
    )
    def test_gone(self, client, seeded, method, path):  # noqa: F811
        resp = client.request(method, path, headers=seeded["admin_headers"])
        assert resp.status_code in (404, 405)
