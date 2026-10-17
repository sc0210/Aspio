"""The buy/sell wallet bridge must fail loudly, never silently.

Both sides of the bridge used to swallow their own exceptions:

    except Exception as e:
        logger.error(...)
        # Don't fail the sale if the wallet sync fails

That trade-off was never on offer. The credit/debit shares the caller's session,
and the trade's own writes are still uncommitted when the sync runs, so swallowing
produced a request that reported success while recording nothing:

  * sell — the asset left the portfolio and the cash never arrived, so net worth
    silently dropped by the sale value;
  * buy — the holding was created with no Life-Wallet expense, so net worth was
    silently inflated by the purchase amount.

Either way money appears or disappears with only a log line. These tests pin that
both paths now propagate, and that the happy paths still write what they should.

Propagating is only half of it. The bridge auto-creates its category on first use,
and the committing ``create`` variant committed the caller's whole session —
holding included — leaving nothing to roll back. Every write in the bridge now
goes through a ``create_flush`` variant, so the only commit is the caller's, and
the rollback comes from the sell router's explicit ``session.rollback()`` or from
``get_db()``. ``test_add_holding_leaves_no_orphan_holding_when_the_debit_fails``
is what pins that.

Also covered: FIFO lot ordering is deterministic when two lots share a
purchase_date, which decides the cost basis of a sale.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.portfolio.cost_basis import allocate_fifo
from app.modules.portfolio.models import (
    HoldingWalletType,
    Portfolio,
    PortfolioHolding,
)
from app.modules.portfolio.repositories import HoldingRepository
from app.modules.portfolio.services import get_portfolio_service
from app.modules.transactions.models import (
    Transaction,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


def _lot(portfolio_id, user_id, *, qty, avg, purchase_date, created_at=None, symbol="AAPL"):
    return PortfolioHolding(
        id=uuid4(),
        portfolio_id=portfolio_id,
        user_id=user_id,
        symbol=symbol,
        name="Apple Inc.",
        type="stock",
        exchange="NASDAQ",
        currency="USD",
        market="US",
        wallet_type=HoldingWalletType.PORTFOLIO,
        quantity=Decimal(qty),
        average_cost=Decimal(avg),
        current_price=Decimal("150"),
        total_cost=Decimal(qty) * Decimal(avg),
        total_value=Decimal(qty) * Decimal("150"),
        gain_loss=Decimal("0"),
        gain_loss_percentage=Decimal("0"),
        is_active=True,
        purchase_date=purchase_date,
        **({"created_at": created_at} if created_at else {}),
    )


async def _seed_portfolio(session, user_id):
    portfolio = Portfolio(
        id=uuid4(), user_id=user_id, name="P", currency="USD", is_active=True
    )
    session.add(portfolio)
    await session.flush()
    return portfolio


async def _life_income_count(session, user_id):
    return (
        await session.execute(
            select(func.count(Transaction.id)).where(
                Transaction.user_id == user_id,
                Transaction.wallet_type == TransactionWalletType.LIFE,
                Transaction.type == TransactionType.INCOME,
            )
        )
    ).scalar_one()


class TestSellCreditPropagates:
    """A failed Life-Wallet credit must not be reported as a successful sale."""

    async def test_credit_failure_raises_instead_of_being_swallowed(
        self, async_session, test_user, monkeypatch
    ):
        uid = test_user.id
        svc = get_portfolio_service(async_session)

        async def boom(self, transaction_data, user_id):
            # What the real create() does on error: roll back, then re-raise.
            await self.db.rollback()
            raise ValueError("simulated credit failure")

        monkeypatch.setattr(TransactionRepository, "create_flush", boom)

        with pytest.raises(Exception) as exc:
            await svc.credit_sale_proceeds_to_life(
                user_id=uid,
                net_proceeds=Decimal("1000"),
                currency="TWD",
                symbol="AAPL",
                transaction_date=datetime.now(timezone.utc),
            )
        assert "simulated credit failure" in str(exc.value)

    async def test_no_income_row_is_left_behind_when_the_credit_fails(
        self, async_session, test_user, monkeypatch
    ):
        uid = test_user.id
        svc = get_portfolio_service(async_session)
        before = await _life_income_count(async_session, uid)

        async def boom(self, transaction_data, user_id):
            await self.db.rollback()
            raise ValueError("boom")

        monkeypatch.setattr(TransactionRepository, "create_flush", boom)
        with pytest.raises(Exception):
            await svc.credit_sale_proceeds_to_life(
                user_id=uid,
                net_proceeds=Decimal("500"),
                currency="TWD",
                symbol="AAPL",
                transaction_date=datetime.now(timezone.utc),
            )

        assert await _life_income_count(async_session, uid) == before

    async def test_happy_path_still_credits_life_income(
        self, async_session, test_user
    ):
        """Guards against 'fixing' the raise by breaking the success path."""
        uid = test_user.id
        svc = get_portfolio_service(async_session)
        before = await _life_income_count(async_session, uid)

        await svc.credit_sale_proceeds_to_life(
            user_id=uid,
            net_proceeds=Decimal("1234"),
            currency="TWD",
            symbol="AAPL",
            transaction_date=datetime.now(timezone.utc),
        )

        assert await _life_income_count(async_session, uid) == before + 1

    async def test_zero_proceeds_is_still_a_noop_not_a_raise(
        self, async_session, test_user, monkeypatch
    ):
        """The early return must come before anything that could throw."""
        uid = test_user.id
        svc = get_portfolio_service(async_session)

        async def boom(self, transaction_data, user_id):
            raise AssertionError("must not be reached for zero proceeds")

        monkeypatch.setattr(TransactionRepository, "create_flush", boom)
        await svc.credit_sale_proceeds_to_life(
            user_id=uid,
            net_proceeds=Decimal("0"),
            currency="TWD",
            symbol="AAPL",
            transaction_date=datetime.now(timezone.utc),
        )


class TestBuyDebitPropagates:
    """The mirror image: a swallowed buy debit inflates net worth."""

    async def test_buy_sync_failure_raises_instead_of_being_swallowed(
        self, async_session, test_user, monkeypatch
    ):
        uid = test_user.id
        svc = get_portfolio_service(async_session)

        async def boom(self, transaction_data, user_id):
            await self.db.rollback()
            raise ValueError("simulated debit failure")

        monkeypatch.setattr(TransactionRepository, "create_flush", boom)

        class _HoldingData:
            type = "stock"
            symbol = "AAPL"
            name = "Apple Inc."
            quantity = Decimal("10")
            average_cost = Decimal("100")
            currency = "USD"
            purchase_date = datetime.now(timezone.utc)
            wallet_type = HoldingWalletType.PORTFOLIO

        with pytest.raises(Exception) as exc:
            await svc._sync_wallet_transaction(
                user_id=uid,
                holding_data=_HoldingData(),
                amount=Decimal("1000"),
                transaction_date=datetime.now(timezone.utc),
            )
        assert "simulated debit failure" in str(exc.value)

    async def test_add_holding_leaves_no_orphan_holding_when_the_debit_fails(
        self, async_session, test_user, monkeypatch
    ):
        """End-to-end counterpart to the sell-side row-count check.

        Asserting only that _sync_wallet_transaction raises is not enough: the
        guarantee that matters is that a failed debit leaves no holding behind. A
        later change to add_holding's commit sequencing — an early flush or commit
        slipped in between creating the holding and syncing the wallet — would
        reintroduce the double-count with the low-level test still green.
        """
        from app.modules.portfolio.schemas import HoldingCreate

        uid = test_user.id
        svc = get_portfolio_service(async_session)

        before = (
            await async_session.execute(
                select(func.count(PortfolioHolding.id)).where(
                    PortfolioHolding.user_id == uid,
                    PortfolioHolding.symbol == "ORPHAN",
                )
            )
        ).scalar_one()

        async def boom(self, transaction_data, user_id):
            await self.db.rollback()
            raise ValueError("simulated debit failure")

        monkeypatch.setattr(TransactionRepository, "create_flush", boom)

        payload = HoldingCreate(
            symbol="ORPHAN",
            name="Orphan Co.",
            type="stock",
            exchange="NASDAQ",
            currency="USD",
            quantity=Decimal("10"),
            average_cost=Decimal("100"),
            purchase_date=datetime.now(timezone.utc),
        )

        with pytest.raises(Exception):
            await svc.add_holding(uid, payload)

        after = (
            await async_session.execute(
                select(func.count(PortfolioHolding.id)).where(
                    PortfolioHolding.user_id == uid,
                    PortfolioHolding.symbol == "ORPHAN",
                )
            )
        ).scalar_one()
        assert after == before, "a holding survived a failed Life-Wallet debit"


class TestFifoOrderingIsDeterministic:
    """purchase_date alone is not a total order, and FIFO needs one."""

    async def test_same_purchase_date_breaks_the_tie_by_created_at(
        self, async_session, test_user
    ):
        uid = test_user.id
        portfolio = await _seed_portfolio(async_session, uid)
        same_day = datetime(2026, 3, 1, tzinfo=timezone.utc)

        # Cheap lot recorded second; expensive lot recorded first.
        first_recorded = _lot(
            portfolio.id, uid, qty="10", avg="100",
            purchase_date=same_day, created_at=same_day,
        )
        second_recorded = _lot(
            portfolio.id, uid, qty="10", avg="200",
            purchase_date=same_day, created_at=same_day + timedelta(hours=1),
        )
        async_session.add_all([second_recorded, first_recorded])  # inserted out of order
        await async_session.flush()

        lots = await HoldingRepository(async_session).get_sellable_lots(
            portfolio.id, "AAPL", uid, wallet_type=HoldingWalletType.PORTFOLIO
        )

        assert [l.id for l in lots] == [first_recorded.id, second_recorded.id]

        # And the tie-break decides the money: 10 shares must draw the 100 lot.
        allocation = allocate_fifo(lots, Decimal("10"))
        assert allocation.cost_basis == Decimal("1000")

    async def test_distinct_purchase_dates_still_order_oldest_first(
        self, async_session, test_user
    ):
        uid = test_user.id
        portfolio = await _seed_portfolio(async_session, uid)

        older = _lot(
            portfolio.id, uid, qty="5", avg="100",
            purchase_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),  # recorded later
        )
        newer = _lot(
            portfolio.id, uid, qty="5", avg="200",
            purchase_date=datetime(2026, 2, 1, tzinfo=timezone.utc),
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),  # recorded earlier
        )
        async_session.add_all([newer, older])
        await async_session.flush()

        lots = await HoldingRepository(async_session).get_sellable_lots(
            portfolio.id, "AAPL", uid, wallet_type=HoldingWalletType.PORTFOLIO
        )

        # purchase_date wins over created_at — created_at is only the tie-break.
        assert [l.id for l in lots] == [older.id, newer.id]
