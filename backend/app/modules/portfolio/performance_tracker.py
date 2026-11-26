"""
Portfolio performance tracker: the time-weighted return (and FX_SERIES).
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Dict, Any, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
import logging

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
    """The portfolio's time-weighted return."""

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
