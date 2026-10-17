"""Wallet-bridge tests for the "cash lives only in the Life Wallet" model.

The wallet model is Life / Portfolio (invested assets only) / Emergency — the
Portfolio wallet never holds cash. These tests cover the buy/sell + transfer
bridge introduced when that rule was enforced:

  * a sell credits NET proceeds to the Life Wallet (INCOME), converted to TWD,
    and creates NO in-portfolio cash holding;
  * "portfolio" is rejected as a wallet-transfer target, while life↔emergency
    transfers still create two balanced transactions (and no holdings).

The sell HTTP endpoint itself can't be driven by the sync TestClient (it shares
the async test session across event loops), so — like test_sell_holding_lots —
these exercise the service path the endpoint calls.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, func

from app.core.exceptions import ValidationException
from app.modules.portfolio.services import get_portfolio_service
from app.modules.portfolio.models import PortfolioHolding, HoldingWalletType
from app.modules.transactions.models import (
    Transaction,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import (
    TransactionRepository,
    TransactionCategoryRepository,
    RecurringTransactionRepository,
)
from app.modules.transactions.services import TransactionService


async def _life_income(session, user_id):
    return (
        await session.execute(
            select(Transaction).where(
                Transaction.user_id == user_id,
                Transaction.wallet_type == TransactionWalletType.LIFE,
                Transaction.type == TransactionType.INCOME,
            )
        )
    ).scalars().all()


async def _count_portfolio_cash(session, user_id):
    return (
        await session.execute(
            select(func.count(PortfolioHolding.id)).where(
                PortfolioHolding.user_id == user_id,
                PortfolioHolding.type == "cash",
                PortfolioHolding.wallet_type == HoldingWalletType.PORTFOLIO,
            )
        )
    ).scalar_one()


@pytest.mark.asyncio
@pytest.mark.database
class TestSellCreditsLifeWallet:
    async def test_the_income_leg_is_dated_by_the_business_day(
        self, async_session, test_user, monkeypatch
    ):
        """A sale stamped 20:00 UTC on the 31st is the 1st in Taipei.

        Dating the Life Wallet income from that instant directly books it in the
        previous month, and the previous month's reports. The buy leg was already
        Taipei-aware through its business_now() default; this leg is where the shared
        business_day_of actually changes behaviour.
        """
        from app.core.config import get_settings

        monkeypatch.setenv("APP_TIMEZONE", "Asia/Taipei")
        get_settings.cache_clear()
        try:
            svc = get_portfolio_service(async_session)
            await svc.credit_sale_proceeds_to_life(
                user_id=test_user.id,
                net_proceeds=Decimal("1000"),
                currency="TWD",
                symbol="2330.TW",
                transaction_date=datetime(2026, 8, 31, 20, 0, tzinfo=timezone.utc),
            )
            await async_session.commit()

            rows = await _life_income(async_session, test_user.id)
            assert len(rows) == 1
            assert rows[0].transaction_date == date(2026, 9, 1)
        finally:
            get_settings.cache_clear()

    async def test_twd_proceeds_credit_life_income(self, async_session, test_user):
        svc = get_portfolio_service(async_session)
        await svc.credit_sale_proceeds_to_life(
            user_id=test_user.id,
            net_proceeds=Decimal("1000"),
            currency="TWD",
            symbol="2330.TW",
            transaction_date=datetime(2026, 6, 1),
        )
        await async_session.commit()

        rows = await _life_income(async_session, test_user.id)
        assert len(rows) == 1
        assert rows[0].amount == Decimal("1000.00")
        assert rows[0].currency == "TWD"
        assert rows[0].wallet_type == TransactionWalletType.LIFE
        assert rows[0].type == TransactionType.INCOME

    async def test_foreign_proceeds_converted_to_twd(self, async_session, test_user):
        svc = get_portfolio_service(async_session)
        # No Currency rows seeded → _to_twd falls back to the static USD rate (31.5).
        await svc.credit_sale_proceeds_to_life(
            user_id=test_user.id,
            net_proceeds=Decimal("100"),
            currency="USD",
            symbol="AAPL",
            transaction_date=datetime(2026, 6, 1),
        )
        await async_session.commit()

        rows = await _life_income(async_session, test_user.id)
        assert len(rows) == 1
        assert rows[0].currency == "TWD"
        assert rows[0].amount == Decimal("3150.00")  # 100 * 31.5

    async def test_zero_proceeds_is_noop(self, async_session, test_user):
        svc = get_portfolio_service(async_session)
        await svc.credit_sale_proceeds_to_life(
            user_id=test_user.id,
            net_proceeds=Decimal("0"),
            currency="TWD",
            symbol="AAPL",
            transaction_date=datetime(2026, 6, 1),
        )
        await async_session.commit()
        assert await _life_income(async_session, test_user.id) == []

    async def test_creates_no_portfolio_cash_holding(self, async_session, test_user):
        svc = get_portfolio_service(async_session)
        await svc.credit_sale_proceeds_to_life(
            user_id=test_user.id,
            net_proceeds=Decimal("500"),
            currency="TWD",
            symbol="AAPL",
            transaction_date=datetime(2026, 6, 1),
        )
        await async_session.commit()
        assert await _count_portfolio_cash(async_session, test_user.id) == 0


@pytest.mark.asyncio
@pytest.mark.database
class TestTransferRejectsPortfolio:
    def _service(self, session) -> TransactionService:
        return TransactionService(
            TransactionRepository(session),
            TransactionCategoryRepository(session),
            RecurringTransactionRepository(session),
        )

    async def test_portfolio_target_rejected(self, async_session, test_user):
        svc = self._service(async_session)
        with pytest.raises(ValidationException):
            await svc.create_transfer(
                user_id=str(test_user.id),
                from_wallet="life",
                to_wallet="portfolio",
                amount=Decimal("100"),
                currency="TWD",
                transaction_date=datetime(2026, 6, 1).date(),
            )

    async def test_life_to_emergency_creates_two_transactions_no_holding(
        self, async_session, test_user
    ):
        svc = self._service(async_session)
        await svc.create_transfer(
            user_id=str(test_user.id),
            from_wallet="life",
            to_wallet="emergency",
            amount=Decimal("250"),
            currency="TWD",
            transaction_date=datetime(2026, 6, 1).date(),
        )

        txns = (
            await async_session.execute(
                select(Transaction).where(Transaction.user_id == test_user.id)
            )
        ).scalars().all()
        by_wallet = {(t.wallet_type, t.type) for t in txns}
        assert (TransactionWalletType.LIFE, TransactionType.EXPENSE) in by_wallet
        assert (TransactionWalletType.EMERGENCY, TransactionType.INCOME) in by_wallet
        # A transfer never spills cash into the Portfolio wallet.
        assert await _count_portfolio_cash(async_session, test_user.id) == 0
