"""
Endpoints must not re-run the same query several times per request.

Two hot paths each recomputed identical work:

* GET /users/me/achievements/progress issued 18 queries, three of them the
  same transaction count — FIRST_TRANSACTION, HUNDRED_TRANSACTIONS and
  THOUSAND_TRANSACTIONS all resolve their progress from the same counter, and
  each asked the database again. Goals and payment-method counts repeated too.

* GET /portfolio/rebalancing/dashboard issued 14 queries, fetching the same
  portfolio 4x and the same holdings 4x. get_current_allocation is reached
  from the dashboard directly, from calculate_rebalancing_plan and from
  get_rebalancing_alerts, and every route recomputed it from scratch.

Both services are constructed per request, so a memo on the instance is
request-scoped by construction — it cannot leak between users or outlive the
response. These tests pin the reuse and, just as importantly, that different
users/portfolios still get their own answers.
"""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest


USER_A = UUID("11111111-1111-1111-1111-111111111111")
USER_B = UUID("22222222-2222-2222-2222-222222222222")


@pytest.mark.unit
class TestAchievementProgressQueryReuse:
    async def _progress(self, repo, user_id=USER_A):
        return await repo.get_achievement_progress(user_id)

    def _repo(self, counts):
        from app.modules.users.gamification_repository import GamificationRepository

        repo = GamificationRepository(AsyncMock())

        user = MagicMock()
        user.id = USER_A
        user.current_login_streak = 3
        user.level = 2

        unlocked = MagicMock()
        unlocked.scalars.return_value.all.return_value = []
        user_res = MagicMock()
        user_res.scalar_one_or_none.return_value = user
        repo.session.execute = AsyncMock(side_effect=[unlocked, user_res])

        for name, value in counts.items():
            setattr(repo, name, AsyncMock(return_value=value))
        return repo

    @pytest.mark.asyncio
    async def test_transaction_count_is_queried_once_per_request(self):
        counts = {
            "_count_user_transactions": 120,
            "_count_user_goals": 2,
            "_count_completed_goals": 1,
            "_count_completed_milestones": 0,
            "_count_completed_emergency_goals": 0,
            "_count_holdings": 4,
            "_count_distinct_asset_types": 2,
            "_count_local_investments": 1,
            "_count_qr_payments": 0,
            "_count_ewallet_payments": 0,
            "_count_currencies_used": 2,
            "_count_expense_tracking_days": 5,
            "_count_referrals": 0,
        }
        repo = self._repo(counts)
        progress = await self._progress(repo)

        assert progress, "progress must still be produced"
        assert repo._count_user_transactions.await_count == 1, (
            f"transaction count queried "
            f"{repo._count_user_transactions.await_count}x in one request"
        )

    @pytest.mark.asyncio
    async def test_every_shared_counter_is_queried_at_most_once(self):
        counts = {
            "_count_user_transactions": 120,
            "_count_user_goals": 2,
            "_count_completed_goals": 1,
            "_count_completed_milestones": 0,
            "_count_completed_emergency_goals": 0,
            "_count_holdings": 4,
            "_count_distinct_asset_types": 2,
            "_count_local_investments": 1,
            "_count_qr_payments": 3,
            "_count_ewallet_payments": 1,
            "_count_currencies_used": 2,
            "_count_expense_tracking_days": 5,
            "_count_referrals": 0,
        }
        repo = self._repo(counts)
        await self._progress(repo)

        repeated = {
            name: getattr(repo, name).await_count
            for name in counts
            if getattr(repo, name).await_count > 1
        }
        assert not repeated, f"counters queried more than once: {repeated}"

    @pytest.mark.asyncio
    async def test_progress_values_are_unchanged_by_the_memo(self):
        """Reuse must not alter what each achievement reports."""
        counts = {
            "_count_user_transactions": 150,
            "_count_user_goals": 1,
            "_count_completed_goals": 1,
            "_count_completed_milestones": 1,
            "_count_completed_emergency_goals": 0,
            "_count_holdings": 3,
            "_count_distinct_asset_types": 2,
            "_count_local_investments": 1,
            "_count_qr_payments": 0,
            "_count_ewallet_payments": 0,
            "_count_currencies_used": 1,
            "_count_expense_tracking_days": 2,
            "_count_referrals": 0,
        }
        repo = self._repo(counts)
        progress = await self._progress(repo)

        # 150 transactions: first=1 (capped), hundred=150, thousand=150.
        assert progress["first_transaction"]["current_progress"] == 1
        assert progress["hundred_transactions"]["current_progress"] == 150
        assert progress["thousand_transactions"]["current_progress"] == 150


@pytest.mark.unit
class TestRebalancingDashboardQueryReuse:
    def _service(self):
        from app.modules.portfolio.rebalancing_service import RebalancingService

        return RebalancingService(AsyncMock())

    @pytest.mark.asyncio
    async def test_allocation_is_computed_once_across_the_dashboard_paths(self):
        """The dashboard reaches get_current_allocation three ways; together
        they must hit the database once, not three times."""
        service = self._service()
        summary = MagicMock()
        summary.in_balance = True
        summary.requires_rebalancing = False
        summary.largest_deviation = Decimal("0")
        summary.total_portfolio_value = Decimal("1000")
        summary.allocations = []

        with patch.object(
            service, "_compute_current_allocation", AsyncMock(return_value=summary)
        ) as compute:
            # 1) the dashboard's own allocation read
            await service.get_current_allocation(USER_A)
            # 2) reached again inside the rebalancing plan
            await service.get_current_allocation(USER_A)
            # 3) and again inside the alerts pass
            await service.get_current_allocation(USER_A)

        assert compute.await_count == 1, (
            f"allocation recomputed {compute.await_count}x in one request"
        )

    @pytest.mark.asyncio
    async def test_memo_does_not_leak_between_users(self):
        """A per-instance cache is only safe if it never answers for the wrong user."""
        service = self._service()
        summary_a, summary_b = MagicMock(), MagicMock()

        with patch.object(
            service,
            "_compute_current_allocation",
            AsyncMock(side_effect=[summary_a, summary_b]),
        ) as compute:
            a = await service.get_current_allocation(USER_A)
            b = await service.get_current_allocation(USER_B)

        assert a is summary_a and b is summary_b
        assert compute.await_count == 2

    @pytest.mark.asyncio
    async def test_memo_distinguishes_portfolios_of_one_user(self):
        service = self._service()
        p1, p2 = uuid4(), uuid4()
        s1, s2 = MagicMock(), MagicMock()

        with patch.object(
            service, "_compute_current_allocation", AsyncMock(side_effect=[s1, s2])
        ) as compute:
            first = await service.get_current_allocation(USER_A, p1)
            second = await service.get_current_allocation(USER_A, p2)
            again = await service.get_current_allocation(USER_A, p1)

        assert first is s1 and second is s2 and again is s1
        assert compute.await_count == 2, "the second lookup of p1 should be reused"

    @pytest.mark.asyncio
    async def test_a_fresh_service_starts_with_an_empty_memo(self):
        """Each request builds its own service; nothing may survive between them."""
        from app.modules.portfolio.rebalancing_service import RebalancingService

        s1 = RebalancingService(AsyncMock())
        s2 = RebalancingService(AsyncMock())
        assert s1._allocation_cache is not s2._allocation_cache
        assert s2._allocation_cache == {}
