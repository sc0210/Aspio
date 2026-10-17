"""
Guard tests: a request's AsyncSession must never be used concurrently.

SQLAlchemy's AsyncSession is not a concurrency primitive. Firing several of its
operations at once via asyncio.gather does not run them in parallel — at best
they serialise on the one connection, and if the session has not checked out a
connection yet it raises:

    InvalidRequestError: This session is provisioning a new connection;
                         concurrent operations are not permitted

That is not a theoretical hazard. GET /api/v1/transactions/analytics/summary
returned 500 for exactly this reason: its five analytics queries were gathered
on the request session, and the half-opened transaction then broke the session
teardown in get_db() too. The FX prefetch loops had a quieter version of the
same bug — the error surfaced as a swallowed None, which silently dropped the
currency conversion for that holding and understated non-TWD totals.

Parallelising these would mean a session per query, and it does not pay: on the
heaviest account (2,641 transactions) the whole analytics set is ~12ms
sequential versus ~14ms across five pooled connections, because the connection
checkout costs more than the queries do.

These tests drive the real service methods against a tracker that records any
overlap, so re-introducing a gather on a shared session fails the suite rather
than the endpoint.
"""

import asyncio
from contextlib import asynccontextmanager
from decimal import Decimal
from unittest.mock import AsyncMock, Mock, patch

import pytest


class SharedResourceTracker:
    """Records whether guarded operations ever overlap.

    Stands in for the single connection behind an AsyncSession: each guarded
    call yields to the event loop while "in flight", so anything gathered
    alongside it is caught holding the resource at the same time.
    """

    def __init__(self):
        self.in_flight = 0
        self.max_in_flight = 0
        self.overlaps = 0
        self.calls = []

    @asynccontextmanager
    async def guard(self, label: str = ""):
        self.calls.append(label)
        if self.in_flight > 0:
            self.overlaps += 1
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            # Two yields: enough for a gathered sibling to start and be seen.
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            yield
        finally:
            self.in_flight -= 1

    def tracked(self, result=None, label=""):
        """An async stand-in for one session-backed call."""

        async def _call(*args, **kwargs):
            async with self.guard(label or (args[0] if args else "")):
                return result() if callable(result) else result

        return _call

    def assert_serial(self):
        assert self.overlaps == 0, (
            f"{self.overlaps} concurrent operation(s) on the shared session "
            f"(max {self.max_in_flight} in flight). An AsyncSession cannot be "
            f"used concurrently — run these sequentially, or give each task "
            f"its own session."
        )


@pytest.mark.unit
class TestTrackerItself:
    """The guard has to be able to fail, or it guarantees nothing."""

    @pytest.mark.asyncio
    async def test_tracker_detects_gathered_calls(self):
        t = SharedResourceTracker()
        call = t.tracked(result=1)
        await asyncio.gather(call("a"), call("b"), call("c"))
        assert t.overlaps > 0 and t.max_in_flight == 3
        with pytest.raises(AssertionError):
            t.assert_serial()

    @pytest.mark.asyncio
    async def test_tracker_passes_on_sequential_calls(self):
        t = SharedResourceTracker()
        call = t.tracked(result=1)
        for name in ("a", "b", "c"):
            await call(name)
        assert t.max_in_flight == 1
        t.assert_serial()


@pytest.mark.unit
class TestTransactionAnalyticsSessionSafety:
    """get_analytics ran five repo queries on one session via gather -> 500."""

    @pytest.mark.asyncio
    async def test_analytics_queries_run_one_at_a_time(self):
        from app.modules.transactions.services import TransactionService

        tracker = SharedResourceTracker()
        repo = Mock()
        repo.get_summary = tracker.tracked(
            result=lambda: {
                "total_income": Decimal("100"),
                "total_expenses": Decimal("40"),
                "net_amount": Decimal("60"),
                "transaction_count": 3,
                "currency": "TWD",
            },
            label="get_summary",
        )
        repo.get_category_breakdown = tracker.tracked(result=[], label="categories")
        repo.get_monthly_trends = tracker.tracked(result=[], label="trends")
        repo.get_payment_method_breakdown = tracker.tracked(result=[], label="payments")
        repo.get_top_merchants = tracker.tracked(result=[], label="merchants")
        repo.get_currency_breakdown = tracker.tracked(result=[], label="currencies")

        service = TransactionService(
            transaction_repo=repo,
            category_repo=Mock(),
            recurring_repo=Mock(),
        )
        analytics = await service.get_analytics(user_id="u1")

        tracker.assert_serial()
        # All six still ran — serialising must not silently drop a query.
        assert set(tracker.calls) == {
            "get_summary", "categories", "trends", "payments", "merchants", "currencies",
        }
        assert analytics.summary.total_income == Decimal("100")


