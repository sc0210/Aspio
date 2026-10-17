"""Portfolio router: Portfolio historical & daily-performance time-series endpoints.

Split out from the original monolithic ``portfolio/router.py``.
Behavior is preserved exactly; paths remain identical.
"""

from ._shared import *  # noqa: F401,F403  (shared imports/constants/helpers)
from ._shared import (  # noqa: F401  explicit re-import for underscore-prefixed names
    _lp_cache_get,
    _lp_cache_set,
    _get_sort_key,
    _mc,
    _price_cache,
    fetch_historical_data_background,
)
from app.utils.datetime_helpers import business_now, business_today
from app.utils.datetime_helpers import utc_now

router = APIRouter()


async def _refresh_prices_background(user_id: str) -> None:
    """Refresh holding prices off the request path, using a fresh DB session.

    Scheduled via ``BackgroundTasks`` so the endpoint returns immediately. The
    request's own session is already closed by the time this runs, so it opens a
    new one. ``force=False`` makes it a no-op when prices were refreshed within
    the last hour. Failures are swallowed — a background refresh must never break
    the response that scheduled it.
    """
    from app.core.database import async_session

    try:
        async with async_session() as bg_session:
            await get_price_update_service(bg_session).update_portfolio_prices(
                user_id=user_id, force=False
            )
    except Exception as e:
        logger.warning(f"Background price refresh failed (non-fatal): {e}")


