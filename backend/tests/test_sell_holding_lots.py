"""DB-level tests for the multi-lot FIFO sell foundation.

Exercises the new ``HoldingRepository.get_sellable_lots`` query (oldest-first
ordering, active/quantity/wallet filtering) against a real session, then feeds
its result through the pure ``allocate_fifo`` allocator — i.e. the exact path
the sell endpoint takes to compute cost basis.

(The endpoint itself can't be driven by the sync TestClient here: it shares the
async test session across event loops. The crash fix — building a
PortfolioTransaction instead of the field-less Transaction — is covered
structurally; FIFO math by test_portfolio_cost_basis; the query below.)
"""

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from app.modules.portfolio.cost_basis import allocate_fifo
from app.modules.portfolio.models import (
    HoldingWalletType,
    Portfolio,
    PortfolioHolding,
    PortfolioTransaction,
)
from app.modules.portfolio.repositories import HoldingRepository, TransactionRepository


def _lot(portfolio_id, user_id, *, qty, avg, purchase_date, wallet=HoldingWalletType.PORTFOLIO, active=True):
    return PortfolioHolding(
        id=uuid4(),
        portfolio_id=portfolio_id,
        user_id=user_id,
        symbol="AAPL",
        name="Apple Inc.",
        type="stock",
        exchange="NASDAQ",
        currency="USD",
        market="US",
        wallet_type=wallet,
        quantity=Decimal(qty),
        average_cost=Decimal(avg),
        current_price=Decimal("150"),
        total_cost=Decimal(qty) * Decimal(avg),
        total_value=Decimal(qty) * Decimal("150"),
        gain_loss=Decimal("0"),
        gain_loss_percentage=Decimal("0"),
        is_active=active,
        purchase_date=purchase_date,
    )


@pytest.mark.asyncio
@pytest.mark.database
class TestGetSellableLots:
    async def _seed(self, async_session, test_user):
        portfolio = Portfolio(
            id=uuid4(), user_id=test_user.id, name="P", currency="USD", is_active=True,
        )
        async_session.add(portfolio)
        lots = {
            "old": _lot(portfolio.id, test_user.id, qty="10", avg="100",
                        purchase_date=datetime(2025, 1, 1)),
            "new": _lot(portfolio.id, test_user.id, qty="5", avg="120",
                        purchase_date=datetime(2025, 2, 1)),
            "zero": _lot(portfolio.id, test_user.id, qty="0", avg="90",
                         purchase_date=datetime(2024, 1, 1)),  # oldest, but empty
            "inactive": _lot(portfolio.id, test_user.id, qty="7", avg="80",
                             purchase_date=datetime(2024, 6, 1), active=False),
            "emergency": _lot(portfolio.id, test_user.id, qty="3", avg="70",
                              purchase_date=datetime(2024, 3, 1),
                              wallet=HoldingWalletType.EMERGENCY),
        }
        async_session.add_all(list(lots.values()))
        await async_session.commit()
        return portfolio, lots

    async def test_returns_active_nonempty_lots_oldest_first(self, async_session, test_user):
        portfolio, lots = await self._seed(async_session, test_user)
        repo = HoldingRepository(async_session)

        result = await repo.get_sellable_lots(
            portfolio.id, "AAPL", test_user.id, wallet_type=HoldingWalletType.PORTFOLIO,
        )

        # zero-qty, inactive, and emergency-wallet lots are all excluded;
        # remaining are oldest purchase first.
        assert [r.id for r in result] == [lots["old"].id, lots["new"].id]

    async def test_wallet_filter_omitted_includes_all_wallets(self, async_session, test_user):
        portfolio, lots = await self._seed(async_session, test_user)
        repo = HoldingRepository(async_session)

        result = await repo.get_sellable_lots(portfolio.id, "AAPL", test_user.id)

        # Without a wallet filter, the emergency lot is included (still oldest-first).
        assert [r.id for r in result] == [
            lots["emergency"].id, lots["old"].id, lots["new"].id,
        ]

    async def test_locks_the_lots_it_returns(self, async_session, test_user, monkeypatch):
        """Two concurrent sells must not both see the same shares (Postgres row lock;
        SQLite drops FOR UPDATE, so assert on the statement as Postgres compiles it)."""
        from sqlalchemy.dialects import postgresql

        portfolio, _ = await self._seed(async_session, test_user)
        repo = HoldingRepository(async_session)
        seen = []
        execute = async_session.execute

        async def spy(stmt, *args, **kwargs):
            seen.append(stmt)
            return await execute(stmt, *args, **kwargs)

        monkeypatch.setattr(async_session, "execute", spy)
        await repo.get_sellable_lots(portfolio.id, "AAPL", test_user.id)

        assert "FOR UPDATE" in str(seen[0].compile(dialect=postgresql.dialect()))

    async def test_returns_quantities_as_they_are_now_not_as_first_loaded(
        self, async_session, test_user
    ):
        """The sell route loads the holding before the lock; a sale that commits in
        between must show up, or the second sell passes on the stale quantity."""
        from sqlalchemy import update

        portfolio, lots = await self._seed(async_session, test_user)
        repo = HoldingRepository(async_session)
        loaded = await repo.get_by_id(lots["old"].id, test_user.id)
        assert loaded.quantity == Decimal("10")

        # Another request's sale, written straight to the row.
        await async_session.execute(
            update(PortfolioHolding)
            .where(PortfolioHolding.id == lots["old"].id)
            .values(quantity=Decimal("4"))
            .execution_options(synchronize_session=False)
        )

        result = await repo.get_sellable_lots(
            portfolio.id, "AAPL", test_user.id, wallet_type=HoldingWalletType.PORTFOLIO,
        )
        assert result[0].quantity == Decimal("4")

    async def test_fifo_over_db_lots_computes_cost_basis(self, async_session, test_user):
        portfolio, lots = await self._seed(async_session, test_user)
        repo = HoldingRepository(async_session)

        sellable = await repo.get_sellable_lots(
            portfolio.id, "AAPL", test_user.id, wallet_type=HoldingWalletType.PORTFOLIO,
        )
        # Sell 12: all of old (10 @ 100) + 2 of new (@ 120) => 1000 + 240 = 1240.
        allocation = allocate_fifo(sellable, Decimal("12"))
        assert allocation.cost_basis == Decimal("1240")
        assert allocation.lot_ids == [str(lots["old"].id), str(lots["new"].id)]


