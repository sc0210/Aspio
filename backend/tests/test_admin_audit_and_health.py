"""Admin audit log and system health endpoints.

The audit log used to hand SQLAlchemy rows straight to the response; the health
check used to report a hard-coded latency of 0 and a Redis that was never there.
The removed endpoints (api-usage, /admins) returned stubbed zeros or duplicated
`aspiro admin grant`, and must stay gone. Scheduled jobs used to swallow their own
failures, so nothing could tell a failed run from a good one.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core import scheduler
from app.modules.admin.models import SystemSetting
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


@pytest.fixture
def job_db(async_engine, monkeypatch):
    """Point the scheduler's own sessions at the test database."""
    maker = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(scheduler, "async_session", maker)
    return maker


async def _job_row(maker, job_id):
    async with maker() as session:
        return (
            await session.execute(
                select(SystemSetting).where(SystemSetting.key == f"job_status:{job_id}")
            )
        ).scalar_one()


class TestTrackedJobs:
    @pytest.mark.asyncio
    async def test_records_a_clean_run(self, job_db):
        async def job(market):
            return {"updated": 3, "failed": 0, "details": [{"symbol": "2330"}]}

        await scheduler.run_tracked_job("tw_prices", "TW prices", job, market="TW")

        row = await _job_row(job_db, "tw_prices")
        assert row.category == "job_status"
        assert row.description == "TW prices"
        assert row.value["status"] == "ok"
        # Counts only: the per-symbol details list is not stored.
        assert row.value["summary"] == {"updated": 3, "failed": 0}
        assert row.value["error"] is None

    @pytest.mark.asyncio
    async def test_failed_symbols_make_a_partial_run(self, job_db):
        async def job():
            return {"successful": 5, "failed": 2}

        await scheduler.run_tracked_job("hist", "Historical", job)

        assert (await _job_row(job_db, "hist")).value["status"] == "partial"

    @pytest.mark.asyncio
    async def test_an_exception_is_recorded_without_its_message(self, job_db):
        async def job():
            raise ConnectionError("could not reach db.internal:5432")

        await scheduler.run_tracked_job("hist", "Historical", job)  # does not raise

        value = (await _job_row(job_db, "hist")).value
        assert value["status"] == "failed"
        assert value["error"] == "ConnectionError"
        assert "db.internal" not in str(value)

    @pytest.mark.asyncio
    async def test_a_later_run_replaces_the_row(self, job_db):
        async def bad():
            raise RuntimeError

        async def good():
            return None

        await scheduler.run_tracked_job("hist", "Historical", bad)
        await scheduler.run_tracked_job("hist", "Historical", good)

        async with job_db() as session:
            rows = (await session.execute(select(SystemSetting))).scalars().all()
        assert len(rows) == 1
        assert rows[0].value["status"] == "ok"

    def test_missed_runs_get_a_grace_window(self, monkeypatch):
        monkeypatch.setattr(scheduler, "scheduler", None)
        sched = scheduler.init_scheduler()
        try:
            assert sched._job_defaults["misfire_grace_time"] >= 3600
            assert sched._job_defaults["coalesce"] is True
            assert all(j.func is scheduler.run_tracked_job for j in sched.get_jobs())
        finally:
            monkeypatch.setattr(scheduler, "scheduler", None)


class TestJobRunsInHealth:
    @staticmethod
    async def _seed(session, job_id, status, hours_ago):
        started = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        session.add(
            SystemSetting(
                key=f"job_status:{job_id}",
                value={
                    "status": status,
                    "started_at": started.isoformat(),
                    "duration_ms": 1200,
                    "summary": {"updated": 4},
                    "error": "RuntimeError" if status == "failed" else None,
                },
                value_type="json",
                category="job_status",
                description=job_id.replace("_", " "),
            )
        )
        await session.commit()

    def _health(self, client, seeded):  # noqa: F811
        return client.get(
            "/api/v1/admin/health/detailed", headers=seeded["admin_headers"]
        ).json()["data"]

    @pytest.mark.asyncio
    async def test_lists_recent_runs(self, client, seeded, async_session):  # noqa: F811
        await self._seed(async_session, "daily_historical_sync", "ok", hours_ago=2)

        runs = self._health(client, seeded)["job_runs"]

        assert len(runs) == 1
        run = runs[0]
        assert run["id"] == "daily_historical_sync"
        assert run["status"] == "ok"
        assert run["overdue"] is False
        assert run["summary"] == {"updated": 4}
        assert run["duration_ms"] == 1200

    @pytest.mark.asyncio
    async def test_a_failed_run_degrades(self, client, seeded, async_session):  # noqa: F811
        await self._seed(async_session, "daily_historical_sync", "failed", hours_ago=2)

        data = self._health(client, seeded)

        assert data["job_runs"][0]["error"] == "RuntimeError"
        assert data["status"] == "degraded"

    @pytest.mark.asyncio
    async def test_a_run_missed_for_over_a_day_is_overdue(self, client, seeded, async_session):  # noqa: F811
        await self._seed(async_session, "daily_historical_sync", "ok", hours_ago=50)

        data = self._health(client, seeded)

        assert data["job_runs"][0]["overdue"] is True
        assert data["status"] == "degraded"

    @pytest.mark.asyncio
    async def test_hidden_when_the_scheduler_is_off(
        self, client, seeded, async_session, monkeypatch  # noqa: F811
    ):
        from app.core.config import get_settings

        await self._seed(async_session, "daily_historical_sync", "failed", hours_ago=50)
        monkeypatch.setattr(get_settings(), "ENABLE_SCHEDULER", False)

        assert self._health(client, seeded)["job_runs"] == []


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
