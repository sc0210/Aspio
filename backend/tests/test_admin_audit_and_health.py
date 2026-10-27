"""Admin audit log and system health endpoints.

The audit log used to hand SQLAlchemy rows straight to the response; the health
check used to report a hard-coded latency of 0 and a Redis that was never there.
The removed endpoints (api-usage, /admins) returned stubbed zeros or duplicated
`aspiro admin grant`, and must stay gone.
"""

from datetime import timedelta
from decimal import Decimal

import pytest

from app.modules.dashboard.models import DailyWalletSnapshot
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
        for feed in ("wallet_snapshots", "historical_prices", "fx_rates"):
            assert data["data_freshness"][feed]["status"] == "empty"

    @pytest.mark.asyncio
    async def test_old_snapshot_is_stale_and_degrades(self, client, seeded, async_session):  # noqa: F811
        zero = Decimal("0")
        async_session.add(
            DailyWalletSnapshot(
                user_id=seeded["active_user"].id,
                snapshot_date=business_today() - timedelta(days=10),
                life_balance=zero,
                portfolio_value=zero,
                emergency_value=zero,
                debt_balance=zero,
                net_worth=zero,
            )
        )
        await async_session.commit()

        data = client.get(
            "/api/v1/admin/health/detailed", headers=seeded["admin_headers"]
        ).json()["data"]

        snapshots = data["data_freshness"]["wallet_snapshots"]
        assert snapshots["status"] == "stale"
        assert snapshots["age_days"] == 10
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
