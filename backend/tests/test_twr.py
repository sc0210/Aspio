"""Time-weighted return against hand-computed cases.

The old implementation scored a purchase as a return (a NT$100k buy into a
NT$100k portfolio read as +100%). These fixtures pin the opposite: trading on a
day contributes nothing, only price and currency moves do.
"""

from datetime import date, timedelta
from decimal import Decimal as D

import pytest

from app.modules.portfolio.twr import MIN_DAYS_TO_ANNUALISE, Trade, compute_twr

pytestmark = pytest.mark.unit

d1 = date(2026, 3, 2)


def day(n: int) -> date:
    return d1 + timedelta(days=n - 1)


def buy(sym, n, qty, price, cur="TWD"):
    return Trade(sym, day(n), D(qty), cur, D(price))


def sell(sym, n, qty, price, cur="TWD"):
    return Trade(sym, day(n), -D(qty), cur, D(price))


def closes(sym, *pairs):
    return {sym: {day(n): D(p) for n, p in pairs}}


def test_price_move_is_the_return():
    r = compute_twr([buy("A", 1, 10, 100)], closes("A", (1, 100), (2, 110)), {}, day(1), day(2))
    assert r.twr == D("0.1")


def test_a_deposit_is_not_a_return():
    trades = [buy("A", 1, 10, 100), buy("A", 3, 10, 110)]
    px = closes("A", (1, 100), (2, 110), (3, 110), (4, 121))
    r = compute_twr(trades, px, {}, day(1), day(4))
    # +10% on day 2, 0% on the buy day, +10% on day 4: 1.1 × 1.1 − 1.
    assert r.twr == D("0.21")
    assert [row[3] for row in r.series] == [None, D("0.1"), D("0"), D("0.1")]


def test_a_sale_is_not_a_loss():
    trades = [buy("A", 1, 10, 100), sell("A", 3, 5, 110)]
    px = closes("A", (1, 100), (2, 110), (3, 110), (4, 99))
    r = compute_twr(trades, px, {}, day(1), day(4))
    # +10%, 0% on the sale day, then −10% on what is left.
    assert r.twr == D("1.1") * D("0.9") - 1


def test_a_usd_holding_earns_the_currency_move():
    trades = [buy("VT", 1, 10, 100, "USD")]
    px = closes("VT", (1, 100), (2, 100))
    fx = {"USD": {day(1): D("30"), day(2): D("33")}}
    r = compute_twr(trades, px, fx, day(1), day(2))
    assert r.twr == D("0.1")
    assert r.coverage.fx_fallback == 0


def test_mixed_currencies_are_weighted_in_twd():
    trades = [buy("TW", 1, 1000, 100), buy("US", 1, 10, 100, "USD")]  # 100k TWD + 1k USD×30 = 30k TWD
    px = {**closes("TW", (1, 100), (2, 100)), **closes("US", (1, 100), (2, 113))}
    fx = {"USD": {day(1): D("30"), day(2): D("30")}}
    r = compute_twr(trades, px, fx, day(1), day(2))
    # Only the US leg moved: 30k × 13% = 3,900 on 130k.
    assert r.twr == D("3900") / D("130000")


def test_missing_closes_carry_forward_and_are_counted():
    trades = [buy("A", 1, 10, 100)]
    # No close stored until day 3; days 1–2 fall back to the trade price.
    r = compute_twr(trades, closes("A", (3, 120)), {}, day(1), day(3))
    assert r.twr == D("0.2")
    assert r.coverage.trade_price == 2
    assert r.coverage.valuations == 3
    assert r.coverage.real_share == pytest.approx(1 / 3)


def test_stale_closes_are_counted():
    r = compute_twr([buy("A", 1, 1, 100)], closes("A", (1, 100)), {}, day(1), day(10))
    assert r.twr == 0
    assert r.coverage.stale == 10 - 1 - 5  # days 7..10 are more than five days old


def test_a_position_opened_before_the_window_is_the_starting_value():
    trades = [buy("A", 1, 10, 100)]
    px = closes("A", (1, 100), (4, 100), (5, 105))
    r = compute_twr(trades, px, {}, day(5), day(5))
    assert r.twr == D("0.05")


def test_annualised_only_over_a_year():
    trades = [buy("A", 1, 1, 100)]
    short = compute_twr(trades, closes("A", (1, 100), (30, 110)), {}, day(1), day(30))
    assert short.annualized is None
    end = MIN_DAYS_TO_ANNUALISE * 2
    long = compute_twr(trades, closes("A", (1, 100), (end, 121)), {}, day(1), day(end))
    # 21% over two years is 10% a year.
    assert float(long.annualized) == pytest.approx(0.1, abs=0.002)


def test_nothing_held_is_zero_not_an_error():
    r = compute_twr([], {}, {}, day(1), day(3))
    assert r.twr == 0
    assert r.coverage.real_share == 1.0


class _Row:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _lot(id, sym, qty, active=True, cur="TWD", cost=100, purchased=None):
    return _Row(id=id, symbol=sym, currency=cur, quantity=D(qty), average_cost=D(cost),
                purchase_date=purchased or day(1), is_active=active)


def _txn(hid, typ, qty, n, sym="A", price=100):
    return _Row(holding_id=hid, symbol=sym, type=typ, quantity=D(qty), price=D(price),
                currency="TWD", transaction_date=day(n))


