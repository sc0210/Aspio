"""The sell endpoint's own orchestration — the part nothing else covered.

`allocate_fifo` is tested as a pure function in test_portfolio_cost_basis.py: it
computes which lots *would* be consumed and at what cost, but it mutates nothing.
`get_sellable_lots` is tested in test_sell_holding_lots.py. The wallet credit is
tested in test_sell_credits_life_wallet.py.

The code that takes an allocation and actually writes the drawdown had no tests at
all — coverage on routers/holdings.py was 9%, with the whole body of sell_holding
in the missing range. So nothing would have caught a lot whose quantity was
decremented while total_cost went stale, or a depleted lot left is_active=True and
therefore sellable a second time.

The endpoint can't be driven through the sync TestClient (it shares the async test
session across event loops — see test_sell_credits_life_wallet.py), so these call
the handler coroutine directly with the async session and a stub user. Same trick
used for add_holding() in test_wallet_bridge_atomicity.py.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.modules.portfolio.models import (
    HoldingWalletType,
    Portfolio,
    PortfolioHolding,
    PortfolioTransaction,
)
from app.modules.portfolio.routers.holdings import sell_holding
from app.modules.transactions.models import (
    Transaction,
    TransactionType,
    TransactionWalletType,
)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


def _lot(portfolio_id, user_id, *, qty, avg, purchase_date, price="150"):
    return PortfolioHolding(
        id=uuid4(),
        portfolio_id=portfolio_id,
        user_id=user_id,
        symbol="AAPL",
        name="Apple Inc.",
        type="stock",
        exchange="NASDAQ",
        currency="TWD",
        market="TW",
        wallet_type=HoldingWalletType.PORTFOLIO,
        quantity=Decimal(qty),
        average_cost=Decimal(avg),
        current_price=Decimal(price),
        total_cost=Decimal(qty) * Decimal(avg),
        total_value=Decimal(qty) * Decimal(price),
        gain_loss=Decimal("0"),
        gain_loss_percentage=Decimal("0"),
        is_active=True,
        purchase_date=purchase_date,
    )


async def _seed(session, user_id, lots_spec):
    """lots_spec: list of (qty, avg, day). Returns (portfolio, [lots oldest-first])."""
    portfolio = Portfolio(
        id=uuid4(), user_id=user_id, name="P", currency="TWD", is_active=True
    )
    session.add(portfolio)
    await session.flush()

    lots = [
        _lot(
            portfolio.id, user_id, qty=q, avg=a,
            purchase_date=datetime(2026, 1, d, tzinfo=timezone.utc),
        )
        for q, a, d in lots_spec
    ]
    session.add_all(lots)
    # Commit, not flush: the position exists before the request, as in production.
    # Flushed-only fixtures are indistinguishable from the sale's own writes, so a
    # rollback inside the handler would wipe the fixture too and the atomicity
    # tests could not tell "drawdown undone" from "lot never existed".
    await session.commit()
    return portfolio, lots


async def _sell(session, user, holding_id, **kw):
    """Call the handler coroutine directly, bypassing TestClient."""
    params = dict(
        holding_id=holding_id,
        quantity=kw.pop("quantity"),
        price=kw.pop("price", None),
        fees=kw.pop("fees", Decimal("0")),
        taxes=kw.pop("taxes", Decimal("0")),
        notes=kw.pop("notes", None),
        transaction_date=kw.pop("transaction_date", None),
        current_user=user,
        session=session,
    )
    return await sell_holding(**params)


class TestLotDrawdown:
    """The write side of FIFO: what the sale actually does to the lots."""

    async def test_partial_sell_leaves_consistent_residual_state(
        self, async_session, test_user
    ):
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        await _sell(async_session, test_user, lot.id,
                    quantity=Decimal("4"), price=Decimal("150"))

        await async_session.refresh(lot)
        assert lot.quantity == Decimal("6")
        assert lot.is_active is True
        # The derived columns must track the new quantity, not go stale.
        assert lot.total_cost == Decimal("600")           # 6 × 100
        assert lot.total_value == Decimal("900")          # 6 × 150
        assert lot.gain_loss == Decimal("300")            # 900 − 600
        assert lot.gain_loss_percentage == Decimal("50")  # 300/600

    async def test_selling_a_whole_lot_deactivates_and_zeroes_it(
        self, async_session, test_user
    ):
        """A depleted lot left active would be sellable a second time."""
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        await _sell(async_session, test_user, lot.id,
                    quantity=Decimal("10"), price=Decimal("150"))

        await async_session.refresh(lot)
        assert lot.quantity == Decimal("0")
        assert lot.is_active is False
        assert lot.total_cost == Decimal("0")
        assert lot.total_value == Decimal("0")
        assert lot.gain_loss == Decimal("0")

    async def test_sell_spanning_two_lots_drains_the_older_and_partials_the_newer(
        self, async_session, test_user
    ):
        uid = test_user.id
        _, (old, new) = await _seed(
            async_session, uid, [("10", "100", 1), ("10", "200", 2)]
        )

        # 15 shares: all 10 of the older lot, then 5 of the newer.
        await _sell(async_session, test_user, old.id,
                    quantity=Decimal("15"), price=Decimal("150"))

        await async_session.refresh(old)
        await async_session.refresh(new)
        assert (old.quantity, old.is_active) == (Decimal("0"), False)
        assert (new.quantity, new.is_active) == (Decimal("5"), True)
        assert new.total_cost == Decimal("1000")  # 5 × 200

    async def test_selling_via_a_newer_lots_id_still_draws_the_oldest_first(
        self, async_session, test_user
    ):
        """holding_id identifies the position, not which lot to consume."""
        uid = test_user.id
        _, (old, new) = await _seed(
            async_session, uid, [("10", "100", 1), ("10", "200", 2)]
        )

        # Posting the *newer* lot's id must still consume the older lot.
        await _sell(async_session, test_user, new.id,
                    quantity=Decimal("10"), price=Decimal("150"))

        await async_session.refresh(old)
        await async_session.refresh(new)
        assert (old.quantity, old.is_active) == (Decimal("0"), False)
        assert new.quantity == Decimal("10"), "the newer lot must be untouched"


class TestRealizedPnl:
    async def test_gain_is_net_of_fees_and_taxes(self, async_session, test_user):
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        result = await _sell(
            async_session, test_user, lot.id,
            quantity=Decimal("10"), price=Decimal("150"),
            fees=Decimal("20"), taxes=Decimal("30"),
        )
        d = result.data

        assert d["total_proceeds"] == Decimal("1500")
        assert d["net_proceeds"] == Decimal("1450")            # 1500 − 20 − 30
        assert d["realized_gain_loss"] == Decimal("450")       # 1500 − 1000 − 50
        assert d["realized_gain_loss_percentage"] == Decimal("45")
        assert d["remaining_quantity"] == Decimal("0")

    async def test_a_loss_is_reported_negative(self, async_session, test_user):
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        result = await _sell(async_session, test_user, lot.id,
                             quantity=Decimal("10"), price=Decimal("80"))

        assert result.data["realized_gain_loss"] == Decimal("-200")

    async def test_cost_basis_spans_lots_at_their_own_average_costs(
        self, async_session, test_user
    ):
        """15 shares over a 100-lot and a 200-lot = 1000 + 1000 basis."""
        uid = test_user.id
        _, (old, _new) = await _seed(
            async_session, uid, [("10", "100", 1), ("10", "200", 2)]
        )

        result = await _sell(async_session, test_user, old.id,
                             quantity=Decimal("15"), price=Decimal("150"))

        # proceeds 2250 − basis 2000 = 250
        assert result.data["realized_gain_loss"] == Decimal("250")
        assert result.data["remaining_quantity"] == Decimal("5")


class TestAuditTrail:
    async def test_sell_transaction_records_the_fifo_provenance(
        self, async_session, test_user
    ):
        uid = test_user.id
        _, (old, _new) = await _seed(
            async_session, uid, [("10", "100", 1), ("10", "200", 2)]
        )

        await _sell(async_session, test_user, old.id,
                    quantity=Decimal("15"), price=Decimal("150"))

        txn = (
            await async_session.execute(
                select(PortfolioTransaction).where(
                    PortfolioTransaction.user_id == uid,
                    PortfolioTransaction.type == "sell",
                )
            )
        ).scalars().one()

        assert txn.cost_basis_method == "FIFO"
        assert txn.cost_basis == Decimal("2000")
        assert txn.capital_gain == Decimal("250")
        assert txn.quantity == Decimal("15")
        # Both consumed lots are named, so the sale is reconstructible.
        assert len(txn.lot_ids) == 2

    async def test_sale_credits_life_wallet_income(self, async_session, test_user):
        """The bridge, asserted through the endpoint rather than the service."""
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        await _sell(async_session, test_user, lot.id,
                    quantity=Decimal("10"), price=Decimal("150"),
                    fees=Decimal("50"))

        income = (
            await async_session.execute(
                select(Transaction).where(
                    Transaction.user_id == uid,
                    Transaction.wallet_type == TransactionWalletType.LIFE,
                    Transaction.type == TransactionType.INCOME,
                )
            )
        ).scalars().all()

        assert len(income) == 1
        assert income[0].amount == Decimal("1450")  # net of fees, TWD so no FX


class TestGuards:
    async def test_overselling_the_position_is_rejected(
        self, async_session, test_user
    ):
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        with pytest.raises(HTTPException) as exc:
            await _sell(async_session, test_user, lot.id,
                        quantity=Decimal("11"), price=Decimal("150"))
        assert exc.value.status_code == 400
        assert "Insufficient quantity" in str(exc.value.detail)

        await async_session.refresh(lot)
        assert lot.quantity == Decimal("10"), "a rejected sell must not touch lots"

    async def test_oversell_counts_all_lots_not_just_the_posted_one(
        self, async_session, test_user
    ):
        """15 is sellable across two 10-lots even though no single lot holds it."""
        uid = test_user.id
        _, (old, _new) = await _seed(
            async_session, uid, [("10", "100", 1), ("10", "200", 2)]
        )

        result = await _sell(async_session, test_user, old.id,
                             quantity=Decimal("15"), price=Decimal("150"))
        assert result.data["quantity_sold"] == Decimal("15")

    async def test_unauthenticated_caller_is_rejected(
        self, async_session, test_user
    ):
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        with pytest.raises(HTTPException) as exc:
            await _sell(async_session, None, lot.id,
                        quantity=Decimal("1"), price=Decimal("150"))
        assert exc.value.status_code == 401

    async def test_another_users_holding_is_not_sellable(
        self, async_session, test_user
    ):
        """Scoping guard — a holding_id alone must not grant access."""
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        class _Other:
            id = uuid4()

        with pytest.raises(HTTPException) as exc:
            await _sell(async_session, _Other(), lot.id,
                        quantity=Decimal("1"), price=Decimal("150"))
        assert exc.value.status_code == 404

    async def test_non_positive_price_is_rejected_before_touching_lots(
        self, async_session, test_user
    ):
        """current_price is used when no price is posted; zero must not slip through."""
        uid = test_user.id
        portfolio, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])
        lot.current_price = Decimal("0")
        await async_session.flush()

        with pytest.raises(HTTPException) as exc:
            await _sell(async_session, test_user, lot.id, quantity=Decimal("1"))
        assert exc.value.status_code == 400
        assert "price must be positive" in str(exc.value.detail).lower()


class TestAtomicity:
    """A bridge failure mid-sell must leave the position exactly as it was.

    This is the guarantee the rest of this branch was built to restore, and it is
    only observable through the endpoint: sell_holding mutates the lots and adds
    the PortfolioTransaction *before* calling the wallet bridge, then relies on its
    own `except Exception: await session.rollback()` to undo both. Testing
    credit_sale_proceeds_to_life in isolation cannot see that.

    Without this, a regression that reordered the router — committing the drawdown
    before the bridge, or catching and swallowing again — would keep the whole
    suite green while silently reintroducing the double-count.
    """

    async def test_failed_life_wallet_credit_rolls_back_the_whole_sale(
        self, async_session, test_user, monkeypatch
    ):
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])
        lot_id = lot.id

        from app.modules.portfolio.services import PortfolioService

        async def boom(self, **kwargs):
            raise RuntimeError("wallet bridge down")

        monkeypatch.setattr(PortfolioService, "credit_sale_proceeds_to_life", boom)

        with pytest.raises(HTTPException) as exc:
            await _sell(async_session, test_user, lot_id,
                        quantity=Decimal("4"), price=Decimal("150"))
        assert exc.value.status_code == 500

        # The drawdown must be undone: 10 shares, still active.
        surviving = (
            await async_session.execute(
                select(PortfolioHolding).where(PortfolioHolding.id == lot_id)
            )
        ).scalars().one()
        assert surviving.quantity == Decimal("10"), "lot drawdown survived a failed sale"
        assert surviving.is_active is True
        assert surviving.total_cost == Decimal("1000")

        # ...and no sell record may remain.
        sells = (
            await async_session.execute(
                select(func.count(PortfolioTransaction.id)).where(
                    PortfolioTransaction.user_id == uid,
                    PortfolioTransaction.type == "sell",
                )
            )
        ).scalar_one()
        assert sells == 0, "an orphan sell transaction survived a failed sale"

    async def test_no_life_wallet_income_when_the_sale_fails(
        self, async_session, test_user, monkeypatch
    ):
        """The other direction: a failed sale must not leave phantom income."""
        uid = test_user.id
        _, (lot,) = await _seed(async_session, uid, [("10", "100", 1)])

        from app.modules.transactions.repositories import TransactionRepository

        async def boom(self, transaction_data, user_id):
            raise RuntimeError("ledger write failed")

        monkeypatch.setattr(TransactionRepository, "create_flush", boom)

        with pytest.raises(HTTPException):
            await _sell(async_session, test_user, lot.id,
                        quantity=Decimal("10"), price=Decimal("150"))

        income = (
            await async_session.execute(
                select(func.count(Transaction.id)).where(
                    Transaction.user_id == uid,
                    Transaction.wallet_type == TransactionWalletType.LIFE,
                )
            )
        ).scalar_one()
        assert income == 0
