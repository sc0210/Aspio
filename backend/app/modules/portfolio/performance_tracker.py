"""
Historical Portfolio Performance Tracker

Calculates time-weighted returns and historical performance metrics
for long-term investment tracking.
"""

from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import List, Dict, Any, Optional, Tuple
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from collections import defaultdict
import logging

from app.modules.portfolio.models import PortfolioHolding, PortfolioTransaction
from app.modules.portfolio.repositories import HoldingRepository, TransactionRepository
from app.modules.portfolio.historical_price_repository import HistoricalPriceRepository
from app.modules.portfolio.manual_pricing import is_manually_priced
from app.modules.portfolio.twr import build_trades, compute_twr
from app.utils.datetime_helpers import business_day_of, business_today
from app.utils.exchange_rate_service import get_exchange_rate_service

# Daily FX series stored in historical_prices: how many TWD one unit buys.
# Yahoo's TWD=X is USD→TWD. Backfill with scripts/backfill_fx_history.py.
FX_SERIES = {"USD": "TWD=X"}

logger = logging.getLogger(__name__)


class PerformanceTracker:
    """Track and calculate historical portfolio performance metrics"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.holding_repo = HoldingRepository(session)
        self.transaction_repo = TransactionRepository(session)
        self.historical_price_repo = HistoricalPriceRepository(session)

    async def calculate_time_weighted_return(
        self,
        portfolio_id: UUID,
        user_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Time-weighted return of a portfolio, in TWD, with deposits taken out.

        The arithmetic lives in `twr.py`, which documents it and is tested
        against hand-computed cases. This method only gathers its inputs: the
        buy/sell ledger, every lot (sold-out ones included), daily closes, and
        the USD/TWD series — and reports how much of the answer rests on real
        data, so a thin price history can't pass for a confident number.
        """
        lots = await self.holding_repo.get_all_lots(portfolio_id, user_id)
        ledger = await self.transaction_repo.get_trades(portfolio_id, user_id)
        # Investments only: the Portfolio wallet (Emergency holdings are a cash
        # reserve), and nothing the user values by hand — with no price history
        # those would read as flat until the day their typed value jumps.
        def measured(lot) -> bool:
            wallet = getattr(lot.wallet_type, "value", lot.wallet_type)
            return str(wallet).lower() == "portfolio" and not is_manually_priced(lot.symbol, lot.type)

        trades, reconciliation = build_trades(lots, ledger, business_day_of, include=measured)

        if not trades:
            return {
                "twr": 0.0,
                "annualized_return": None,
                "total_return_percentage": 0.0,
                "annualized_return_percentage": None,
                "total_days": 0,
                "message": "No holdings found",
            }

        end_date = end_date or business_today()
        start_date = start_date or min(t.day for t in trades)
        if start_date > end_date:
            start_date = end_date
        first_trade = min(t.day for t in trades)

        symbols = sorted({t.symbol for t in trades})
        fx_symbols = {cur: sym for cur, sym in FX_SERIES.items() if any(t.currency == cur for t in trades)}
        # From the first trade, not the window: the opening value needs the
        # last close before the window, however long ago that was.
        history_from = min(first_trade, start_date) - timedelta(days=10)
        batch = await self.historical_price_repo.get_batch_price_history(
            symbols + list(fx_symbols.values()), history_from, end_date
        )

        def series(sym: str) -> Dict[date, Decimal]:
            out: Dict[date, Decimal] = {}
            for p in batch.get(sym.upper(), batch.get(sym, [])):
                d = p["date"]
                d = date.fromisoformat(d) if isinstance(d, str) else d
                if p.get("close") is not None:
                    out[d] = Decimal(str(p["close"]))
            return out

        prices = {s: series(s) for s in symbols}
        fx = {cur: series(sym) for cur, sym in fx_symbols.items()}

        # Before the first stored rate (or for a currency with no series), the
        # live rate stands in — counted in coverage.fx_fallback.
        fallback: Dict[str, Decimal] = {}
        rate_service = get_exchange_rate_service(self.session)
        for cur in {t.currency for t in trades} - {"TWD"}:
            try:
                rate = await rate_service.get_exchange_rate(cur, "TWD")
                if rate:
                    fallback[cur] = Decimal(str(rate))
            except Exception as e:  # a missing live rate must not sink the whole figure
                logger.warning(f"TWR: no live {cur}/TWD rate: {e}")

        result = compute_twr(trades, prices, fx, start_date, end_date, fallback)
        cov = result.coverage
        twr = result.twr
        ann = result.annualized

        return {
            "twr": float(twr),
            "annualized_return": float(ann) if ann is not None else None,
            "total_return_percentage": float(twr * 100),
            "annualized_return_percentage": float(ann * 100) if ann is not None else None,
            "total_days": (end_date - start_date).days + 1,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "currency": "TWD",
            "data_quality": {
                "real_price_share": round(cov.real_share, 4),
                "valuations": cov.valuations,
                "stale_price_valuations": cov.stale,
                "trade_price_valuations": cov.trade_price,
                "fx_fallback_valuations": cov.fx_fallback,
                "fx_stale_valuations": cov.fx_stale,
                "symbols_without_prices": cov.symbols_without_prices,
                "ignored_closed_lots": reconciliation.ignored_closed_lots,
                "excluded_lots": reconciliation.excluded_lots,
                "unknown_sold_lots": reconciliation.unknown_sold_lots,
                "mismatched_symbols": reconciliation.mismatched_symbols,
            },
            "valuation_series": [
                {"date": d.isoformat(), "value": float(v), "cash_flow": float(cf)}
                for d, v, cf, _ in result.series
            ],
            "period_returns": [
                {"date": d.isoformat(), "return": float(r)}
                for d, _, _, r in result.series
                if r is not None
            ],
        }

    async def get_historical_performance(
        self,
        portfolio_id: UUID,
        user_id: UUID,
        interval: str = "monthly",  # daily, weekly, monthly, yearly
    ) -> List[Dict[str, Any]]:
        """
        Get historical performance data points for charting.

        Returns a time series of portfolio values and returns.
        """
        # Get all holdings
        holdings, _ = await self.holding_repo.get_portfolio_holdings(
            portfolio_id=portfolio_id, user_id=user_id, limit=1000
        )

        if not holdings:
            return []

        # Find date range
        earliest_date = None
        for holding in holdings:
            if holding.purchase_date:
                purchase_date = (
                    holding.purchase_date.date()
                    if isinstance(holding.purchase_date, datetime)
                    else holding.purchase_date
                )
                if earliest_date is None or purchase_date < earliest_date:
                    earliest_date = purchase_date

        if not earliest_date:
            return []

        # Generate date points based on interval
        today = business_today()
        date_points = self._generate_date_points(earliest_date, today, interval)

        # Pre-fetch all prices in one batch query instead of per-date per-holding lookups
        _hist_symbols = list({h.symbol for h in holdings if h.purchase_date})
        _hist_price_map: Dict[str, Dict[str, Decimal]] = {}  # symbol -> {date_str -> close}
        if _hist_symbols:
            try:
                _batch = await self.historical_price_repo.get_batch_price_history(
                    _hist_symbols, earliest_date, today
                )
                for _sym, _prices in _batch.items():
                    _hist_price_map[_sym] = {p["date"]: Decimal(str(p["close"])) for p in _prices}
            except Exception as _e:
                logger.warning(f"History batch price fetch failed: {_e}")
        _hist_last_known: Dict[str, Decimal] = {}

        # Calculate portfolio value at each date point using historical prices
        historical_data = []

        for point_date in date_points:
            date_str = point_date.isoformat()
            value_at_date = Decimal("0")
            cost_at_date = Decimal("0")
            holdings_on_date = []

            # Update last-known prices for this date (ascending iteration)
            for holding in holdings:
                sym_prices = _hist_price_map.get(holding.symbol, {})
                if date_str in sym_prices:
                    _hist_last_known[holding.symbol] = sym_prices[date_str]

            for holding in holdings:
                if not holding.purchase_date:
                    continue

                purchase_date = (
                    holding.purchase_date.date()
                    if isinstance(holding.purchase_date, datetime)
                    else holding.purchase_date
                )

                # Only include holdings purchased before or on this date
                if purchase_date <= point_date:
                    cost_basis = holding.quantity * holding.average_cost

                    price_at_date = _hist_last_known.get(holding.symbol) or holding.current_price

                    current_value = holding.quantity * price_at_date

                    value_at_date += current_value
                    cost_at_date += cost_basis
                    # Collect per-holding snapshot for this date so we can emit top holdings
                    try:
                        holding_snapshot = {
                            "symbol": holding.symbol,
                            "quantity": float(holding.quantity),
                            "avgCost": float(holding.average_cost),
                            "closePrice": float(price_at_date),
                            "value": float(current_value),
                        }
                    except Exception:
                        holding_snapshot = {
                            "symbol": holding.symbol,
                            "quantity": (
                                float(holding.quantity)
                                if hasattr(holding, "quantity")
                                else 0.0
                            ),
                            "avgCost": (
                                float(holding.average_cost)
                                if hasattr(holding, "average_cost")
                                else 0.0
                            ),
                            "closePrice": (
                                float(price_at_date)
                                if price_at_date is not None
                                else 0.0
                            ),
                            "value": (
                                float(current_value)
                                if current_value is not None
                                else 0.0
                            ),
                        }
                    holdings_on_date.append(holding_snapshot)

            gain_loss = value_at_date - cost_at_date
            gain_loss_pct = (
                (gain_loss / cost_at_date * 100) if cost_at_date > 0 else Decimal("0")
            )

            # Prepare top holdings for this date (by value). Clear temp if missing.
            top_holdings = []
            if holdings_on_date:
                sorted_holdings = sorted(
                    holdings_on_date,
                    key=lambda h: abs(h.get("value", 0)),
                    reverse=True,
                )
                top_holdings = sorted_holdings[:5]

            historical_data.append(
                {
                    "date": point_date.isoformat(),
                    "value": float(value_at_date),
                    "cost": float(cost_at_date),
                    "gain_loss": float(gain_loss),
                    "gain_loss_percentage": float(gain_loss_pct),
                    "topHoldings": top_holdings,
                }
            )

        return historical_data

    def _generate_date_points(
        self, start_date: date, end_date: date, interval: str
    ) -> List[date]:
        """Generate list of dates based on interval"""
        points = []
        current = start_date

        if interval == "daily":
            delta = timedelta(days=1)
        elif interval == "weekly":
            delta = timedelta(weeks=1)
        elif interval == "monthly":
            # Approximate monthly as 30 days for simplicity
            delta = timedelta(days=30)
        elif interval == "yearly":
            delta = timedelta(days=365)
        else:
            delta = timedelta(days=30)  # Default to monthly

        while current <= end_date:
            points.append(current)
            current += delta

        # Always include end date
        if points[-1] != end_date:
            points.append(end_date)

        return points

    async def calculate_holding_periods(
        self, portfolio_id: UUID, user_id: UUID
    ) -> Dict[str, Any]:
        """
        Calculate average holding periods and categorize investments.

        Useful for understanding investment time horizons.
        """
        holdings, _ = await self.holding_repo.get_portfolio_holdings(
            portfolio_id=portfolio_id, user_id=user_id, limit=1000
        )

        today = business_today()
        holding_periods = []

        short_term = []  # < 1 year
        medium_term = []  # 1-3 years
        long_term = []  # > 3 years

        for holding in holdings:
            if not holding.purchase_date:
                continue

            purchase_date = (
                holding.purchase_date.date()
                if isinstance(holding.purchase_date, datetime)
                else holding.purchase_date
            )
            days_held = (today - purchase_date).days
            years_held = days_held / 365.25

            holding_info = {
                "symbol": holding.symbol,
                "days_held": days_held,
                "years_held": round(years_held, 2),
                "purchase_date": purchase_date.isoformat(),
                "quantity": float(holding.quantity),
                "cost": float(holding.quantity * holding.average_cost),
                "value": float(holding.quantity * holding.current_price),
            }

            holding_periods.append(holding_info)

            if years_held < 1:
                short_term.append(holding_info)
            elif years_held < 3:
                medium_term.append(holding_info)
            else:
                long_term.append(holding_info)

        # Calculate averages
        avg_holding_period = (
            sum(h["days_held"] for h in holding_periods) / len(holding_periods)
            if holding_periods
            else 0
        )

        return {
            "average_holding_period_days": round(avg_holding_period, 2),
            "average_holding_period_years": round(avg_holding_period / 365.25, 2),
            "total_holdings": len(holding_periods),
            "short_term_count": len(short_term),
            "medium_term_count": len(medium_term),
            "long_term_count": len(long_term),
            "short_term_holdings": short_term,
            "medium_term_holdings": medium_term,
            "long_term_holdings": long_term,
            "categorization": {
                "short_term_pct": (
                    round(len(short_term) / len(holding_periods) * 100, 2)
                    if holding_periods
                    else 0
                ),
                "medium_term_pct": (
                    round(len(medium_term) / len(holding_periods) * 100, 2)
                    if holding_periods
                    else 0
                ),
                "long_term_pct": (
                    round(len(long_term) / len(holding_periods) * 100, 2)
                    if holding_periods
                    else 0
                ),
            },
        }