def _units_today(trades):
    out = {}
    for t in trades:
        out[t.symbol] = out.get(t.symbol, D(0)) + t.quantity
    return out


def test_closed_lots_with_quantity_are_duplicates_not_holdings():
    from app.modules.portfolio.twr import build_trades

    # The real shape: one open lot, and the same purchase re-imported and closed many times.
    lots = [_lot("open", "0050", 908)] + [_lot(f"dup{i}", "0050", 908, active=False) for i in range(5)]
    ledger = [_txn(l.id, "buy", 908, 1) for l in lots]
    trades, rec = build_trades(lots, ledger, lambda x: x)
    assert _units_today(trades) == {"0050": D(908)}
    assert rec.ignored_closed_lots == 5


def test_a_partial_fifo_sale_is_put_back_on_the_oldest_open_lot():
    from app.modules.portfolio.twr import build_trades

    # Bought 10 on day 1 and 10 on day 3; sold 14 on day 5 (FIFO: all of lot 1, 4 of lot 2).
    lots = [_lot("l1", "A", 0, active=False, purchased=day(1)), _lot("l2", "A", 6, purchased=day(3))]
    ledger = [_txn("l1", "buy", 10, 1), _txn("l2", "buy", 10, 3), _txn("l2", "sell", 14, 5, price=120)]
    trades, rec = build_trades(lots, ledger, lambda x: x)
    held = lambda n: sum((t.quantity for t in trades if t.day <= day(n)), D(0))
    assert (held(1), held(3), held(5)) == (D(10), D(20), D(6))
    assert rec.mismatched_symbols == [] and rec.unknown_sold_lots == 0


def test_only_the_measured_lots_count():
    from app.modules.portfolio.twr import build_trades

    lots = [_lot("a", "VT", 3, cur="USD"), _lot("cash", "CASH-TWD", 270000)]
    trades, rec = build_trades(lots, [], lambda x: x, include=lambda l: l.symbol != "CASH-TWD")
    assert _units_today(trades) == {"VT": D(3)}
    assert rec.excluded_lots == 1


def test_a_stale_fx_rate_is_counted():
    trades = [buy("VT", 1, 1, 100, "USD")]
    r = compute_twr(trades, closes("VT", *[(n, 100) for n in range(1, 11)]), {"USD": {day(1): D("30")}}, day(1), day(10))
    assert r.coverage.fx_stale == 4  # days 7..10


def test_before_the_fx_history_starts_the_nearest_stored_rate_is_used_not_todays():
    trades = [buy("VT", 1, 1, 100, "USD")]
    px = closes("VT", (1, 100), (2, 100), (3, 100))
    fx = {"USD": {day(3): D("30")}}  # history starts on day 3
    r = compute_twr(trades, px, fx, day(1), day(3), fx_fallback={"USD": D("32")})
    assert r.twr == 0  # no fake currency move on the day history begins
    assert r.coverage.fx_fallback == 2


def test_annualised_over_the_time_invested_not_the_window():
    end = MIN_DAYS_TO_ANNUALISE + 1
    trades = [Trade("A", day(end), D(1), "TWD", D(100))]
    px = closes("A", (end, 100))
    r = compute_twr(trades, px, {}, day(1), day(end))
    assert r.annualized is None  # one day invested, however long the window


def test_a_sale_on_a_lot_later_soft_deleted_still_counts():
    from app.modules.portfolio.twr import build_trades

    lots = [_lot("sold", "A", 0, active=False, purchased=day(1)), _lot("clicked", "A", 5, active=False, purchased=day(2)),
            _lot("open", "A", 5, purchased=day(2))]
    ledger = [_txn("sold", "buy", 10, 1), _txn("clicked", "sell", 10, 3)]
    trades, rec = build_trades(lots, ledger, lambda x: x)
    assert _units_today(trades) == {"A": D(5)}
    assert rec.ignored_closed_lots == 1 and rec.mismatched_symbols == []


# ─── lot_irr: a lot's own annualised return ─────────────────────────────────

from datetime import datetime, timezone

from app.modules.portfolio.return_calculator import lot_irr


def test_lot_irr_is_the_lots_own_cagr():
    bought = datetime(2024, 1, 5, tzinfo=timezone.utc)
    now = datetime(2026, 1, 5, tzinfo=timezone.utc)
    # Doubled in two years: (2)^(1/2) − 1 ≈ 41.4%.
    assert float(lot_irr(D("10000"), D("20000"), bought, now)) == pytest.approx(2 ** (1 / 2.0) - 1, abs=0.002)


def test_lot_irr_is_none_under_a_year_and_without_cost_or_date():
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    assert lot_irr(D("30474"), D("30914"), datetime(2026, 8, 25, tzinfo=timezone.utc), now) is None
    assert lot_irr(D("0"), D("100"), datetime(2020, 1, 1, tzinfo=timezone.utc), now) is None
    assert lot_irr(D("100"), D("100"), None, now) is None


def test_lot_irr_matches_the_real_2317_lot():
    # Stored as +2,105.6% from the symbol-wide ledger; its own numbers say ~37%.
    r = lot_irr(D("10410"), D("24950"), datetime(2024, 1, 5, tzinfo=timezone.utc), datetime(2026, 10, 8, tzinfo=timezone.utc))
    assert 0.35 < float(r) < 0.40
