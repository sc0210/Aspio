"""Unit tests for the background scheduler module."""

import pytest


@pytest.mark.unit
def test_scheduler_user_is_sqlalchemy_model():
    """Scheduler jobs query select(User.id) — User must be the ORM model.

    Regression: `from app.auth.models import User` bound the Pydantic schema
    instead, so the nightly wallet-snapshot job crashed with
    `AttributeError: id` on every run.
    """
    from app.core.scheduler import User

    assert hasattr(User, "__table__"), (
        "app.core.scheduler must import the SQLAlchemy User model, "
        "not the Pydantic schema"
    )
    User.id  # raises AttributeError on the Pydantic class


@pytest.mark.unit
@pytest.mark.parametrize(
    "symbol,markets,expected",
    [
        # Regression: holdings disagreed about "0050" (one row TW, one US) and
        # the old dict comprehension let row order pick the provider. Routing
        # it to the US provider 404s, leaving a hole in the price history that
        # surfaces as a wrong day-change percentage on the portfolio page.
        ("0050", {"TW", "US"}, "TW"),
        ("2330", {"TW", "US"}, "TW"),
        # A Yahoo-suffixed TW ticker mislabelled market="US" is still TW.
        ("0050.TW", {"US"}, "TW"),
        ("2317.TW", {"US"}, "TW"),
        # Unambiguous labels pass through untouched.
        ("AAPL", {"US"}, "US"),
        ("BTC", {"CRYPTO"}, "CRYPTO"),
        ("USDT-LEND", {"SG"}, "SG"),
        # Ambiguous non-TW symbol: prefer the exchange-specific label over the
        # "US" default that an unset market falls back to.
        ("GRAB", {"US", "SG"}, "SG"),
    ],
)
def test_resolve_symbol_market(symbol, markets, expected):
    from app.modules.portfolio.market_data_service import resolve_symbol_market

    assert resolve_symbol_market(symbol, markets) == expected


@pytest.mark.unit
def test_previous_close_prefers_stored_over_history():
    """The provider's previous close wins over the one we derive ourselves.

    Regression: the router unconditionally overwrote previous_close with the
    historical-table lookup. That table is only as complete as the nightly
    sync — 0050 was missing 2026-08-13, so the page reported +1.14% against a
    2-day-old close while public quotes showed -0.28%.
    """
    from decimal import Decimal
    from app.modules.portfolio.routers.portfolio_root import _pick_previous_close

    stored, from_history = Decimal("106.65"), Decimal("105.20")

    assert _pick_previous_close(stored, from_history) == stored
    # Falls back only when nothing was captured from the quote.
    assert _pick_previous_close(None, from_history) == from_history
    # A zero/unset column must not mask the fallback.
    assert _pick_previous_close(Decimal("0"), from_history) == from_history
    assert _pick_previous_close(None, None) is None