@pytest.mark.asyncio
@pytest.mark.database
class TestSumRealizedPnl:
    def _sell(self, portfolio_id, user_id, *, gain, capital_gain_set=True):
        return PortfolioTransaction(
            id=uuid4(),
            portfolio_id=portfolio_id,
            user_id=user_id,
            symbol="AAPL",
            exchange="NASDAQ",
            type="sell",
            quantity=Decimal("1"),
            price=Decimal("150"),
            total_amount=Decimal("150"),
            currency="USD",
            transaction_date=datetime(2025, 3, 1),
            cost_basis_method="FIFO",
            cost_basis=Decimal("100"),
            capital_gain=Decimal(gain) if capital_gain_set else None,
        )

    async def test_sums_capital_gain_and_counts(self, async_session, test_user):
        portfolio = Portfolio(
            id=uuid4(), user_id=test_user.id, name="P", currency="USD", is_active=True,
        )
        async_session.add(portfolio)
        async_session.add_all([
            self._sell(portfolio.id, test_user.id, gain="650"),
            self._sell(portfolio.id, test_user.id, gain="-120"),
            # A buy and a NULL-capital_gain sell must be ignored.
            PortfolioTransaction(
                id=uuid4(), portfolio_id=portfolio.id, user_id=test_user.id,
                symbol="AAPL", type="buy", quantity=Decimal("1"), price=Decimal("100"),
                total_amount=Decimal("100"), currency="USD",
                transaction_date=datetime(2025, 1, 1),
            ),
            self._sell(portfolio.id, test_user.id, gain="0", capital_gain_set=False),
        ])
        await async_session.commit()

        repo = TransactionRepository(async_session)
        total, count = await repo.sum_realized_pnl(test_user.id)

        assert total == Decimal("530")  # 650 + (-120)
        assert count == 2  # buy and NULL-gain sell excluded

    async def test_zero_when_no_sells(self, async_session, test_user):
        repo = TransactionRepository(async_session)
        total, count = await repo.sum_realized_pnl(test_user.id)
        assert total == Decimal("0")
        assert count == 0