@pytest.mark.unit
class TestDashboardFxSessionSafety:
    """The dashboard FX prefetches gathered get_exchange_rate on self.db."""

    def _holding(self, currency, value="1000", wallet="portfolio"):
        from app.modules.portfolio.models import HoldingWalletType

        h = Mock()
        h.currency = currency
        h.total_value = Decimal(value)
        h.total_cost = Decimal(value)
        h.previous_close = None
        h.current_price = Decimal("10")
        h.quantity = Decimal("100")
        h.symbol = "TEST"
        h.wallet_type = (
            HoldingWalletType.EMERGENCY if wallet == "emergency"
            else HoldingWalletType.PORTFOLIO
        )
        return h

    @pytest.mark.asyncio
    async def test_wallet_calc_fx_lookups_are_serial(self):
        from app.modules.dashboard.services import DashboardService
        from app.utils.exchange_rate_service import ExchangeRateService

        tracker = SharedResourceTracker()
        db = AsyncMock()
        wallet_row = Mock()
        wallet_row.fetchone.return_value = (Decimal("0"), Decimal("0"))
        wallet_row.one.return_value = (Decimal("0"), Decimal("0"))
        # The wallet query first asks which transaction currencies it must
        # convert; none here, so the balance sums the column as it is and the
        # only FX lookups are the holdings' — which is what this test pins.
        wallet_row.all.return_value = []
        db.execute = AsyncMock(return_value=wallet_row)

        service = DashboardService(db)
        holdings = [
            self._holding("USD"), self._holding("JPY"),
            self._holding("EUR"), self._holding("HKD"),
        ]

        async def _rate(self_, from_currency, to_currency, *a, **kw):
            async with tracker.guard(f"{from_currency}->{to_currency}"):
                return Decimal("31.5")

        with patch.object(ExchangeRateService, "get_exchange_rate", _rate):
            await service._calculate_all_wallets(
                "11111111-1111-1111-1111-111111111111", holdings=holdings
            )

        tracker.assert_serial()
        # The prefetch warms each currency, then the per-holding loop reads it
        # back (a mem-cache hit in production). Every currency must appear.
        assert {c.split("->")[0] for c in tracker.calls} == {"USD", "JPY", "EUR", "HKD"}

    @pytest.mark.asyncio
    async def test_portfolio_summary_fx_lookups_are_serial(self):
        from app.modules.dashboard.services import DashboardService
        from app.utils.exchange_rate_service import ExchangeRateService

        tracker = SharedResourceTracker()
        db = AsyncMock()
        result = Mock()
        result.scalars.return_value.all.return_value = []
        db.execute = AsyncMock(return_value=result)

        service = DashboardService(db)
        holdings = [self._holding("USD"), self._holding("JPY"), self._holding("SGD")]

        async def _rate(self_, from_currency, to_currency, *a, **kw):
            async with tracker.guard(f"{from_currency}->{to_currency}"):
                return Decimal("31.5")

        with patch.object(ExchangeRateService, "get_exchange_rate", _rate):
            await service._get_portfolio_summary(
                "11111111-1111-1111-1111-111111111111", holdings=holdings
            )

        tracker.assert_serial()


@pytest.mark.unit
class TestAdminStatsSessionSafety:
    """get_system_statistics gathered two counts plus a pg_database_size call."""

    @pytest.mark.asyncio
    async def test_system_statistics_queries_are_serial(self):
        from app.modules.admin.services import AdminMonitoringService

        tracker = SharedResourceTracker()
        session = AsyncMock()

        row = Mock()
        row.total = row.active = row.today = row.this_week = 0
        row.total_value = Decimal("0")
        result = Mock()
        result.one.return_value = row
        result.scalar.return_value = 0

        async def _execute(*args, **kwargs):
            async with tracker.guard("execute"):
                return result

        session.execute = _execute
        service = AdminMonitoringService(session)

        async def _db_size(self_):
            async with tracker.guard("db_size"):
                return 1.0

        with patch.object(AdminMonitoringService, "_get_database_size", _db_size):
            stats = await service.get_system_statistics()

        tracker.assert_serial()
        assert stats["database_size_mb"] == 1.0


@pytest.mark.unit
class TestNoSharedSessionGathersRemain:
    """A cheap net for the whole pattern, so a new one is caught on sight."""

    def test_service_modules_do_not_gather_on_a_shared_session(self):
        import pathlib
        import re

        # These fan out over network calls with no session involved (or give
        # each task its own session), which is the safe, useful kind.
        allowed = {
            "app/modules/portfolio/price_update_service.py",
            "app/modules/portfolio/historical_price_service.py",
            "app/modules/portfolio/market_data_service.py",
            "app/core/background_tasks.py",
        }
        root = pathlib.Path(__file__).resolve().parents[1] / "app"
        offenders = []
        for path in root.rglob("*.py"):
            rel = str(path.relative_to(root.parent))
            if rel in allowed:
                continue
            text = path.read_text(encoding="utf-8")
            if re.search(r"\b_?asyncio\.gather\s*\(", text):
                offenders.append(rel)

        assert not offenders, (
            "asyncio.gather appeared in modules that share a request session: "
            f"{offenders}. If the gathered work is pure network I/O, add the "
            "file to `allowed` above; if it touches a session, run it "
            "sequentially or give each task its own session."
        )
