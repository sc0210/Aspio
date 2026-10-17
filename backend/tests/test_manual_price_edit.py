"""Setting a price by hand on a holding no feed prices.

A USD lending position (USDT-LEND) could not record interest: price refresh
never touches it, and nothing else let the user set its price, so its value sat
at cost. The holding editor now takes a current price for exactly the holdings
refresh leaves alone, and refuses one where the next refresh would overwrite it.

The handler is called directly with the async session, as in
test_sell_endpoint.py: the sync TestClient cannot share the async test session.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import get_settings
from app.modules.portfolio.manual_pricing import is_manually_priced
from app.modules.portfolio.models import HoldingWalletType, Portfolio, PortfolioHolding
from app.modules.portfolio.price_update_service import PriceUpdateService
from app.modules.portfolio.routers.holdings import update_holding
from app.modules.portfolio.schemas import HoldingResponse, HoldingUpdate
from app.modules.transactions.models import (
    CategoryType,
    Transaction,
    TransactionCategory,
)


class TestWhichHoldingsAreManuallyPriced:
    @pytest.mark.parametrize(
        "symbol, asset_type",
        [
            ("USDT-LEND", "crypto"),
            ("USDT-LEND", None),  # the symbol alone is enough
            ("USDC", "lending"),
            ("BTC-USD", "crypto"),
            ("TWD-SAVINGS", "stock"),
            ("CASH", None),
        ],
    )
    def test_holdings_no_feed_prices(self, symbol, asset_type):
        assert is_manually_priced(symbol, asset_type)

    @pytest.mark.parametrize(
        "symbol, asset_type",
        [("AAPL", "stock"), ("0050", "etf"), ("VT", None)],
    )
    def test_quoted_holdings(self, symbol, asset_type):
        assert not is_manually_priced(symbol, asset_type)

    def test_the_response_says_so_in_camel_case(self):
        now = datetime.now(timezone.utc)
        common = dict(
            id=uuid4(), name="x", exchange="X", currency="USD", sector=None,
            region=None, quantity=1, average_cost=1, current_price=1, total_cost=1,
            total_value=1, gain_loss=0, gain_loss_percentage=0, dividend_yield=None,
            annual_dividend=None, is_active=True, last_price_update_at=None,
            created_at=now, updated_at=now,
        )
        lend = HoldingResponse(symbol="USDT-LEND", type="crypto", **common)
        stock = HoldingResponse(symbol="AAPL", type="stock", **common)

        assert lend.model_dump(by_alias=True)["manuallyPriced"] is True
        assert stock.model_dump(by_alias=True)["manuallyPriced"] is False


def test_cost_and_price_keep_ten_decimal_places():
    """A total typed into the editor is stored as total / quantity.

    At four places 10,000 over 10,688.88 units stored 0.9356 and read back as
    10,000.52. SQLite does not enforce NUMERIC scale, so the column definition
    is what can be asserted here; the migration carries it to Postgres.
    """
    columns = PortfolioHolding.__table__.c
    assert columns.average_cost.type.scale == 10
    assert columns.current_price.type.scale == 10


def _lot(portfolio_id, user_id, *, symbol, asset_type, qty, avg, price, currency="USD"):
    return PortfolioHolding(
        id=uuid4(),
        portfolio_id=portfolio_id,
        user_id=user_id,
        symbol=symbol,
        name=symbol,
        type=asset_type,
        exchange="X",
        currency=currency,
        market="US",
        wallet_type=HoldingWalletType.PORTFOLIO,
        quantity=Decimal(qty),
        average_cost=Decimal(avg),
        current_price=Decimal(price),
        total_cost=Decimal(qty) * Decimal(avg),
        total_value=Decimal(qty) * Decimal(price),
        gain_loss=Decimal("0"),
        gain_loss_percentage=Decimal("0"),
        is_active=True,
        purchase_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


async def _seed(session, user_id, specs):
    portfolio = Portfolio(id=uuid4(), user_id=user_id, name="P", currency="USD", is_active=True)
    session.add(portfolio)
    await session.flush()
    lots = [_lot(portfolio.id, user_id, **spec) for spec in specs]
    session.add_all(lots)
    # Committed, as in production: the position exists before the request.
    await session.commit()
    return lots


async def _seed_linked_expense(
    session, user_id, holding_id, *, on, amount="10000",
    type="expense", status="completed",
):
    """The Life Wallet expense that paid for a holding, as the buy path leaves it.

    `on` is a sentinel day, deliberately NOT the answer any test expects. Seeding
    the expected date would let an assertion pass while the ledger-sync block never
    ran at all — a real failure mode here, not a hypothetical: an identity-map
    comparison once made its gate false for every edit.

    `type`/`status` are overridable because holding_id is set on rows that are not
    purchase legs: a cash withdrawal writes an INCOME leg against the same holding.
    """
    category = TransactionCategory(name="Investment Purchase", type=CategoryType.EXPENSE)
    session.add(category)
    await session.flush()

    leg = Transaction(
        user_id=user_id,
        category_id=category.id,
        holding_id=holding_id,
        type=type,
        wallet_type="life",
        amount=Decimal(amount),
        currency="TWD",
        description="Initial purchase",
        transaction_date=on,
        status=status,
    )
    session.add(leg)
    await session.commit()
    return leg


async def _linked_leg(session, holding_id):
    return (
        await session.execute(
            select(Transaction).where(Transaction.holding_id == holding_id)
        )
    ).scalar_one()


@pytest.fixture
def router_warnings():
    """Collect the holdings router's own WARNING records.

    Two things defeat the obvious approaches. `caplog` sees nothing, because
    app/core/logger.py configures the "app" logger with propagate=False and its
    records never reach the root handler pytest attaches. And the logger is not
    named after this module — it arrives through `from ._shared import *`, so it
    is `...routers._shared`. Taking the object off the module under test is
    immune to both.
    """
    import logging

    from app.modules.portfolio.routers import holdings as router_module

    messages = []

    class Collect(logging.Handler):
        def emit(self, record):
            messages.append(record.getMessage())

    logger = router_module.logger
    handler = Collect(level=logging.WARNING)
    previous = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    try:
        yield messages
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous)


@pytest.fixture
def taipei(monkeypatch):
    """Pin the business timezone for a test that asserts on a calendar day.

    `get_settings` is lru_cached, so setenv on its own changes nothing — and a cache
    left warm afterwards leaks Asia/Taipei into whatever runs next.
    """
    monkeypatch.setenv("APP_TIMEZONE", "Asia/Taipei")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.asyncio
@pytest.mark.database
class TestSettingAPrice:
    async def test_editing_does_not_re_date_the_linked_expense(
        self, async_session, test_user, taipei
    ):
        """The edit path must read the day the same way the buy path did.

        A purchase stamped 2026-08-31T20:00Z is 09-01 04:00 in Taipei, so the buy
        books the Life expense on 09-01. Reading `.date()` off the payload here moved
        it back to 08-31 — into the previous month's spending — whenever an edit
        resent the same date. Two paths, two answers, for one purchase.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="100", avg="100", price="100"),
        ])
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15)
        )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                quantity=Decimal("110"),
                purchase_date=datetime(2026, 8, 31, 20, 0, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        row = await _linked_leg(async_session, lot.id)
        # The block ran: it rewrites the description as well as the date.
        assert row.description != "Initial purchase"
        # ...and re-dated by the business day, not the payload's own offset.
        assert row.transaction_date == date(2026, 9, 1)

    async def test_moving_the_purchase_date_alone_moves_the_expense(
        self, async_session, test_user, taipei
    ):
        """A date-only edit is the whole point of the date field, and it did nothing.

        The `linked.transaction_date` assignment sat inside the amount-correction
        branch, gated on `quantity_changed or cost_changed`. So correcting a purchase
        you had recorded on the wrong day moved the holding and left the Life expense
        where it was — in the wrong month, in the wrong month's spending report, with
        the two views of one purchase permanently disagreeing.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="100", avg="100", price="100"),
        ])
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15)
        )

        await update_holding(
            holding_id=lot.id,
            # Nothing but the date. 09-04 20:00Z is 09-05 04:00 in Taipei.
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 4, 20, 0, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        row = await _linked_leg(async_session, lot.id)
        assert row.transaction_date == date(2026, 9, 5)
        # The money did not move, so nothing about the money may be restated —
        # least of all re-converted at today's FX rate.
        assert row.amount == Decimal("10000")
        assert row.description == "Initial purchase"

    async def test_resending_the_same_day_does_not_stomp_a_hand_fixed_ledger_date(
        self, async_session, test_user, taipei
    ):
        """Comparing instants would make every save an edit of the date.

        The editor round-trips the whole purchase timestamp, so a save that changed
        something else entirely still sends one — that is how the re-dating bug got
        in. Here the holding is stamped 2026-08-31T20:00Z and the payload resends
        2026-09-01T02:00Z: the same Taipei day, a different instant.

        The user has since corrected the Life expense itself to 09-15 in the ledger.
        Comparing instants calls the resend a change and overwrites that correction;
        comparing business days leaves it standing, which is why the comparison is
        `business_day_of(...) != previous_purchase_day` and not `!=` on the stamps.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="100", avg="100", price="100"),
        ])
        lot.purchase_date = datetime(2026, 8, 31, 20, 0, tzinfo=timezone.utc)
        await async_session.commit()
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15)
        )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 1, 2, 0, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        row = await _linked_leg(async_session, lot.id)
        assert row.transaction_date == date(2026, 9, 15)
        assert row.description == "Initial purchase"

    async def test_a_quantity_edit_leaves_the_date_where_the_user_put_it(
        self, async_session, test_user, taipei
    ):
        """The false branch of `date_changed`, which nothing covered.

        Correcting a share count says nothing about when the trade happened. The
        seeded sentinel day has to survive — a `linked.transaction_date` assignment
        that ran unconditionally would silently re-date the expense to whatever the
        holding happened to carry.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="100", avg="100", price="100"),
        ])
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15)
        )

        await update_holding(
            holding_id=lot.id,
            # No purchase_date in the payload at all.
            holding_updates=HoldingUpdate(quantity=Decimal("110")),
            current_user=test_user,
            session=async_session,
        )

        row = await _linked_leg(async_session, lot.id)
        # The block ran — the amount was corrected...
        assert row.description != "Initial purchase"
        # ...and the date was left exactly as seeded.
        assert row.transaction_date == date(2026, 9, 15)

    @pytest.mark.parametrize(
        "payload",
        [
            # What `<input type="date">` sends: a bare day, hence midnight.
            datetime(2026, 9, 5, 0, 0),
            # Late enough that treating it as UTC and shifting to Taipei would
            # cross into the 6th. Only this one tells the two readings apart.
            datetime(2026, 9, 5, 20, 0),
        ],
        ids=["midnight", "late-evening"],
    )
    async def test_a_naive_payload_is_read_as_the_day_it_names(
        self, async_session, test_user, taipei, payload
    ):
        """`purchase_date` is Optional[datetime], so a bare day parses NAIVE.

        A naive value was never in another timezone, so there is nothing to convert:
        the day the user typed is the day the ledger gets. Treating it as UTC and
        shifting it into Taipei would silently move a late-evening entry to tomorrow.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="100", avg="100", price="100"),
        ])
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15)
        )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(purchase_date=payload),
            current_user=test_user,
            session=async_session,
        )

        row = await _linked_leg(async_session, lot.id)
        assert row.transaction_date == date(2026, 9, 5)

    async def test_a_holding_with_no_linked_leg_still_saves(
        self, async_session, test_user, taipei, router_warnings
    ):
        """Holdings bought before transactions.holding_id existed have no link.

        The backfill leaves ambiguous ones NULL on purpose, so the ledger-sync block
        finds nothing. Refusing the edit would be worse than a ledger the user can
        correct by hand — but it has to be said out loud, because the wallet is now
        one day out of step with the holding and only the log knows.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="100", avg="100", price="100"),
        ])
        # No _seed_linked_expense at all.

        holding = await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 4, 20, 0, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        assert holding is not None
        # Asserted on the wall clock, not the business day: SQLite drops the offset
        # on the way back out, so a `.astimezone()` here would be reading the test
        # database rather than the code. The ledger-side tests cover the day.
        assert holding.purchase_date.replace(tzinfo=None) == datetime(2026, 9, 4, 20, 0)
        assert any("no linked purchase leg" in m for m in router_warnings), (
            router_warnings
        )
        # The warning names the date, not the amount — nothing about the amount
        # was in play, and a message saying otherwise sends the reader hunting.
        assert any("its date edited" in m for m in router_warnings), router_warnings

    async def test_an_aggregated_lot_moves_every_leg_together(
        self, async_session, test_user, taipei, router_warnings
    ):
        """`?aggregate=true` gives one lot several Life legs, and they all move.

        add_holding bridges every buy separately with the same holding_id, and
        create_or_aggregate_holding only folds a buy into an existing lot when the
        purchase instant matches EXACTLY — so the legs of an aggregated lot all sit
        on one day, and correcting the lot's date has to take all of them. Moving one
        (the old `.first()` on an unordered query) would strand the rest in the old
        month, which is the misattribution this branch exists to stop.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="60", avg="1000", price="1000"),
        ])
        # _lot seeds 2026-01-01T00:00Z, which is 01-01 08:00 in Taipei: the day the
        # bridge would have dated each leg.
        for amount in ("10000", "20000", "30000"):
            await _seed_linked_expense(
                async_session, test_user.id, lot.id,
                on=date(2026, 1, 1), amount=amount,
            )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 4, 20, 0, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        legs = (
            await async_session.execute(
                select(Transaction).where(Transaction.holding_id == lot.id)
            )
        ).scalars().all()
        assert [leg.transaction_date for leg in legs] == [date(2026, 9, 5)] * 3
        # The money did not move, so no leg's amount may be restated.
        assert sorted(leg.amount for leg in legs) == [
            Decimal("10000"), Decimal("20000"), Decimal("30000")
        ]
        assert router_warnings == []

    async def test_cash_withdrawn_against_a_lot_blocks_the_amount_rewrite(
        self, async_session, test_user, taipei, router_warnings
    ):
        """One purchase leg is not one lot total once cash has been taken back out.

        A cash holding in the Emergency wallet books a 100k deposit as an EXPENSE leg
        and a later 30k withdrawal as an INCOME leg against the same holding, leaving
        70k. Correcting the lot to 60k and restating the deposit to 60k leaves the
        30k withdrawal beside it, so Life nets −30k against a 60k holding: 30k of
        asset nobody paid for. The deposit that would actually be right is 90k — the
        new lot plus what was taken back out — which is not what "one leg = one lot
        total" computes.

        Filtering the income row out of the leg query (so that dates stop following
        withdrawals) is what made this reachable: it turned a two-row lot into a
        one-leg lot as far as the rewrite could see.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="TWD-SAVINGS", asset_type="cash", qty="70000", avg="1",
                 price="1", currency="TWD"),
        ])
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15),
            amount="100000",
        )
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 16),
            amount="30000", type="income",
        )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(quantity=Decimal("60000")),
            current_user=test_user,
            session=async_session,
        )

        rows = (
            await async_session.execute(
                select(Transaction)
                .where(Transaction.holding_id == lot.id)
                .order_by(Transaction.amount.desc())
            )
        ).scalars().all()
        deposit, withdrawal = rows
        assert deposit.amount == Decimal("100000")
        assert withdrawal.amount == Decimal("30000")
        assert any(
            "1 purchase leg(s) and 1 offsetting income row(s)" in m
            for m in router_warnings
        ), router_warnings

    async def test_a_withdrawal_blocks_the_amount_but_not_the_date(
        self, async_session, test_user, taipei, router_warnings
    ):
        """The two corrections are independent, and the editor sends both at once.

        Nothing else drives the amount skip and the date move in one request, so a
        regression that let one branch swallow the other would go unnoticed.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="TWD-SAVINGS", asset_type="cash", qty="70000", avg="1",
                 price="1", currency="TWD"),
        ])
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15),
            amount="100000",
        )
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 16),
            amount="30000", type="income",
        )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                quantity=Decimal("60000"),
                purchase_date=datetime(2026, 9, 4, 20, 0, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        rows = (
            await async_session.execute(
                select(Transaction)
                .where(Transaction.holding_id == lot.id)
                .order_by(Transaction.amount.desc())
            )
        ).scalars().all()
        deposit, withdrawal = rows
        # The amount was left alone...
        assert deposit.amount == Decimal("100000")
        # ...the deposit's date still moved...
        assert deposit.transaction_date == date(2026, 9, 5)
        # ...and the withdrawal was not touched at all.
        assert withdrawal.amount == Decimal("30000")
        assert withdrawal.transaction_date == date(2026, 9, 16)
        assert any(
            "1 purchase leg(s) and 1 offsetting income row(s)" in m
            for m in router_warnings
        ), router_warnings

    @pytest.mark.parametrize(
        "kind", ["expense", "income"], ids=["cancelled-expense", "cancelled-income"]
    )
    async def test_a_cancelled_row_does_not_block_the_amount_rewrite(
        self, async_session, test_user, taipei, router_warnings, kind
    ):
        """A cancelled row counts toward no total, so it neither takes a correction
        nor stands in the way of one. Treating it as an offsetting row would leave
        the user's amount edit unreflected for no reason at all.

        The income case is the one that pins the status filter: a cancelled
        WITHDRAWAL would block every amount edit on the lot if `offsetting` looked at
        type alone, and no expense-only test can tell the difference.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="100", avg="100", price="100",
                 currency="TWD"),
        ])
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15),
            amount="10000",
        )
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 3, 3),
            amount="500", type=kind, status="cancelled",
        )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(quantity=Decimal("110")),
            current_user=test_user,
            session=async_session,
        )

        rows = (
            await async_session.execute(
                select(Transaction)
                .where(Transaction.holding_id == lot.id)
                .order_by(Transaction.amount.desc())
            )
        ).scalars().all()
        live, cancelled = rows
        # 110 × 100, the corrected lot total.
        assert live.amount == Decimal("11000")
        assert cancelled.amount == Decimal("500")
        assert cancelled.transaction_date == date(2026, 3, 3)
        assert router_warnings == []

    @pytest.mark.parametrize(
        "kind, extra",
        [
            ("a cash withdrawal's income leg", dict(type="income")),
            ("a cancelled row", dict(status="cancelled")),
        ],
        ids=["income-leg", "cancelled-row"],
    )
    async def test_rows_that_are_not_purchase_legs_are_neither_moved_nor_counted(
        self, async_session, test_user, taipei, router_warnings, kind, extra
    ):
        """holding_id is set on more than the leg that paid for the holding.

        _sync_wallet_transaction writes an INCOME leg against the same holding when
        cash is withdrawn, dated the day of that withdrawal, and a cancelled row
        keeps its link too. Counting them makes a one-leg lot look aggregated — so
        the correction is skipped for the wrong reason — and re-dating them moves a
        withdrawal that has nothing to do with the purchase date.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="100", avg="100", price="100"),
        ])
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 9, 15)
        )
        await _seed_linked_expense(
            async_session, test_user.id, lot.id, on=date(2026, 3, 3),
            amount="500", **extra,
        )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 4, 20, 0, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        rows = (
            await async_session.execute(
                select(Transaction)
                .where(Transaction.holding_id == lot.id)
                .order_by(Transaction.amount.desc())
            )
        ).scalars().all()
        purchase, other = rows
        # Treated as the single leg it is: it moved.
        assert purchase.transaction_date == date(2026, 9, 5)
        # And the other row was left exactly where it was, in its own month.
        assert other.transaction_date == date(2026, 3, 3), kind
        assert router_warnings == []

    async def test_several_legs_agreeing_on_another_day_are_left_for_a_person(
        self, async_session, test_user, taipei, router_warnings
    ):
        """Two readings of the same rows, and no way here to tell them apart.

        Legs agreeing on a day the holding does not claim can be drift from the bug
        fixed above — which moved `purchase_date` and left the ledger behind — or two
        genuine buys that merged into an older lot: `?aggregate=true` with no
        purchase_date merges into the most recent lot whatever its date, and dates
        the new leg today. Moving them assumes the first reading; if the second is
        true it takes two real September purchases out of September.

        So they stay, named in the log, and
        scripts/prod_sql/2026_09_25_realign_drifted_holding_legs.sql repairs the
        drifted ones with a person looking at the rows. A single leg is different and
        does move: one holding, one leg, one purchase, nothing to weigh.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="60", avg="1000", price="1000"),
        ])
        # The holding says 2026-01-01 (from _lot); both legs say 09-01.
        for amount in ("30000", "30000"):
            await _seed_linked_expense(
                async_session, test_user.id, lot.id,
                on=date(2026, 9, 1), amount=amount,
            )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 20, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        legs = (
            await async_session.execute(
                select(Transaction).where(Transaction.holding_id == lot.id)
            )
        ).scalars().all()
        assert [leg.transaction_date for leg in legs] == [date(2026, 9, 1)] * 2
        assert any(
            "none of them on the day being corrected" in m for m in router_warnings
        ), router_warnings

    async def test_two_claimed_legs_move_and_the_third_is_reported(
        self, async_session, test_user, taipei, router_warnings
    ):
        """Several legs on the claimed day, not just one: all of them follow."""
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="60", avg="1000", price="1000"),
        ])
        # 2026-01-01 is the holding's own business day; 09-02 is not.
        for day in (date(2026, 1, 1), date(2026, 1, 1), date(2026, 9, 2)):
            await _seed_linked_expense(
                async_session, test_user.id, lot.id, on=day, amount="20000"
            )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 20, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        legs = (
            await async_session.execute(
                select(Transaction).where(Transaction.holding_id == lot.id)
            )
        ).scalars().all()
        assert sorted(leg.transaction_date for leg in legs) == [
            date(2026, 9, 2), date(2026, 9, 20), date(2026, 9, 20)
        ]
        assert any("moved 2 of 3" in m for m in router_warnings), router_warnings

    async def test_a_leg_on_the_claimed_day_moves_and_the_others_are_reported(
        self, async_session, test_user, taipei, router_warnings
    ):
        """Mixed days: the leg the holding claims follows, the rest are named.

        Leaving all of them — the earlier behaviour here — stranded the one leg that
        demonstrably belongs to the date being corrected. Moving all of them would
        flatten two real purchase days into one.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="60", avg="1000", price="1000"),
        ])
        # 2026-01-01 is the holding's own business day; the others are not.
        for day in (date(2026, 1, 1), date(2026, 9, 2), date(2026, 9, 3)):
            await _seed_linked_expense(
                async_session, test_user.id, lot.id, on=day, amount="20000"
            )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 20, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        legs = (
            await async_session.execute(
                select(Transaction).where(Transaction.holding_id == lot.id)
            )
        ).scalars().all()
        assert sorted(leg.transaction_date for leg in legs) == [
            date(2026, 9, 2), date(2026, 9, 3), date(2026, 9, 20)
        ]
        assert any(
            "moved 1 of 3" in m and "2026-09-02" in m for m in router_warnings
        ), router_warnings

    async def test_an_amount_and_date_edit_together_still_moves_the_date(
        self, async_session, test_user, taipei, router_warnings
    ):
        """The two corrections are independent, and one being skipped must not take
        the other with it. The editor sends both in a single save.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="60", avg="1000", price="1000",
                 currency="TWD"),
        ])
        for amount in ("30000", "30000"):
            await _seed_linked_expense(
                async_session, test_user.id, lot.id,
                on=date(2026, 1, 1), amount=amount,
            )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                average_cost=Decimal("1100"),
                purchase_date=datetime(2026, 9, 20, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        legs = (
            await async_session.execute(
                select(Transaction).where(Transaction.holding_id == lot.id)
            )
        ).scalars().all()
        # The date moved...
        assert [leg.transaction_date for leg in legs] == [date(2026, 9, 20)] * 2
        # ...and the amounts did not, with the skip reported.
        assert [leg.amount for leg in legs] == [Decimal("30000"), Decimal("30000")]
        assert any(
            "2 purchase leg(s) and 0 offsetting income row(s)" in m
            for m in router_warnings
        ), router_warnings

    async def test_legs_on_days_the_holding_does_not_claim_are_left_alone(
        self, async_session, test_user, taipei, router_warnings
    ):
        """Aggregating with no purchase_date at all merges into the most recent lot.

        That path (repositories.py, the `elif aggregate:` branch) ignores dates, so a
        lot can end up with legs on days it does not claim. Collapsing them onto one
        day would erase purchases the user really recorded on those days, and picking
        one of them is guesswork — so they stay, loudly.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="0050", asset_type="etf", qty="60", avg="1000", price="1000"),
        ])
        for day in (date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3)):
            await _seed_linked_expense(
                async_session, test_user.id, lot.id, on=day, amount="20000"
            )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                purchase_date=datetime(2026, 9, 10, tzinfo=timezone.utc),
            ),
            current_user=test_user,
            session=async_session,
        )

        legs = (
            await async_session.execute(
                select(Transaction).where(Transaction.holding_id == lot.id)
            )
        ).scalars().all()
        assert sorted(leg.transaction_date for leg in legs) == [
            date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3)
        ]
        # Silence would leave the user with a ledger that quietly disagrees.
        assert any(
            "does not claim" in m and "2026-09-01" in m for m in router_warnings
        ), router_warnings
        # The holding itself still took the edit.
        await async_session.refresh(lot)
        assert lot.purchase_date.replace(tzinfo=None) == datetime(2026, 9, 10)

    async def test_an_amount_edit_on_an_aggregated_lot_is_skipped_and_named(
        self, async_session, test_user, taipei, router_warnings
    ):
        """The legs already sum to the old total, so no single one can take the new one.

        Writing the whole-lot figure onto one leg double counts — 10k+20k+30k became
        66k+20k+30k under the old `.first()`. Splitting it across them would invent
        per-buy prices the lot no longer holds: it keeps one average cost, not a price
        per buy. So the rows stay as entered and the log names the gap, because a
        ledger that silently disagrees with the cost basis is the worse outcome.
        """
        (lot,) = await _seed(async_session, test_user.id, [
            # TWD, so the gap below is 60×1100 − 60,000 and not that figure through
            # whatever USD rate the fixture database happens to carry.
            dict(symbol="0050", asset_type="etf", qty="60", avg="1000", price="1000",
                 currency="TWD"),
        ])
        for amount in ("10000", "20000", "30000"):
            await _seed_linked_expense(
                async_session, test_user.id, lot.id,
                on=date(2026, 1, 1), amount=amount,
            )

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(average_cost=Decimal("1100")),
            current_user=test_user,
            session=async_session,
        )

        legs = (
            await async_session.execute(
                select(Transaction).where(Transaction.holding_id == lot.id)
            )
        ).scalars().all()
        assert sorted(leg.amount for leg in legs) == [
            Decimal("10000"), Decimal("20000"), Decimal("30000")
        ]
        # 60 × 1000 → 60 × 1100, named in the holding's own currency: a TWD delta
        # against the legs would fold in the FX drift between the booking rate and
        # today's, and say nothing at all for a currency _to_twd cannot convert.
        assert any(
            "60000 → 66000 TWD" in m for m in router_warnings
        ), router_warnings
        # The holding itself still took the edit.
        await async_session.refresh(lot)
        assert lot.average_cost == Decimal("1100")

    async def test_a_lending_position_takes_a_price_and_revalues(self, async_session, test_user):
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="USDT-LEND", asset_type="crypto", qty="10000", avg="1", price="1"),
        ])

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(current_price=Decimal("1.068888")),
            current_user=test_user,
            session=async_session,
        )

        await async_session.refresh(lot)
        assert lot.current_price == Decimal("1.068888")
        assert lot.total_value == pytest.approx(Decimal("10688.88"))
        assert lot.gain_loss == pytest.approx(Decimal("688.88"))
        assert lot.last_price_update_at is not None

    async def test_the_price_lands_on_every_lot_of_the_symbol(self, async_session, test_user):
        edited, other = await _seed(async_session, test_user.id, [
            dict(symbol="USDT-LEND", asset_type="crypto", qty="6000", avg="1", price="1"),
            dict(symbol="USDT-LEND", asset_type="crypto", qty="4000", avg="1", price="1"),
        ])

        await update_holding(
            holding_id=edited.id,
            holding_updates=HoldingUpdate(current_price=Decimal("1.05")),
            current_user=test_user,
            session=async_session,
        )

        await async_session.refresh(other)
        # One price per security: the holding view reads a single price for all
        # lots, so a lot left at 1.00 would disagree with the card above it.
        assert other.current_price == Decimal("1.05")
        assert other.total_value == pytest.approx(Decimal("4200"))

    async def test_a_quoted_holding_refuses_a_hand_set_price(self, async_session, test_user):
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="AAPL", asset_type="stock", qty="10", avg="150", price="150"),
        ])

        with pytest.raises(HTTPException) as exc:
            await update_holding(
                holding_id=lot.id,
                holding_updates=HoldingUpdate(current_price=Decimal("999")),
                current_user=test_user,
                session=async_session,
            )

        assert exc.value.status_code == 400
        await async_session.refresh(lot)
        assert lot.current_price == Decimal("150")

    async def test_a_total_cost_entered_as_cost_per_unit_updates_the_totals(
        self, async_session, test_user
    ):
        (lot,) = await _seed(async_session, test_user.id, [
            dict(symbol="USDT-LEND", asset_type="crypto", qty="10688.88", avg="1", price="1"),
        ])

        await update_holding(
            holding_id=lot.id,
            holding_updates=HoldingUpdate(
                average_cost=Decimal("10000") / Decimal("10688.88"),
            ),
            current_user=test_user,
            session=async_session,
        )

        await async_session.refresh(lot)
        assert lot.total_cost == pytest.approx(Decimal("10000"), abs=Decimal("0.01"))
        assert lot.gain_loss == pytest.approx(Decimal("688.88"), abs=Decimal("0.01"))


@pytest.mark.asyncio
@pytest.mark.database
async def test_price_refresh_leaves_a_hand_set_price_alone(async_session, test_user):
    (lot,) = await _seed(async_session, test_user.id, [
        dict(symbol="USDC", asset_type="lending", qty="100", avg="1", price="1.02"),
    ])

    with patch.object(
        PriceUpdateService, "update_holding_price", autospec=True,
        side_effect=AssertionError("a manually priced holding was sent to the feed"),
    ):
        stats = await PriceUpdateService(async_session).update_portfolio_prices(
            test_user.id, force=True
        )

    await async_session.refresh(lot)
    assert lot.current_price == Decimal("1.02")
    assert stats["failed"] == 0