@router.get("/historical")
async def get_portfolio_historical_data(
    days: int = Query(
        365, description="Number of days of historical data", ge=1, le=730
    ),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get portfolio historical performance data.

    Demo mode (unauthenticated): returns mock historical data.
    Authenticated: currently disabled (503) pending a performance rewrite — see
    the note at the raise below. The frontend treats 503 as an explicit
    "unavailable" state. (Live daily values are served by /daily-performance.)
    """

    if not current_user:
        # Demo mode: ~50 points sampled off the same value walk the daily
        # series uses, so this ends at the demo portfolio's NT$2M rather than
        # around the retired 28,450.75 AAPL/GOOGL fixture.
        series = demo_value_series(days)
        step = max(1, len(series) // 50)
        sampled = series[::-1][::step][::-1]  # keep the latest point
        historical_data = [
            {
                # Naive midnight datetime, the shape this endpoint has always had.
                "date": datetime.combine(p["date"], datetime.min.time()).isoformat(),
                "value": p["value"],
                "holdings": [],
            }
            for p in sampled
        ]

        return ApiResponse.success_response(
            data=historical_data,
            message=f"Retrieved {len(historical_data)} historical data points",
        )

    # Historical portfolio value computation is disabled pending a performance
    # rewrite. Return 503 so the frontend shows an explicit "unavailable" state
    # rather than silently rendering estimated or mock charts.
    #
    # NOTE: this 503 was previously raised *inside* a try/except whose bare
    # `except Exception` caught it (HTTPException subclasses Exception) and
    # returned randomized mock data with HTTP 200 — defeating the intent. The
    # ~250 lines of unreachable code after the raise were removed at the same time.
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Historical portfolio data is temporarily unavailable. Please check back soon.",
    )


@router.get("/daily-performance")
async def get_daily_performance(
    background_tasks: BackgroundTasks,
    days: int = Query(
        30,
        description="Number of days of daily performance data (use 9999 for all historical data)",
        ge=1,
        le=9999,
    ),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get daily portfolio performance showing day-to-day changes

    Returns an array of daily performance data with:
    - date: The date
    - value: Total portfolio value on that day
    - change: Change in value from previous day
    - changePercent: Percentage change from previous day

    IMPORTANT: Before calculating performance, checks if market prices need updating.
    This handles the case where TW and US markets close at different times and weekends.
    """

    if not current_user:
        # Demo mode: the demo portfolio's own value history (see
        # _shared.demo_value_series), ending on the business day at exactly
        # DEMO_PORTFOLIO's total. This used to random-walk from 28,450.75 — the
        # retired AAPL/GOOGL portfolio — so the dashboard chart read NT$24K beside
        # a NT$2M wallet. Weekdays only, as the authenticated series is.
        cost_basis = float(DEMO_PORTFOLIO["total_cost"])
        daily_data = []
        prev = None
        for point in demo_value_series(days):
            if prev is None:
                change, change_percent = 0.0, 0.0
                movers = [
                    {"symbol": sym, "change": 0.0, "value": val}
                    for sym, val in point["holdings"].items()
                ]
            else:
                change = point["value"] - prev["value"]
                change_percent = (change / prev["value"] * 100) if prev["value"] else 0.0
                # Every holding, sorted by size of move — the authenticated
                # endpoint sends all of them so /portfolio/trend can read each
                # holding's start and end value off the series.
                movers = sorted(
                    (
                        {
                            "symbol": sym,
                            "change": round(val - prev["holdings"][sym], 2),
                            "value": val,
                        }
                        for sym, val in point["holdings"].items()
                    ),
                    key=lambda m: abs(m["change"]),
                    reverse=True,
                )
            daily_data.append(
                {
                    "date": point["date"].strftime("%Y-%m-%d"),
                    "provisional": False,
                    "value": point["value"],
                    "costBasis": cost_basis,
                    "change": round(change, 2),
                    "changePercent": round(change_percent, 2),
                    "topHoldings": movers,
                    "capitalAdded": 0,
                    "purchases": [],
                }
            )
            prev = point

        return ApiResponse.success_response(
            data=daily_data,
            message=f"Retrieved {len(daily_data)} days of performance data",
        )

    try:
        from app.modules.portfolio.historical_price_service import (
            get_historical_price_service,
        )

        portfolio_service = get_portfolio_service(session)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)

        if not portfolio or not portfolio.holdings:
            return ApiResponse.success_response(
                data=[], message="No holdings found in portfolio"
            )

        # Refresh holding.current_price OFF the request path so the response returns
        # immediately. The refresh runs after the response (own DB session); fresh
        # prices land on the next load. force=False → a no-op when prices were
        # fetched within the last hour. (Previously this awaited inline, blocking the
        # response on the per-symbol price-API round-trips.)
        background_tasks.add_task(_refresh_prices_background, str(current_user.id))

        # Get historical price service
        hist_price_service = get_historical_price_service(session)

        # Filter out non-tradable items (cash, savings, budgets, etc.)
        # These don't have market prices and shouldn't be in daily performance
        NON_TRADABLE_SYMBOLS = {
            "SAVINGS",
            "TWD-SAVINGS",
            "CPF-OA",
            "ANNUAL-BUDGET",
            "CRYPTO",
            "CASH",
            "EMERGENCY-FUND",
            "BUDGET",
        }

        from ..models import HoldingWalletType

        tradable_holdings = [
            h
            for h in portfolio.holdings
            if h.symbol.upper() not in NON_TRADABLE_SYMBOLS
            and not h.symbol.upper().startswith("CASH-")
            and not h.symbol.upper().endswith("-SAVINGS")
            and not h.symbol.upper().endswith("-BUDGET")
            and h.wallet_type != HoldingWalletType.EMERGENCY
        ]

        if not tradable_holdings:
            return ApiResponse.success_response(
                data=[], message="No tradable holdings found in portfolio"
            )

        logger.info(
            f"Filtered {len(portfolio.holdings)} holdings to {len(tradable_holdings)} tradable portfolio holdings"
        )

        # Initialize exchange rate service for currency conversion
        exchange_service = ExchangeRateService(session)

        # Determine base currency from portfolio (default to TWD)
        base_currency = portfolio.currency if hasattr(portfolio, "currency") else "TWD"
        logger.info(f"Using base currency: {base_currency}")

        # Query existing historical data from database (no API calls).
        # business_today() rather than date.today(): the container runs UTC, so a
        # user in Taiwan would otherwise see yesterday as "today" all through their
        # early morning. The timezone itself lives in APP_TIMEZONE now, not here.
        end_date = business_today()

        # Calculate start date - we want exactly 'days' worth of data ending today
        start_date = end_date - timedelta(days=days)

        # Find earliest purchase date among tradable holdings for data fetching
        earliest_purchase = None
        for holding in tradable_holdings:
            if holding.purchase_date:
                purchase = (
                    holding.purchase_date.date()
                    if isinstance(holding.purchase_date, datetime)
                    else holding.purchase_date
                )
                if earliest_purchase is None or purchase < earliest_purchase:
                    earliest_purchase = purchase

        # Fetch 10 days before start_date so there is always a pre-buffer for forward-filling
        # on weekends and holidays.  If the oldest holding was purchased after that window
        # clamp to 10 days before that purchase (don't fetch data before any holding existed,
        # but preserve the 10-day pre-buffer so the pre-seeding step below can find a price).
        fetch_start_date = start_date - timedelta(days=10)
        if earliest_purchase and earliest_purchase > fetch_start_date:
            fetch_start_date = max(
                fetch_start_date,
                earliest_purchase - timedelta(days=10),
            )

        logger.info(
            f"Loading historical data for {len(tradable_holdings)} tradable holdings from {fetch_start_date} to {end_date}"
        )

        # Build symbol-market mapping from tradable holdings only
        symbol_markets = {
            holding.symbol: holding.market for holding in tradable_holdings
        }
        symbols = list(symbol_markets.keys())

        # ⚡ OPTIMIZED: Batch load all historical prices in a SINGLE database query
        # Previously: N queries (one per symbol)
        # Now: 1 query for all symbols + Redis caching
        all_prices = await hist_price_service.get_batch_price_range(
            symbols=symbols, start_date=fetch_start_date, end_date=end_date
        )

        total_prices_loaded = sum(len(prices) for prices in all_prices.values())
        logger.info(
            f"✅ Loaded {total_prices_loaded} total price records for {len(symbols)} symbols (batch query)"
        )

        # Check if we have any historical data
        if total_prices_loaded == 0:
            logger.info(
                f"No historical data found for {len(symbols)} symbols. User needs to sync."
            )
            return ApiResponse.success_response(
                data=[],
                message="No historical data available. Please click 'Sync Historical Data' to fetch price history.",
            )

        # ── Gap detection ─────────────────────────────────────────────────────
        # Check if any symbol's oldest record is more than 7 days after the
        # earliest holding purchase date — signals a data gap needing a backfill.
        has_data_gaps = False
        gap_symbols: list = []
        for sym, price_dict in all_prices.items():
            if not price_dict:
                continue
            oldest_date_str = min(price_dict.keys())
            try:
                oldest_dt = date.fromisoformat(oldest_date_str)
            except ValueError:
                continue
            holding_purchase = next(
                (
                    (h.purchase_date.date() if isinstance(h.purchase_date, datetime) else h.purchase_date)
                    for h in tradable_holdings if h.symbol == sym and h.purchase_date
                ),
                None,
            )
            if holding_purchase and (oldest_dt - holding_purchase).days > 7:
                has_data_gaps = True
                gap_symbols.append(sym)
                logger.info(
                    f"📉 Data gap for {sym}: purchase {holding_purchase}, oldest price {oldest_dt}"
                )

        if has_data_gaps:
            logger.info(f"⚠️ Data gaps detected for {len(gap_symbols)} symbols: {gap_symbols}")

        # Calculate portfolio value for each day
        daily_data = []

        # Track last known prices for forward-filling on non-trading days (weekends, holidays)
        last_known_prices = {}

        # Pre-seed last_known_prices from the pre-buffer window (fetch_start_date → start_date-1).
        # Without this, when start_date falls on a Monday or market holiday the loop finds no
        # historical close for that date and incorrectly falls back to holding.current_price
        # (a live intraday/today price), corrupting every value in the chart.
        # Scanning newest-to-oldest guarantees the most-recent pre-period close is captured first.
        pre_buffer_days = (start_date - fetch_start_date).days
        for _days_back in range(1, pre_buffer_days + 1):
            _pre_day_str = (start_date - timedelta(days=_days_back)).strftime("%Y-%m-%d")
            for _h in tradable_holdings:
                if _h.symbol not in last_known_prices:
                    _entry = all_prices.get(_h.symbol, {}).get(_pre_day_str)
                    if _entry and _entry.get("close"):
                        last_known_prices[_h.symbol] = Decimal(str(_entry["close"]))

        # Track previous day's holding values for calculating individual holding changes
        prev_day_holding_values = {}

        for day_offset in range(days + 1):
            current_day = start_date + timedelta(days=day_offset)
            current_day_str = current_day.strftime("%Y-%m-%d")
            daily_value = Decimal("0")
            daily_cost_basis = Decimal(
                "0"
            )  # Cumulative cost basis of all active holdings

            # True once any holding on this day is priced from a live quote because
            # its market has not published a close for the date yet. Such a day is
            # still moving, and the figures on it change when the close lands.
            day_is_provisional = False

            # Track current day holding values and changes for top movers
            # Use symbol as key to aggregate multiple lots
            current_day_holding_values = {}
            # Track VALUE of new purchases by symbol (to exclude from change calculation)
            new_purchase_values = {}
            # Track COST BASIS of new purchases for IRR projection
            new_purchase_costs = {}
            holding_changes = []

            # Calculate portfolio value for this day
            for holding in tradable_holdings:
                # Prefer the historical DB close price when available — it's the official
                # market close and is accurate regardless of when current_price was last
                # updated (current_price may be an intraday snapshot if a sync ran while
                # the market was still open).  Only fall back to current_price for
                # today's date when the historical DB does not yet have today's close.
                price_data = all_prices.get(holding.symbol, {}).get(current_day_str)

                if price_data and price_data.get("close"):
                    # Historical close price is available — always use it (most accurate)
                    price = Decimal(str(price_data["close"]))
                    last_known_prices[holding.symbol] = price
                elif current_day == end_date and holding.current_price:
                    # Today's close not yet in historical DB; use the latest fetched price
                    price = Decimal(str(holding.current_price))
                    last_known_prices[holding.symbol] = price
                    day_is_provisional = True
                elif holding.symbol in last_known_prices:
                    # Use last known price (carry forward for weekends/holidays)
                    price = last_known_prices[holding.symbol]
                else:
                    # No historical price data available at all
                    # Use current_price if available, otherwise use average_cost as fallback
                    if holding.current_price:
                        price = Decimal(str(holding.current_price))
                        last_known_prices[holding.symbol] = price
                        logger.debug(
                            f"Using current_price for {holding.symbol} on {current_day_str}: {price}"
                        )
                    elif holding.average_cost:
                        price = Decimal(str(holding.average_cost))
                        last_known_prices[holding.symbol] = price
                        logger.debug(
                            f"Using average_cost for {holding.symbol} on {current_day_str}: {price}"
                        )
                    else:
                        # Truly no price data at all, skip this holding
                        logger.warning(
                            f"No price data available for {holding.symbol} on {current_day_str}, skipping"
                        )
                        continue

                # Check if holding was owned on or before this day
                purchase_date = (
                    holding.purchase_date.date()
                    if isinstance(holding.purchase_date, datetime)
                    else holding.purchase_date
                )
                if purchase_date and purchase_date <= current_day:
                    # Calculate value in holding's currency
                    holding_value = Decimal(str(holding.quantity)) * price

                    # Convert to base currency if needed
                    holding_currency = holding.currency if holding.currency else "USD"
                    if holding_currency != base_currency:
                        try:
                            exchange_rate = await exchange_service.get_exchange_rate(
                                from_currency=holding_currency,
                                to_currency=base_currency,
                            )
                            if exchange_rate:
                                holding_value = holding_value * exchange_rate
                                logger.debug(
                                    f"Converted {holding.symbol} from {holding_currency} to {base_currency}: rate={exchange_rate}"
                                )
                            else:
                                logger.warning(
                                    f"No exchange rate available for {holding_currency} -> {base_currency}, using original value"
                                )
                        except Exception as e:
                            logger.error(
                                f"Error converting currency for {holding.symbol}: {e}"
                            )
                            # Continue with original value if conversion fails

                    daily_value += holding_value

                    # Accumulate cost basis for this holding (quantity * average_cost)
                    if holding.average_cost:
                        holding_cost = Decimal(str(holding.quantity)) * Decimal(
                            str(holding.average_cost)
                        )
                        # Convert cost basis to base currency if needed
                        if holding_currency != base_currency:
                            try:
                                cb_rate = await exchange_service.get_exchange_rate(
                                    from_currency=holding_currency,
                                    to_currency=base_currency,
                                )
                                if cb_rate:
                                    holding_cost = holding_cost * cb_rate
                            except Exception:
                                pass  # Use unconverted cost if conversion fails
                        daily_cost_basis += holding_cost

                    # Track value of lots purchased TODAY (to exclude from change calculation)
                    # Also track COST BASIS for capital additions
                    if purchase_date == current_day:
                        # Market value for performance calculation
                        if holding.symbol in new_purchase_values:
                            new_purchase_values[holding.symbol] += holding_value
                        else:
                            new_purchase_values[holding.symbol] = holding_value

                        # Cost basis for IRR projection (what you actually paid)
                        cost_basis = Decimal(str(holding.quantity)) * Decimal(
                            str(holding.average_cost)
                        )

                        # Convert cost basis to base currency if needed
                        if holding_currency != base_currency:
                            try:
                                exchange_rate = (
                                    await exchange_service.get_exchange_rate(
                                        from_currency=holding_currency,
                                        to_currency=base_currency,
                                    )
                                )
                                if exchange_rate:
                                    cost_basis = cost_basis * exchange_rate
                            except Exception as e:
                                logger.error(
                                    f"Error converting cost basis currency for {holding.symbol}: {e}"
                                )

                        if holding.symbol in new_purchase_costs:
                            new_purchase_costs[holding.symbol] += cost_basis
                        else:
                            new_purchase_costs[holding.symbol] = cost_basis

                    # Aggregate value by symbol (for multiple lots)
                    if holding.symbol in current_day_holding_values:
                        current_day_holding_values[holding.symbol] += holding_value
                    else:
                        current_day_holding_values[holding.symbol] = holding_value

            # Calculate holding changes after all lots are aggregated
            # Subtract new purchase value from change calculation
            for symbol, total_value in current_day_holding_values.items():
                if symbol in prev_day_holding_values:
                    # Calculate change, excluding new purchases made today
                    prev_value = prev_day_holding_values[symbol]
                    new_purchase_value = new_purchase_values.get(symbol, Decimal("0"))

                    # True change = (today's total - new purchases) - yesterday's total
                    holding_change = (total_value - new_purchase_value) - prev_value

                    holding_changes.append(
                        {
                            "symbol": symbol,
                            "change": safe_float(holding_change) or 0,
                            "value": safe_float(total_value) or 0,
                        }
                    )
                elif symbol not in new_purchase_values:
                    # This symbol appeared today but not from a purchase
                    # (Could be from a stock split, spin-off, or data correction)
                    # Include it with its full value as change
                    holding_changes.append(
                        {
                            "symbol": symbol,
                            "change": safe_float(total_value) or 0,
                            "value": safe_float(total_value) or 0,
                        }
                    )

            # Calculate change from previous day
            # Exclude value of new purchases from change calculation
            if len(daily_data) > 0:
                prev_value = Decimal(str(daily_data[-1]["value"]))

                # Sum up all new purchase values
                total_new_purchase_value = sum(new_purchase_values.values())

                # True change = (today's total value - new purchase values) - yesterday's value
                adjusted_today_value = daily_value - total_new_purchase_value
                change = adjusted_today_value - prev_value

                # Safely calculate change percent, handling NaN values
                # Check is_finite() BEFORE doing comparisons to avoid InvalidOperation
                if prev_value.is_finite() and change.is_finite() and prev_value > 0:
                    change_percent = float((change / prev_value) * 100)
                else:
                    change_percent = 0

                if total_new_purchase_value > 0:
                    logger.debug(
                        f"Day {current_day}: total_value={daily_value}, new_purchases={total_new_purchase_value}, adjusted={adjusted_today_value}, change={change}"
                    )
            else:
                change = Decimal("0")
                change_percent = 0

            # Include ALL holdings sorted by absolute change so the trend page can
            # compute period start/end values for every holding, not just the top 5.
            # The chart tooltip already slices to the top 3 client-side.
            top_movers = sorted(
                holding_changes, key=lambda x: abs(x["change"]), reverse=True
            )

            # Calculate total capital additions (cost basis of new purchases)
            total_capital_added = sum(new_purchase_costs.values())

            # Build per-symbol purchase details for frontend display
            purchases_detail = []
            if new_purchase_costs:
                for sym, cost_val in new_purchase_costs.items():
                    # Find the holding name
                    holding_name = sym
                    for h in tradable_holdings:
                        if h.symbol == sym and hasattr(h, "name") and h.name:
                            holding_name = h.name
                            break
                    purchases_detail.append(
                        {
                            "symbol": sym,
                            "name": holding_name,
                            "cost": safe_float(cost_val) or 0,
                        }
                    )
                purchases_detail.sort(key=lambda x: x["cost"], reverse=True)

            if total_capital_added > 0:
                logger.debug(
                    f"💰 Day {current_day}: Capital added (cost basis) = {total_capital_added}"
                )

            # Skip weekends (Saturday=5, Sunday=6) - only show market days
            # Markets are closed on weekends, so price changes are zero or minimal
            if current_day.weekday() < 5:
                daily_data.append(
                    {
                        "date": current_day.strftime("%Y-%m-%d"),
                        # Priced from a live quote rather than a published close, so
                        # this figure is still moving. Carrying a previous close over
                        # a holiday is NOT provisional: the market was shut and the
                        # holding really was worth that.
                        "provisional": day_is_provisional,
                        "value": safe_float(daily_value) or 0,
                        "costBasis": safe_float(daily_cost_basis)
                        or 0,  # Cumulative cost basis of all active holdings
                        "change": safe_float(change) or 0,
                        "changePercent": (
                            round(change_percent, 2)
                            if isinstance(change_percent, (int, float))
                            and not math.isnan(change_percent)
                            and not math.isinf(change_percent)
                            else 0
                        ),
                        "topHoldings": top_movers,  # Add top movers to the response
                        "capitalAdded": safe_float(total_capital_added)
                        or 0,  # Track capital additions for IRR projection
                        "purchases": purchases_detail,  # Per-symbol purchase details
                    }
                )

                # Update previous day values for next iteration (only on trading days)
                # This ensures Monday's change is calculated from Friday's value, not Saturday/Sunday
                prev_day_holding_values = current_day_holding_values.copy()
            else:
                # On weekends, still carry forward the values but don't reset the previous day reference
                # This prevents incorrect zero-change calculations on Mondays
                pass

        logger.info(f"Calculated {len(daily_data)} days of portfolio performance")

        # Log last 3 data points for debugging
        if daily_data:
            for point in daily_data[-3:]:
                logger.debug(
                    f"📊 Last data: date={point['date']}, value={point['value']}, costBasis={point['costBasis']}"
                )

        # Include gap flag in message so the frontend can detect it
        msg = f"Retrieved {len(daily_data)} days of performance data"
        if has_data_gaps:
            msg += f"|gaps:{','.join(gap_symbols[:5])}"  # compact sentinel the frontend reads

        return ApiResponse.success_response(
            data=daily_data,
            message=msg,
        )

    except Exception as e:
        logger.error(f"Error fetching daily performance: {str(e)}", exc_info=True)

        # Fallback to simple calculation using current prices
        try:
            daily_data = []
            current_value = float(portfolio.total_value) if portfolio else 28450.75

            for i in range(days, -1, -1):
                # business_now(), not utc_now(): on a Taipei Monday morning the
                # container's UTC weekday is still Sunday, so the weekend skip below
                # would drop today's point — and the series would end on yesterday.
                date_point = business_now() - timedelta(days=i)

                # Skip weekends (Saturday=5, Sunday=6) - only show market days
                if date_point.weekday() >= 5:
                    continue

                # Simple linear interpolation from 95% to 100% of current value
                progress = (days - i) / days if days > 0 else 1
                value = current_value * (0.95 + progress * 0.05)

                if len(daily_data) > 0:
                    prev_value = daily_data[-1]["value"]
                    change = value - prev_value
                    # Safely calculate change percent, handling NaN values
                    if (
                        prev_value > 0
                        and isinstance(change, (int, float, Decimal))
                        and isinstance(prev_value, (int, float, Decimal))
                    ):
                        if isinstance(change, Decimal) and isinstance(
                            prev_value, Decimal
                        ):
                            if change.is_finite() and prev_value.is_finite():
                                change_percent = float((change / prev_value) * 100)
                            else:
                                change_percent = 0
                        else:
                            change_percent = (change / prev_value) * 100
                    else:
                        change_percent = 0
                else:
                    change = 0
                    change_percent = 0

                daily_data.append(
                    {
                        "date": date_point.strftime("%Y-%m-%d"),
                        "value": round(value, 2),
                        "change": round(change, 2),
                        "changePercent": round(change_percent, 2),
                    }
                )

            return ApiResponse.success_response(
                data=daily_data,
                message=f"Retrieved {len(daily_data)} days of estimated performance data",
            )
        except Exception as fallback_error:
            logger.error(f"Fallback also failed: {str(fallback_error)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="An internal error occurred",
            )


