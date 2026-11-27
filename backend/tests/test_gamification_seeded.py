"""
Gamification service + repository against real rows on the SQLite fixture.

test_user_gamification.py covers each piece with mocked sessions; this drives
the counters, the award path and the scoring from actual transactions, goals
and holdings, so a counter that queries the wrong column fails here.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select

from app.modules.goals.models import Goal, GoalCategory, GoalMilestone, GoalStatus
from app.modules.notifications.models import Notification
from app.modules.portfolio.models import HoldingWalletType, Portfolio, PortfolioHolding
from app.modules.transactions.models import (
    PaymentMethod,
    Transaction,
    TransactionType,
    TransactionWalletType,
)
from app.modules.users.gamification_repository import GamificationRepository
from app.modules.users.gamification_service import (
    GamificationService,
    UserAnalyticsService,
)
from app.modules.users.models import (
    AchievementRarity,
    AchievementType,
    User,
    UserActivityLog,
    UserGamificationAchievement,
)
from app.modules.users.schemas import UserActivityRequest

pytestmark = [pytest.mark.asyncio, pytest.mark.database]

A = AchievementType


@pytest_asyncio.fixture
async def world(async_session, test_user, test_category):
    """One expense paid by LINE Pay in TWD, one USD income on another day,
    1,000 TWD in the Emergency Wallet, a completed emergency-fund goal with a reached milestone, and a holding."""
    now = datetime.now(timezone.utc)

    def txn(kind, amount, days_ago, **kw):
        return Transaction(
            id=uuid4(),
            user_id=test_user.id,
            amount=Decimal(amount),
            type=kind,
            category_id=test_category.id,
            transaction_date=now - timedelta(days=days_ago),
            description="seed",
            **{"wallet_type": TransactionWalletType.LIFE, **kw},
        )

    goal = Goal(
        id=uuid4(),
        user_id=test_user.id,
        title="Emergency Fund",
        target_amount=Decimal("1000"),
        current_amount=Decimal("1000"),
        currency="TWD",
        category=GoalCategory.EMERGENCY_FUND,
        status=GoalStatus.COMPLETED,
        priority="high",
    )
    portfolio = Portfolio(
        id=uuid4(), user_id=test_user.id, name="P", currency="TWD",
        is_active=True, is_default=True,
    )
    async_session.add_all(
        [
            txn(TransactionType.EXPENSE, "120", 1, payment_method=PaymentMethod.LINE_PAY, currency="TWD"),
            txn(TransactionType.INCOME, "50", 2, currency="USD"),
            # The fund is completed because the Emergency Wallet covers it: its
            # status follows that wallet (goals/service.py).
            txn(TransactionType.INCOME, "1000", 3, currency="TWD", wallet_type=TransactionWalletType.EMERGENCY),
            goal,
            portfolio,
        ]
    )
    await async_session.flush()
    async_session.add_all(
        [
            GoalMilestone(goal_id=goal.id, title="Half", amount=Decimal("500"), is_completed=True),
            PortfolioHolding(
                id=uuid4(), portfolio_id=portfolio.id, user_id=test_user.id,
                symbol="0050", name="ETF", type="etf", exchange="TWSE",
                currency="TWD", market="TW", wallet_type=HoldingWalletType.PORTFOLIO,
                quantity=Decimal("1"), average_cost=Decimal("100"),
                current_price=Decimal("100"), total_cost=Decimal("100"),
                total_value=Decimal("100"), gain_loss=Decimal("0"),
                gain_loss_percentage=Decimal("0"), is_active=True,
                purchase_date=now - timedelta(days=10),
            ),
        ]
    )
    await async_session.commit()
    return test_user


async def _reload(session, user_id) -> User:
    session.expire_all()
    return (await session.execute(select(User).where(User.id == user_id))).scalar_one()


class TestCounters:
    async def test_progress_reflects_seeded_rows(self, async_session, world):
        progress = await GamificationRepository(async_session).get_achievement_progress(world.id)
        current = {k: v["current_progress"] for k, v in progress.items()}

        assert current[A.FIRST_TRANSACTION.value] == 1
        assert current[A.HUNDRED_TRANSACTIONS.value] == 3
        assert current[A.FIRST_GOAL.value] == 1
        assert current[A.GOAL_COMPLETED.value] == 1
        assert current[A.EMERGENCY_FUND_BUILT.value] == 1
        assert current[A.FIRST_SAVINGS_MILESTONE.value] == 1
        assert current[A.INVESTMENT_STARTER.value] == 1
        assert current[A.DIVERSIFIED_PORTFOLIO.value] == 1
        assert current[A.LOCAL_INVESTMENT_EXPLORER.value] == 0
        assert current[A.QR_PAYMENT_MASTER.value] == 1
        assert current[A.DIGITAL_WALLET_USER.value] == 1  # LINE Pay is both
        assert current[A.MULTI_CURRENCY_TRACKER.value] == 2
        assert current[A.EXPENSE_TRACKER.value] == 1
        assert current[A.REFERRAL_CHAMPION.value] == 0
        assert current[A.EARLY_ADOPTER.value] == 1  # user.level

    async def test_untracked_types_are_hidden_until_unlocked(self, async_session, world):
        progress = await GamificationRepository(async_session).get_achievement_progress(world.id)
        assert A.FAMILY_SAVER.value not in progress
        assert A.LUNAR_NEW_YEAR_SAVER.value not in progress

    async def test_referrals_count_live_referred_users(self, async_session, world):
        async_session.add(
            User(id=uuid4(), email="friend@example.com", name="F", referred_by_user_id=world.id)
        )
        await async_session.commit()
        assert await GamificationRepository(async_session)._count_referrals(world.id) == 1

    async def test_unknown_user_has_no_progress(self, async_session, world):
        assert await GamificationRepository(async_session).get_achievement_progress(uuid4()) == {}


class TestAwarding:
    async def test_sweep_awards_completed_types_once(self, async_session, world):
        service = GamificationService(async_session)
        awarded = await service.sweep_achievements(world.id)
        types = {a.achievement_type for a in awarded}

        assert {
            A.FIRST_TRANSACTION.value,
            A.FIRST_GOAL.value,
            A.GOAL_COMPLETED.value,
            A.INVESTMENT_STARTER.value,
        } <= types
        assert A.HUNDRED_TRANSACTIONS.value not in types

        # The sweep's XP lifts the user to level 5, and update_user_level adds a
        # level-milestone bonus that is not part of the returned list.
        earned = sum(a.points_awarded for a in awarded)
        user = await _reload(async_session, world.id)
        assert user.level == 5
        assert user.experience_points == earned + 5 * 50

        # One unlock notification per returned award; the level bonus has none.
        notes = (
            await async_session.execute(select(Notification).where(Notification.user_id == world.id))
        ).scalars().all()
        assert len(notes) == len(awarded)

        assert await service.sweep_achievements(world.id) == []

    async def test_unlock_notifications_are_committed_with_the_response(self, async_session, world):
        # get_db commits only after the response is sent, so the bell, refetching as
        # soon as check-all answers, could read before the last unlock's notification.
        # One badge and no level-up: update_user_level's commit, which used to carry
        # the notification along, does not run.
        user_id, level = world.id, world.level  # rollback expires world
        awarded = await GamificationService(async_session).trigger_achievement_check(
            user_id, "transaction_created"
        )
        await async_session.rollback()  # what a request that ends here would lose

        assert [a.achievement_type for a in awarded] == [A.FIRST_TRANSACTION.value]
        assert (await _reload(async_session, user_id)).level == level
        notes = (
            await async_session.execute(select(Notification).where(Notification.user_id == user_id))
        ).scalars().all()
        assert len(notes) == 1

    async def test_a_failed_notification_keeps_the_award(self, async_session, world, monkeypatch):
        from app.modules.notifications import services as notifications

        async def broken(session, **kwargs):
            session.add(Notification(id=uuid4(), user_id=kwargs["user_id"]))  # NOT NULL title missing
            await session.flush()

        monkeypatch.setattr(notifications, "create_notification", broken)
        user_id = world.id
        awarded = await GamificationService(async_session).trigger_achievement_check(
            user_id, "transaction_created"
        )
        assert [a.achievement_type for a in awarded] == [A.FIRST_TRANSACTION.value]
        assert world.name  # the caller's objects are still loaded

        await async_session.rollback()
        badges = (await async_session.execute(
            select(UserGamificationAchievement).where(UserGamificationAchievement.user_id == user_id)
        )).scalars().all()
        notes = (await async_session.execute(
            select(Notification).where(Notification.user_id == user_id)
        )).scalars().all()
        assert [b.achievement_type for b in badges] == [A.FIRST_TRANSACTION] and notes == []

    async def test_trigger_checks_only_mapped_types(self, async_session, world):
        awarded = await GamificationService(async_session).trigger_achievement_check(
            world.id, "transaction_created"
        )
        assert [a.achievement_type for a in awarded] == [A.FIRST_TRANSACTION.value]

    async def test_unknown_trigger_awards_nothing(self, async_session, world):
        assert await GamificationService(async_session).trigger_achievement_check(
            world.id, "no_such_trigger"
        ) == []

    async def test_award_is_idempotent(self, async_session, world):
        repo = GamificationRepository(async_session)
        first = await repo.award_achievement(world.id, A.FIRST_GOAL, points=50)
        assert first is not None
        assert await repo.award_achievement(world.id, A.FIRST_GOAL, points=50) is None
        assert (await _reload(async_session, world.id)).experience_points == 50

    async def test_award_that_loses_a_race_pays_nothing(self, async_session, world, monkeypatch):
        """Another request inserted the badge between this one's check and its
        insert: the unique index refuses the row, no XP is paid twice, and the
        caller's own pending changes survive (only a savepoint is rolled back)."""
        repo = GamificationRepository(async_session)
        assert await repo.award_achievement(world.id, A.FIRST_GOAL, points=50) is not None

        real_execute = async_session.execute
        calls = 0

        async def check_sees_nothing(statement, *args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:  # the "already has it?" read, as the racing request saw it
                return await real_execute(select(User).where(User.id.is_(None)))
            return await real_execute(statement, *args, **kwargs)

        user = await _reload(async_session, world.id)
        user.name = "kept"  # the caller's own pending change
        monkeypatch.setattr(async_session, "execute", check_sees_nothing)
        assert await repo.award_achievement(world.id, A.FIRST_GOAL, points=50) is None
        monkeypatch.undo()
        await async_session.commit()

        user = await _reload(async_session, world.id)
        assert user.experience_points == 50
        assert user.name == "kept"
        rows = (
            await async_session.execute(
                select(UserGamificationAchievement).where(UserGamificationAchievement.user_id == world.id)
            )
        ).scalars().all()
        assert [r.achievement_type for r in rows] == [A.FIRST_GOAL]

    async def test_level_up_at_milestone_awards_bonus(self, async_session, world):
        world.experience_points = 5 * 5 * 50  # exactly level 5
        await async_session.commit()

        repo = GamificationRepository(async_session)
        assert await repo.update_user_level(world.id) == 5
        user = await _reload(async_session, world.id)
        assert user.level == 5
        assert user.experience_points == 1250 + 5 * 50

        bonus = await repo.get_user_achievements(world.id)
        assert [(b.achievement_type, b.rarity) for b in bonus] == [
            (A.EARLY_ADOPTER, AchievementRarity.RARE)
        ]
        # Already at the level its XP buys: nothing more to do.
        assert await repo.update_user_level(world.id) is None

    async def test_update_level_for_unknown_user(self, async_session, world):
        assert await GamificationRepository(async_session).update_user_level(uuid4()) is None


class TestStats:
    async def test_stats_summarise_awards(self, async_session, world):
        service = GamificationService(async_session)
        await service.trigger_achievement_check(world.id, "goal_created")

        stats = await service.get_user_gamification_stats(world.id)

        assert stats.total_achievements == 1
        assert stats.achievements_by_rarity == {"common": 1}
        assert stats.recent_achievements[0].achievement_type == A.FIRST_GOAL.value
        assert stats.experience_to_next_level == 200 - stats.experience_points
        # The four always-zero "regional scores" were removed from the payload.
        removed = {
            "digital_adoption_score",
            "savings_discipline_score",
            "investment_knowledge_score",
            "community_engagement_score",
        }
        assert removed.isdisjoint(stats.model_dump())

    async def test_stats_for_missing_user_is_404(self, async_session, world):
        with pytest.raises(HTTPException) as exc:
            await GamificationService(async_session).get_user_gamification_stats(uuid4())
        assert exc.value.status_code == 404

    async def test_progress_is_sorted_locked_first_by_completion(self, async_session, world):
        service = GamificationService(async_session)
        await service.trigger_achievement_check(world.id, "goal_created")
        progress = await service.get_achievement_progress(world.id)

        assert progress[-1].achievement_type == A.FIRST_GOAL.value
        locked = [p.progress_percentage for p in progress if not p.is_unlocked]
        assert locked == sorted(locked, reverse=True)


class TestAnalytics:
    async def test_log_activity_round_trips(self, async_session, world):
        out = await UserAnalyticsService(async_session).log_user_activity(
            world.id,
            UserActivityRequest(activity_type="portfolio_view", activity_data={"tab": "x"}, session_id="s1"),
            ip_address="10.0.0.1",
        )
        assert out.activity_type == "portfolio_view"
        assert out.session_id == "s1"
        rows = (
            await async_session.execute(
                select(UserActivityLog).where(UserActivityLog.user_id == world.id)
            )
        ).scalars().all()
        assert [(r.activity_type, r.ip_address) for r in rows] == [("portfolio_view", "10.0.0.1")]

    async def test_login_streak_first_visit_and_repeat(self, async_session, world):
        service = UserAnalyticsService(async_session)
        first = await service.update_login_streak(world.id)
        assert first["current_streak"] == 1
        assert first["streak_updated"] is True

        again = await service.update_login_streak(world.id)
        assert again["streak_updated"] is False

    async def test_login_streak_missing_user_is_404(self, async_session, world):
        with pytest.raises(HTTPException) as exc:
            await UserAnalyticsService(async_session).update_login_streak(uuid4())
        assert exc.value.status_code == 404
