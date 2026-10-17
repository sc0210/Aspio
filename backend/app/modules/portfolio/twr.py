"""Time-weighted return — pure arithmetic, no database.

TWR answers "how did the investments do", with the timing and size of your own
deposits taken out. Buying NT$100k of stock is not a 100% return; it is a cash
flow. So each day is scored on price movement alone:

    r_d = (V_d - CF_d) / V_{d-1} - 1        TWR = Π (1 + r_d) - 1

where V_d is the end-of-day value of what you held, and CF_d is the value of the
units bought minus units sold that day, priced at that day's close. Valuing the
flow at the same price as the holding means a day's trading contributes exactly
zero return, and only price changes move the chain.

Everything is valued in TWD at that day's exchange rate, so a USD holding's
return includes the currency move, which is what a TWD investor actually got.

Units come from the trade ledger (buys minus sells to date), not from today's
lot quantities. A lot stores only what is left of it, so reading it backwards
would rewrite every day before a sale.

Missing data is carried forward, never invented: a symbol with no close on a
day uses its last close; before its first stored close it uses the trade price
it was bought at. Every such stand-in is counted, so the caller can say how
much of the window rests on real prices instead of looking authoritative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Dict, List, Mapping, Optional, Sequence

ZERO = Decimal("0")
ONE = Decimal("1")

# A close older than this counts as stale rather than real. Weekends and
# holidays alone leave up to four days between sessions.
STALE_AFTER_DAYS = 5

# Annualising a few months turns a good quarter into a fantasy rate.
MIN_DAYS_TO_ANNUALISE = 365


@dataclass(frozen=True)
class Trade:
    symbol: str
    day: date
    #: Positive for a buy, negative for a sell.
    quantity: Decimal
    #: Currency the symbol is priced in.
    currency: str
    #: Price paid or received — stands in before the symbol's first stored close.
    price: Decimal


@dataclass
class Coverage:
    #: (symbol, day) valuations made, for symbols with units held.
    valuations: int = 0
    #: …of which used a close older than STALE_AFTER_DAYS.
    stale: int = 0
    #: …of which had no stored close at all yet, so used the trade price.
    trade_price: int = 0
    #: Day-valuations of a non-TWD holding with no stored FX rate yet.
    fx_fallback: int = 0
    #: …or whose latest stored rate was older than STALE_AFTER_DAYS.
    fx_stale: int = 0
    symbols_without_prices: List[str] = field(default_factory=list)

    @property
    def real_share(self) -> float:
        """Share of valuations that rested on a recent, real close."""
        if self.valuations == 0:
            return 1.0
        return 1 - (self.stale + self.trade_price) / self.valuations


@dataclass
class TwrResult:
    twr: Decimal
    #: None below MIN_DAYS_TO_ANNUALISE.
    annualized: Optional[Decimal]
    start: date
    end: date
    #: (day, value in TWD, cash flow in TWD, daily return or None).
    series: List[tuple]
    coverage: Coverage


class _Forward:
    """A day-keyed series read with carry-forward."""

    def __init__(self, points: Mapping[date, Decimal]):
        self._days = sorted(points)
        self._points = points
        self._i = -1

    def at(self, day: date) -> Optional[tuple]:
        """(value, age in days) of the latest point on or before `day`. Days must be asked in order."""
        while self._i + 1 < len(self._days) and self._days[self._i + 1] <= day:
            self._i += 1
        if self._i < 0:
            return None
        d = self._days[self._i]
        return self._points[d], (day - d).days

    def first(self) -> Optional[Decimal]:
        return self._points[self._days[0]] if self._days else None


def compute_twr(
    trades: Sequence[Trade],
    prices: Mapping[str, Mapping[date, Decimal]],
    fx_to_twd: Mapping[str, Mapping[date, Decimal]],
    start: date,
    end: date,
    fx_fallback: Optional[Mapping[str, Decimal]] = None,
) -> TwrResult:
    """TWR over [start, end], both inclusive, valued daily in TWD.

    `fx_to_twd[currency][day]` is how many TWD one unit of the currency buys;
    TWD itself needs no entry. `fx_fallback` is used for a currency before (or
    without) any stored rate, and every use is counted.
    """
    fx_fallback = fx_fallback or {}
    trades = sorted(trades, key=lambda t: t.day)
    currency = {t.symbol: t.currency for t in trades}
    first_trade_price: Dict[str, Decimal] = {}
    for t in trades:
        if t.quantity > 0 and t.symbol not in first_trade_price:
            first_trade_price[t.symbol] = t.price

    price_series = {s: _Forward(prices.get(s, {})) for s in currency}
    fx_series = {c: _Forward(fx_to_twd.get(c, {})) for c in set(currency.values()) if c != "TWD"}
    coverage = Coverage(symbols_without_prices=sorted(s for s in currency if not prices.get(s)))

    units: Dict[str, Decimal] = {}
    i = 0
    # Everything traded before the window is the opening position.
    while i < len(trades) and trades[i].day < start:
        units[trades[i].symbol] = units.get(trades[i].symbol, ZERO) + trades[i].quantity
        i += 1

    # Advance every series to the day before the window, so the opening value
    # is priced as of the close before it.
    def value_on(day: date, count: bool) -> Dict[str, Decimal]:
        """TWD price of one unit of each traded symbol on `day`."""
        out: Dict[str, Decimal] = {}
        for sym in currency:
            got = price_series[sym].at(day)
            held = units.get(sym, ZERO) != 0
            if got is None:
                px = first_trade_price.get(sym, ZERO)
                if count and held:
                    coverage.trade_price += 1
            else:
                px, age = got
                if count and held and age > STALE_AFTER_DAYS:
                    coverage.stale += 1
            cur = currency[sym]
            rate = ONE
            if cur != "TWD":
                fx = fx_series[cur].at(day)
                if fx is None:
                    # The nearest stored rate beats today's live one: switching
                    # from a 2026 rate to a 2023 one the day history starts would
                    # book the gap as a one-day currency return.
                    rate = fx_series[cur].first() or fx_fallback.get(cur) or ONE
                    if count and held:
                        coverage.fx_fallback += 1
                else:
                    rate, fx_age = fx
                    if count and held and fx_age > STALE_AFTER_DAYS:
                        coverage.fx_stale += 1
            if count and held:
                coverage.valuations += 1
            out[sym] = px * rate
        return out

    day_before = start - timedelta(days=1)
    unit_px = value_on(day_before, count=False)
    prev_value = sum((units[s] * unit_px[s] for s in units), ZERO)

    series: List[tuple] = []
    factor = ONE
    invested_from: Optional[date] = start if prev_value > 0 else None
    day = start
    while day <= end:
        delta: Dict[str, Decimal] = {}
        while i < len(trades) and trades[i].day == day:
            t = trades[i]
            delta[t.symbol] = delta.get(t.symbol, ZERO) + t.quantity
            units[t.symbol] = units.get(t.symbol, ZERO) + t.quantity
            i += 1

        unit_px = value_on(day, count=True)
        value = sum((q * unit_px[s] for s, q in units.items()), ZERO)
        flow = sum((q * unit_px[s] for s, q in delta.items()), ZERO)

        r: Optional[Decimal] = None
        if prev_value > 0:
            r = (value - flow) / prev_value - ONE
            factor *= ONE + r
        # With nothing held yesterday there is no return to measure today; the
        # day's buys simply become tomorrow's starting value.
        if invested_from is None and value > 0:
            invested_from = day
        series.append((day, value, flow, r))
        prev_value = value
        day += timedelta(days=1)

    twr = factor - ONE
    # Annualise over the time money was in, not the window asked for: three
    # empty years before the first buy would otherwise dilute the rate.
    span = (end - invested_from).days + 1 if invested_from else 0
    annualized: Optional[Decimal] = None
    if span >= MIN_DAYS_TO_ANNUALISE and factor > 0:
        annualized = Decimal(str(float(factor) ** (365.25 / span))) - ONE

    return TwrResult(twr=twr, annualized=annualized, start=start, end=end, series=series, coverage=coverage)


@dataclass
class Reconciliation:
    #: Closed lots that still carry a quantity — soft-deleted duplicates from
    #: re-imports, not sales (a sale zeroes the lot). Left out.
    ignored_closed_lots: int = 0
    #: Lots outside the measured set (another wallet, or manually valued).
    excluded_lots: int = 0
    #: Sold-out lots with no ledger buy to say how many units they once held.
    unknown_sold_lots: int = 0
    #: Symbols whose recorded sales exceed what their lots can account for.
    mismatched_symbols: List[str] = field(default_factory=list)


def build_trades(lots: Sequence, ledger: Sequence, day_of, include=lambda lot: True) -> tuple:
    """Trades for `compute_twr`, rebuilt from lots plus the ledger's sales.

    Structural on purpose — any objects with the attributes read here:
      lot:    id, symbol, currency, quantity, average_cost, purchase_date, is_active
      ledger: holding_id, type ('buy'/'sell'), quantity, price, transaction_date
    `day_of` maps a stored instant to its business (Asia/Taipei) day;
    `include(lot)` selects what is measured (e.g. the Portfolio wallet only).

    Why not just replay the ledger: it records a buy for every lot ever created,
    including duplicates later closed without a sale, so it overcounts. The lots
    are the truth for what is held; the ledger is the truth for what was sold.

      - an open lot is bought on its purchase day, at its remaining quantity
      - a sold-out lot (closed, quantity 0) is bought at its ledger quantity
      - every ledger sell is a sale on its day
      - sales the sold-out lots don't account for came out of open lots; FIFO
        took them from the oldest, so that lot's buy is raised by the rest

    So units today equal the open lots exactly, and units on a past day are
    what FIFO says was held then.
    """
    ledger_buy_qty: Dict = {}
    for row in ledger:
        if row.type == "buy":
            ledger_buy_qty[row.holding_id] = ledger_buy_qty.get(row.holding_id, ZERO) + Decimal(str(row.quantity))

    rec = Reconciliation()
    measured = []
    for lot in lots:
        if not include(lot):
            rec.excluded_lots += 1
            continue
        qty = Decimal(str(lot.quantity or 0))
        if not lot.is_active and qty > 0:
            rec.ignored_closed_lots += 1
            continue
        if lot.purchase_date is None:
            continue
        measured.append(lot)
    measured_ids = {lot.id for lot in measured}
    by_symbol: Dict[str, list] = {}
    for lot in measured:
        by_symbol.setdefault(lot.symbol, []).append(lot)

    trades: List[Trade] = []
    sold: Dict[str, Decimal] = {}
    sym_of = {lot.id: lot.symbol for lot in lots}
    cur_of = {lot.id: (lot.currency or "TWD") for lot in lots}
    # A sale counts when its lot is in the measured set by wallet and pricing,
    # whatever became of that lot afterwards: the sell row names the lot that
    # was clicked, which may since have been soft-deleted (and so is not in
    # `measured`), while the lots it actually emptied still are.
    included_ids = {lot.id for lot in lots if include(lot)}
    for row in ledger:
        if row.type != "sell" or row.holding_id not in included_ids:
            continue
        qty = Decimal(str(row.quantity))
        sym = sym_of[row.holding_id]
        sold[sym] = sold.get(sym, ZERO) + qty
        trades.append(Trade(sym, day_of(row.transaction_date), -qty, cur_of[row.holding_id], Decimal(str(row.price))))

    for sym, group in by_symbol.items():
        group.sort(key=lambda lot: day_of(lot.purchase_date))
        originals = {}
        for lot in group:
            qty = Decimal(str(lot.quantity or 0))
            if lot.is_active:
                originals[lot.id] = qty
            elif lot.id in ledger_buy_qty:
                originals[lot.id] = ledger_buy_qty[lot.id]
            else:
                rec.unknown_sold_lots += 1
                originals[lot.id] = ZERO
        sold_out = sum((originals[l.id] for l in group if not l.is_active), ZERO)
        from_open = sold.get(sym, ZERO) - sold_out
        if from_open < 0:
            rec.mismatched_symbols.append(sym)
        elif from_open > 0:
            oldest_open = next((l for l in group if l.is_active), None)
            if oldest_open is None:
                rec.mismatched_symbols.append(sym)
            else:
                originals[oldest_open.id] += from_open
        for lot in group:
            if originals[lot.id] > 0:
                trades.append(Trade(sym, day_of(lot.purchase_date), originals[lot.id],
                                    lot.currency or "TWD", Decimal(str(lot.average_cost or 0))))

    return trades, rec
