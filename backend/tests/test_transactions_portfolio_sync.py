"""Editing/deleting a 'Buy …' expense must follow through to its holding."""

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.modules.transactions.router import (
    _parse_buy_description,
    _sync_portfolio_on_delete,
    _sync_portfolio_on_update,
)

pytestmark = pytest.mark.unit

D = Decimal
UID = uuid4()
DESC = "Buy 0050 ×10 @ 150.5 TWD"


def txn(desc=DESC, cat=None, when=datetime(2026, 3, 5, tzinfo=timezone.utc), user=UID):
    return SimpleNamespace(
        description=desc, transaction_date=when, user_id=user,
        category_obj=SimpleNamespace(name=cat) if cat else None)


def holding():
    return SimpleNamespace(
        id=uuid4(), is_active=True, updated_at=None, quantity=D("1"), average_cost=D("1"),
        current_price=D("200"), total_cost=D("1"), total_value=D("1"), gain_loss=D("0"),
        gain_loss_percentage=D("0"), purchase_date=None)


def fake_db(found=None, execute_exc=None):
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = found
    db.execute = AsyncMock(side_effect=execute_exc) if execute_exc else AsyncMock(return_value=result)
    db.commit = AsyncMock()

    async def gen():
        yield db
    return db, patch("app.core.database.get_db", side_effect=gen)


class TestParseBuyDescription:
    @pytest.mark.parametrize("desc,expected", [
        (DESC, ("0050", 10.0, 150.5, "TWD")),
        ("Buy VT ×2.5 @ 1,234.50 USD (note)", ("VT", 2.5, 1234.5, "USD")),
        ("  Buy BTC-USD ×0.1 @ 60000 USD  ", ("BTC-USD", 0.1, 60000.0, "USD")),
    ])
    def test_parses(self, desc, expected):
        assert _parse_buy_description(desc) == expected

    @pytest.mark.parametrize("desc", ["", None, "Sell 0050 ×1 @ 1 TWD", "Buy 0050", "Buy 0050 x10 @ 1 TWD"])
    def test_rejects(self, desc):
        assert _parse_buy_description(desc) is None

    def test_malformed_number_is_none_not_error(self):
        assert _parse_buy_description("Buy A ×1.2.3 @ 5 TWD") is None


@pytest.mark.asyncio
class TestOnDelete:
    async def test_deactivates_the_matching_holding(self):
        h = holding()
        db, p = fake_db(h)
        with p:
            await _sync_portfolio_on_delete(txn())
        assert h.is_active is False and h.updated_at is not None
        db.commit.assert_awaited_once()

    async def test_category_alone_is_not_enough_the_text_must_still_parse(self):
        h = holding()
        _, p = fake_db(h)
        with p as get_db:
            await _sync_portfolio_on_delete(txn(desc="Index fund top-up", cat="Investment Purchase"))
        get_db.assert_not_called()
        assert h.is_active is True

    async def test_no_match_commits_nothing(self):
        db, p = fake_db(None)
        with p:
            await _sync_portfolio_on_delete(txn())
        db.commit.assert_not_awaited()

    @pytest.mark.parametrize("t", [
        None,
        txn(desc="Lunch"),
        txn(desc="Lunch", cat="Food"),
        txn(desc="Buy nonsense"),
        txn(when=None),
        txn(user=None),
    ])
    async def test_ineligible_transactions_never_open_a_session(self, t):
        db, p = fake_db(holding())
        with p as get_db:
            await _sync_portfolio_on_delete(t)
        get_db.assert_not_called()

    async def test_date_only_values_are_accepted(self):
        h = holding()
        _, p = fake_db(h)
        with p:
            await _sync_portfolio_on_delete(txn(when=date(2026, 3, 5)))
        assert h.is_active is False

    async def test_database_errors_are_swallowed(self):
        _, p = fake_db(execute_exc=RuntimeError("boom"))
        with p:
            await _sync_portfolio_on_delete(txn())  # must not raise

    async def test_session_acquisition_errors_are_swallowed(self):
        with patch("app.core.database.get_db", side_effect=RuntimeError("no pool")):
            await _sync_portfolio_on_delete(txn())


@pytest.mark.asyncio
class TestOnUpdate:
    async def test_recomputes_cost_value_and_gain(self):
        h = holding()
        db, p = fake_db(h)
        new = txn("Buy 0050 ×20 @ 100 TWD", when=datetime(2026, 4, 1, tzinfo=timezone.utc))
        with p:
            await _sync_portfolio_on_update(txn(), new)
        assert (h.quantity, h.average_cost) == (D("20"), D("100"))
        assert h.total_cost == D("2000") and h.total_value == D("4000")
        assert h.gain_loss == D("2000") and h.gain_loss_percentage == D("100")
        assert h.purchase_date == datetime(2026, 4, 1, tzinfo=timezone.utc)
        db.commit.assert_awaited_once()

    async def test_date_only_new_date_becomes_utc_midnight(self):
        h = holding()
        _, p = fake_db(h)
        with p:
            await _sync_portfolio_on_update(txn(), txn("Buy 0050 ×1 @ 1 TWD", when=date(2026, 4, 1)))
        assert h.purchase_date == datetime(2026, 4, 1, tzinfo=timezone.utc)

    async def test_missing_new_date_keeps_purchase_date(self):
        h = holding()
        _, p = fake_db(h)
        with p:
            await _sync_portfolio_on_update(txn(), txn("Buy 0050 ×1 @ 1 TWD", when=None))
        assert h.purchase_date is None

    async def test_zero_cost_gives_zero_percent_not_division_error(self):
        h = holding()
        _, p = fake_db(h)
        with p:
            await _sync_portfolio_on_update(txn(), txn("Buy 0050 ×1 @ 0 TWD"))
        assert h.gain_loss_percentage == D("0")

    async def test_new_description_falls_back_to_old(self):
        h = holding()
        _, p = fake_db(h)
        with p:
            await _sync_portfolio_on_update(txn(), SimpleNamespace(description=None, transaction_date=None))
        assert h.quantity == D("10")

    @pytest.mark.parametrize("old,new", [
        (None, txn()),
        (txn(desc="Lunch"), txn()),
        (txn(desc="Buy nonsense"), txn()),
        (txn(), txn("Buy nonsense")),
        (txn(), txn("Buy VT ×1 @ 1 USD")),   # symbol changed: not this helper's job
        (txn(when=None), txn()),
        (txn(user=None), txn()),
    ])
    async def test_ineligible_edits_never_open_a_session(self, old, new):
        _, p = fake_db(holding())
        with p as get_db:
            await _sync_portfolio_on_update(old, new)
        get_db.assert_not_called()

    async def test_no_match_and_errors_are_quiet(self):
        db, p = fake_db(None)
        with p:
            await _sync_portfolio_on_update(txn(), txn())
        db.commit.assert_not_awaited()
        _, p = fake_db(execute_exc=RuntimeError("boom"))
        with p:
            await _sync_portfolio_on_update(txn(), txn())
        with patch("app.core.database.get_db", side_effect=RuntimeError("x")):
            await _sync_portfolio_on_update(txn(), txn())
