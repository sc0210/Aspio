"""Portfolio router: Market data, quotes, search, regional, exchange-rate, and refresh endpoints.

Split out from the original monolithic ``portfolio/router.py``.
Behavior is preserved exactly; paths remain identical.
"""

from app.utils.exchange_rate_service import LIVE_SOURCE
from ._shared import *  # noqa: F401,F403  (shared imports/constants/helpers)
from ._shared import (  # noqa: F401  explicit re-import for underscore-prefixed names
    _lp_cache_get,
    _lp_cache_set,
    _get_sort_key,
    _mc,
    _price_cache,
    fetch_historical_data_background,
)
from app.utils.datetime_helpers import utc_now
from app.core.config import get_settings
from app.modules.admin.dependencies import RequirePermission
from app.modules.admin.models import AdminPermission, AdminUser

router = APIRouter()


def _supported_currency(code: str) -> str:
    """The code upper-cased, or 422: an unknown base is a paid API call and a cache key."""
    code = code.upper()
    if code not in get_settings().SUPPORTED_CURRENCIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported currency: {code}",
        )
    return code


@router.get("/prices/bulk")
async def get_bulk_prices(
    symbols: str = Query(
        ..., description="Comma-separated list of symbols, e.g. AAPL,2330,0050"
    ),
    target_date: Optional[date] = Query(
        None,
        description="Optional date (YYYY-MM-DD) to get price on; if omitted returns latest).",
    ),
    session: AsyncSession = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """
    Return latest prices for a list of symbols in a single call.

    - symbols: comma-separated list of symbols
    - target_date: optional date to fetch price on that date (not optimized for bulk historical lookups)
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    # Parse symbols
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        return ApiResponse.success_response(
            data={"prices": {}, "missing": []}, message="No symbols provided"
        )
    if len(symbol_list) > 50:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Too many symbols: {len(symbol_list)} provided, maximum is 50",
        )

    repo = HistoricalPriceRepository(session)

    # Use per-symbol cache (namespace 'prices') to allow easy invalidation
    if not target_date:
        prices: Dict[str, Any] = {}
        missing_symbols: List[str] = []

        for sym in symbol_list:
            cached = _lp_cache_get(f"prices:{sym}:latest")
            if cached is not None:
                prices[sym] = cached
            else:
                missing_symbols.append(sym)

        if not missing_symbols:
            return ApiResponse.success_response(data={"prices": prices, "cached": True})

        # Fetch missing symbols in bulk
        fetched = await repo.get_latest_prices_for_symbols(missing_symbols)

        # Populate cache and response
        for s, val in fetched.items():
            _lp_cache_set(f"prices:{s}:latest", val, ttl=60)
            prices[s] = val

        return ApiResponse.success_response(data={"prices": prices, "cached": False})

    if target_date:
        # Fallback: per-symbol date lookup (less efficient)
        prices = {}
        missing = []
        for sym in symbol_list:
            price = await repo.get_price_on_date(sym, target_date)
            if price:
                prices[sym] = {
                    "symbol": price.symbol,
                    "date": price.date.isoformat(),
                    "close": safe_float(price.close),
                    "open": safe_float(price.open),
                    "high": safe_float(price.high),
                    "low": safe_float(price.low),
                    "volume": price.volume,
                    "currency": price.currency,
                    "source": price.source,
                }
            else:
                missing.append(sym)

        return ApiResponse.success_response(
            data={"prices": prices, "missing": missing, "cached": False}
        )


@router.get("/market-data", response_model=List[MarketDataResponse])
@rate_limit_market_data
async def get_market_data(
    current_user=Depends(get_optional_current_user),
    symbols: Optional[str] = Query(None, description="Comma-separated list of symbols"),
    session: AsyncSession = Depends(get_db),
):
    """Get market data for specified symbols (Rate limited: 10 requests/minute per user)"""

    # Demo market data for both authenticated and non-authenticated users
    demo_market_data = [
        MarketDataResponse(
            symbol="AAPL",
            exchange="NASDAQ",
            price=Decimal("185.50"),
            open_price=Decimal("183.15"),
            high_price=Decimal("186.90"),
            low_price=Decimal("182.50"),
            previous_close=Decimal("183.15"),
            volume=Decimal("45678901"),
            market_cap=Decimal("2850000000000"),
            currency="USD",
            data_timestamp=utc_now(),
            source="demo",
        ),
        MarketDataResponse(
            symbol="GOOGL",
            exchange="NASDAQ",
            price=Decimal("275.25"),
            open_price=Decimal("277.00"),
            high_price=Decimal("278.50"),
            low_price=Decimal("274.80"),
            previous_close=Decimal("277.00"),
            volume=Decimal("23456789"),
            market_cap=Decimal("1750000000000"),
            currency="USD",
            data_timestamp=utc_now(),
            source="demo",
        ),
        MarketDataResponse(
            symbol="BTC-USD",
            exchange="Crypto",
            price=Decimal("48500.00"),
            open_price=Decimal("47000.00"),
            high_price=Decimal("49200.00"),
            low_price=Decimal("46800.00"),
            previous_close=Decimal("47000.00"),
            volume=Decimal("1234567890"),
            market_cap=Decimal("950000000000"),
            currency="USD",
            data_timestamp=utc_now(),
            source="demo",
        ),
    ]

    if symbols:
        symbol_list = [s.strip().upper() for s in symbols.split(",")]
        filtered_data = [
            data for data in demo_market_data if data.symbol in symbol_list
        ]
        return filtered_data

    return demo_market_data


@router.get("/search")
async def search_instruments(
    q: str = Query(..., description="Search query"),
    limit: int = Query(10, ge=1, le=50, description="Number of results"),
):
    """Search for financial instruments to add to portfolio"""

    # Demo search results
    demo_results = [
        {
            "symbol": "AAPL",
            "name": "Apple Inc.",
            "type": "stock",
            "exchange": "NASDAQ",
            "currency": "USD",
            "sector": "Technology",
        },
        {
            "symbol": "GOOGL",
            "name": "Alphabet Inc. Class A",
            "type": "stock",
            "exchange": "NASDAQ",
            "currency": "USD",
            "sector": "Technology",
        },
        {
            "symbol": "MSFT",
            "name": "Microsoft Corporation",
            "type": "stock",
            "exchange": "NASDAQ",
            "currency": "USD",
            "sector": "Technology",
        },
        {
            "symbol": "BTC-USD",
            "name": "Bitcoin",
            "type": "crypto",
            "exchange": "Crypto",
            "currency": "USD",
            "sector": "Cryptocurrency",
        },
    ]

    # Filter results based on query
    filtered_results = [
        result
        for result in demo_results
        if q.lower() in result["symbol"].lower() or q.lower() in result["name"].lower()
    ][:limit]

    return ApiResponse.success_response(
        data=filtered_results, message=f"Found {len(filtered_results)} results"
    )


# Health check
@router.post("/refresh-prices")
@rate_limit_portfolio_sync
async def refresh_portfolio_prices(
    force: bool = Query(
        False, description="Force update all prices regardless of cache"
    ),
    portfolio_id: Optional[str] = Query(
        None, description="Portfolio ID (optional, updates all if not provided)"
    ),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Refresh portfolio prices with smart caching (Rate limited: 3 requests/minute per user)

    This endpoint intelligently updates prices based on:
    - Market hours (TW: 9:00-13:30, US: 9:30-16:00 ET, CRYPTO: 24/7)
    - Last update time (hourly during market hours, daily after close)
    - Force flag to override cache

    This minimizes FinLab API calls while keeping prices fresh.
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to refresh prices",
        )

    try:
        price_service = get_price_update_service(session)

        # Update prices with smart caching. This commits the price rows
        # internally, so they are durable before the recalc step below.
        stats = await price_service.update_portfolio_prices(
            user_id=str(current_user.id), portfolio_id=portfolio_id, force=force
        )

        # Recalculate portfolio totals with currency conversion — best-effort.
        # This step makes external exchange-rate API calls that can fail
        # transiently. Since prices are already committed above, a recalc
        # failure must NOT 500 the request (this endpoint auto-fires on every
        # dashboard load) nor discard the saved prices.
        try:
            portfolio_service = get_portfolio_service(session)
            portfolio_repo = PortfolioRepository(session)

            if portfolio_id:
                portfolio = await portfolio_repo.get_by_id(portfolio_id, current_user.id)
            else:
                portfolio = await portfolio_repo.get_default_portfolio(current_user.id)

            if portfolio:
                await portfolio_service._update_portfolio_totals(
                    portfolio.id, current_user.id
                )
                # Update portfolio's last_price_update_at timestamp
                portfolio.last_price_update_at = datetime.now(ZoneInfo("UTC"))
                await session.commit()
        except Exception as recalc_err:
            await session.rollback()
            logger.warning(
                f"Prices refreshed but totals recalc failed (returning prices anyway): "
                f"{recalc_err}",
                exc_info=True,
            )

        return ApiResponse.success_response(
            data=stats,
            message=f"Prices refreshed: {stats['updated']} updated, {stats['cached']} cached",
        )

    except Exception as e:
        logger.error(f"Failed to refresh prices: {str(e)}", exc_info=True)
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/exchange-rates")
async def get_exchange_rates(
    base_currency: str = Query("TWD", description="Base currency code"),
    session: AsyncSession = Depends(get_db),
):
    """
    Get current exchange rates for all supported currencies

    This endpoint returns real-time exchange rates from the external API with daily caching.
    Rates are cached for 24 hours to minimize API calls.

    Args:
        base_currency: Base currency for conversion (default: TWD)

    Returns:
        Dictionary of currency pairs with exchange rates
    """
    base_currency = _supported_currency(base_currency)
    try:
        from app.utils.exchange_rate_service import get_exchange_rate_service

        exchange_service = get_exchange_rate_service(session)

        # Common currencies to support
        currencies = ["TWD", "USD", "EUR", "JPY", "GBP", "SGD", "CNY", "HKD"]

        # Fetch rates for all currency pairs
        rates = {}
        unavailable: list[str] = []
        for currency in currencies:
            if currency == base_currency:
                rates[currency] = 1.0
            else:
                rate = await exchange_service.get_exchange_rate(currency, base_currency)
                if rate:
                    rates[currency] = float(rate)
                else:
                    # Omit it. This used to substitute 1.0, which is not a
                    # fallback — it is the assertion that one US dollar is one
                    # New Taiwan dollar, returned in the same shape as a real
                    # rate and indistinguishable from one. A caller converting a
                    # USD position with it understates the holding roughly
                    # 31-fold, silently.
                    #
                    # A missing key lets the caller decide: show the native
                    # currency, use its own approximation and say so, or hide
                    # the figure. It cannot decide if we lie to it.
                    logger.warning(
                        f"No rate for {currency}->{base_currency}; omitting it "
                        f"rather than reporting parity"
                    )
                    unavailable.append(currency)

        return ApiResponse.success_response(
            data={
                "base_currency": base_currency,
                "rates": rates,
                # Named explicitly so a client can tell "we could not price this"
                # from "this currency was never asked about".
                "unavailable": unavailable,
                "timestamp": datetime.now(ZoneInfo("UTC")).isoformat(),
            },
            message="Exchange rates retrieved successfully",
        )

    except Exception as e:
        logger.error(f"Failed to get exchange rates: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


# ============================================================================
# REBALANCING & ASSET ALLOCATION ENDPOINTS
# ============================================================================


@router.post(
    "/exchange-rates/refresh",
    summary="Refresh exchange rates from external API",
    description="Fetch latest exchange rates from ExchangeRate-API and update database",
)
async def refresh_exchange_rates(
    # The stored rates are shared by every user: an operator action.
    current_admin: AdminUser = Depends(RequirePermission(AdminPermission.MANAGE_SETTINGS)),
    base_currency: str = Query("USD", description="Base currency for exchange rates"),
    session: AsyncSession = Depends(get_db),
):
    """
    Refresh exchange rates from ExchangeRate-API.

    This endpoint fetches the latest exchange rates and stores them in the database.
    It's useful for ensuring currency conversions use up-to-date rates.

    Requires the MANAGE_SETTINGS admin permission.
    """
    base_currency = _supported_currency(base_currency)
    try:
        from app.utils.exchange_rate_service import get_exchange_rate_service
        from ..repositories import CurrencyRepository

        exchange_service = get_exchange_rate_service()
        currency_repo = CurrencyRepository(session)

        # Fetch rates from API
        rates_dict = await exchange_service._fetch_rates(base_currency)

        if not rates_dict:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Unable to fetch exchange rates from API",
            )

        # Store important rates in database
        important_currencies = [
            "TWD",
            "USD",
            "JPY",
            "KRW",
            "CNY",
            "HKD",
            "SGD",
            "EUR",
            "GBP",
        ]
        stored_rates = []

        for target_currency in important_currencies:
            if target_currency in rates_dict:
                rate_data = {
                    "from_currency": base_currency,
                    "to_currency": target_currency,
                    "rate": Decimal(str(rates_dict[target_currency])),
                    "rate_timestamp": datetime.now(timezone.utc),
                    # The label the fallback trusts; see exchange_rate_service.LIVE_SOURCE.
                    "source": LIVE_SOURCE,
                }

                rate = await currency_repo.create_or_update_rate(rate_data)
                stored_rates.append(
                    {
                        "from": base_currency,
                        "to": target_currency,
                        "rate": float(rate.rate),
                    }
                )

        await session.commit()

        logger.info(
            f"Refreshed {len(stored_rates)} exchange rates for admin {current_admin.user_id}"
        )

        return ApiResponse.success_response(
            data={
                "base_currency": base_currency,
                "rates_updated": len(stored_rates),
                "rates": stored_rates,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            message=f"Successfully refreshed {len(stored_rates)} exchange rates",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to refresh exchange rates: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get(
    "/exchange-rates/{from_currency}/{to_currency}",
    summary="Get exchange rate between two currencies",
    description="Get current exchange rate from cache or API",
)
async def get_exchange_rate_endpoint(
    from_currency: str = Path(..., description="Source currency code (e.g., USD)"),
    to_currency: str = Path(..., description="Target currency code (e.g., TWD)"),
    current_user=Depends(get_optional_current_user),
):
    """
    Get exchange rate between two currencies.

    Returns real-time rate from ExchangeRate-API with caching.
    """
    from_currency = _supported_currency(from_currency)
    to_currency = _supported_currency(to_currency)
    try:
        from app.utils.exchange_rate_service import get_exchange_rate_service

        exchange_service = get_exchange_rate_service()
        rate = await exchange_service.get_exchange_rate(from_currency, to_currency)

        if rate is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Exchange rate not found for {from_currency} -> {to_currency}",
            )

        return ApiResponse.success_response(
            data={
                "from_currency": from_currency.upper(),
                "to_currency": to_currency.upper(),
                "rate": float(rate),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            message=f"Exchange rate retrieved: 1 {from_currency.upper()} = {rate} {to_currency.upper()}",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get exchange rate: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


# ============================================================================
# SYMBOL LOOKUP & MARKET DATA ENDPOINTS
# ============================================================================


@router.get(
    "/symbol/quote/{symbol}",
    summary="Get current quote for a symbol",
    description="Get current market price and basic info for a stock/ETF/crypto symbol",
)
async def get_symbol_quote(
    symbol: str = Path(
        ..., description="Symbol to look up (e.g., 0050, AAPL, BTC-USD)"
    ),
    market: Optional[str] = Query(None, description="Market type: TW, US, CRYPTO"),
    session: AsyncSession = Depends(get_db),
):
    """
    Get current quote for a symbol with automatic market detection.

    Returns:
    - Current price
    - Symbol metadata (name, type, exchange)
    - Market status (open/closed)
    - Last update timestamp
    """
    try:
        import asyncio
        from ..market_data_service import get_market_data_service
        from ..price_update_service import MarketHoursManager

        # Auto-detect market if not provided
        if not market:
            symbol_upper = symbol.upper()
            if symbol.isdigit() or ".TW" in symbol_upper or ".TWO" in symbol_upper:
                market = "TW"
                if ".TW" in symbol_upper:
                    symbol = symbol_upper.replace(".TW", "").replace(".TWO", "")
            elif (
                any(crypto in symbol_upper for crypto in ["BTC", "ETH", "USDT", "USDC"])
                or "-USD" in symbol_upper
            ):
                market = "CRYPTO"
            else:
                market = "US"

        logger.info(f"Symbol quote request: {symbol} (detected market: {market})")

        # Get market data service
        market_data_service = get_market_data_service()

        # Fetch current price with 10 second timeout
        try:
            current_price = await asyncio.wait_for(
                market_data_service.get_current_price(symbol, market), timeout=10.0
            )
        except asyncio.TimeoutError:
            logger.warning(f"Timeout fetching price for {symbol} after 10s")
            current_price = None

        # Check if market is currently open
        market_open = MarketHoursManager.is_market_open(market)

        # Determine exchange and currency
        if market == "TW":
            exchange = "TWSE"
            currency = "TWD"
            name = None
        elif market == "CRYPTO":
            exchange = "Crypto"
            currency = "USD"
            name = symbol.upper()
        else:
            exchange = "NASDAQ/NYSE"
            currency = "USD"
            name = None

        quote_data = {
            "symbol": symbol.upper(),
            "name": name,
            "market": market,
            "exchange": exchange,
            "currency": currency,
            "current_price": float(current_price) if current_price else None,
            "market_open": market_open,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "status": "success" if current_price else "no_data",
        }

        logger.info(
            f"Quote retrieved for {symbol}: price={current_price}, market_open={market_open}"
        )

        return ApiResponse.success_response(
            data=quote_data, message=f"Quote retrieved for {symbol}"
        )

    except Exception as e:
        logger.error(f"Failed to get quote for {symbol}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get(
    "/symbol/popular",
    summary="Get popular symbols for quick selection",
    description="Get list of popular stocks/ETFs/crypto for user's market",
)
async def get_popular_symbols(
    market: Optional[str] = Query(
        None, description="Market filter: TW, US, CRYPTO, or ALL"
    )
):
    """
    Get popular investment symbols for quick selection.

    Returns curated list of popular symbols based on Asian market preferences.
    """
    try:
        # Popular Taiwan stocks and ETFs
        tw_symbols = [
            {"symbol": "0050", "name": "元大台灣50", "type": "etf", "market": "TW"},
            {"symbol": "0056", "name": "元大高股息", "type": "etf", "market": "TW"},
            {"symbol": "2330", "name": "台積電", "type": "stock", "market": "TW"},
            {"symbol": "2317", "name": "鴻海", "type": "stock", "market": "TW"},
            {"symbol": "2454", "name": "聯發科", "type": "stock", "market": "TW"},
            {"symbol": "2412", "name": "中華電", "type": "stock", "market": "TW"},
        ]

        # Popular US stocks and ETFs
        us_symbols = [
            {
                "symbol": "VOO",
                "name": "Vanguard S&P 500 ETF",
                "type": "etf",
                "market": "US",
            },
            {
                "symbol": "VTI",
                "name": "Vanguard Total Stock Market",
                "type": "etf",
                "market": "US",
            },
            {
                "symbol": "QQQ",
                "name": "Invesco QQQ Trust",
                "type": "etf",
                "market": "US",
            },
            {"symbol": "AAPL", "name": "Apple Inc.", "type": "stock", "market": "US"},
            {
                "symbol": "MSFT",
                "name": "Microsoft Corporation",
                "type": "stock",
                "market": "US",
            },
            {
                "symbol": "GOOGL",
                "name": "Alphabet Inc.",
                "type": "stock",
                "market": "US",
            },
            {"symbol": "TSLA", "name": "Tesla Inc.", "type": "stock", "market": "US"},
            {
                "symbol": "NVDA",
                "name": "NVIDIA Corporation",
                "type": "stock",
                "market": "US",
            },
        ]

        # Popular cryptocurrencies
        crypto_symbols = [
            {
                "symbol": "BTC-USD",
                "name": "Bitcoin",
                "type": "crypto",
                "market": "CRYPTO",
            },
            {
                "symbol": "ETH-USD",
                "name": "Ethereum",
                "type": "crypto",
                "market": "CRYPTO",
            },
            {
                "symbol": "USDT-USD",
                "name": "Tether",
                "type": "crypto",
                "market": "CRYPTO",
            },
            {
                "symbol": "BNB-USD",
                "name": "Binance Coin",
                "type": "crypto",
                "market": "CRYPTO",
            },
        ]

        # Filter by market if specified
        if market:
            market = market.upper()
            if market == "TW":
                symbols = tw_symbols
            elif market == "US":
                symbols = us_symbols
            elif market == "CRYPTO":
                symbols = crypto_symbols
            else:  # ALL or invalid
                symbols = tw_symbols + us_symbols + crypto_symbols
        else:
            # Default: Taiwan symbols first (local preference), then US, then crypto
            symbols = tw_symbols + us_symbols[:4] + crypto_symbols[:2]

        logger.info(f"Popular symbols requested: market={market}, count={len(symbols)}")

        return ApiResponse.success_response(
            data=symbols, message=f"Retrieved {len(symbols)} popular symbols"
        )

    except Exception as e:
        logger.error(f"Failed to get popular symbols: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


# ============================================================================
# HISTORICAL PERFORMANCE & TIME-WEIGHTED RETURNS
# ============================================================================


