"""Portfolio router: Portfolio root (GET /) aggregate endpoint.

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
from app.core.exceptions import AspiroException
from ..symbols import symbol_lookup_variants
from app.utils.datetime_helpers import business_today
# Demo holdings are rebuilt on every request, so their ids have to be derived
# rather than minted. uuid4() handed out a different id each call, which meant an
# id-based route into a demo holding (portfolio/edit/[id]) could never resolve the
# record the user had just clicked on.
#
# Same md5-seeded construction the wallet ids below use: deterministic, and
# UUID(version=4) rewrites the version and variant bits so it still satisfies the
# UUID4 field on PortfolioResponse. A uuid5 would not — it fails that validation
# with uuid_version and takes the whole endpoint down to a 500.
def _demo_holding_id(symbol: str) -> str:
    import hashlib

    seed = f"aspiro-demo-holding:{symbol}".encode()
    return str(UUID(bytes=hashlib.md5(seed).digest(), version=4))


router = APIRouter()

# How stale the "previous close" may be before the day-change delta stops being
# reported. Covers a weekend plus a public holiday; anything older means the
# historical sync has a gap and the delta would not be a single day's move.
MAX_PREVIOUS_CLOSE_AGE_DAYS = 7


def _pick_previous_close(
    stored: Optional[Decimal], from_history: Optional[Decimal]
) -> Optional[Decimal]:
    """Provider-reported previous close wins over the one we derive ourselves.

    ``portfolio_holdings.previous_close`` is captured from the same quote as
    current_price, so the two always describe the same session. The historical
    table is only a fallback: it is as complete as the nightly sync, and one
    missing session turns "today's change" into a multi-day change.
    """
    if stored is not None and Decimal(str(stored)) > 0:
        return Decimal(str(stored))
    return from_history


def _historical_symbol_variants(symbol: str, market: Optional[str] = None) -> List[str]:
    """Keys under which a holding's price history may be stored.

    Writes are canonical since `symbols.canonical_symbol` took over the write
    boundary, but rows predating the merge migration are still keyed by whichever
    form last synced them — bare "0050" or Yahoo-style "0050.TW" — and looking up
    only the symbol as stored reads a series that stopped updating. A database
    the merge has been applied to returns one variant for everything.
    """
    return symbol_lookup_variants(symbol, market)


@router.get("/")
async def get_portfolio(
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
    sortBy: Optional[str] = Query(
        "value",
        description="Sort holdings by: symbol, name, value, gainLoss, gainLossPercentage",
    ),
    sortOrder: Optional[str] = Query("desc", description="Sort order: asc or desc"),
    market: Optional[str] = Query(None, description="Filter by market type"),
    type: Optional[str] = Query(None, description="Filter by asset type"),
    wallet: Optional[str] = Query(
        None,
        description="Filter by wallet type: life, portfolio, emergency, or all",
    ),
):
    """Get user's main portfolio or demo portfolio for non-authenticated users with sorting and filtering support"""

    # Validate sort parameters
    valid_sort_fields = ["symbol", "name", "value", "gainLoss", "gainLossPercentage"]
    valid_sort_orders = ["asc", "desc"]

    if sortBy and sortBy not in valid_sort_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid sortBy parameter. Must be one of: {', '.join(valid_sort_fields)}",
        )

    if sortOrder and sortOrder not in valid_sort_orders:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid sortOrder parameter. Must be one of: {', '.join(valid_sort_orders)}",
        )

    # Log authentication status for debugging
    logger.info(
        f"📊 GET /portfolio request - User authenticated: {current_user is not None}, User: {current_user.email if current_user else 'None'}"
    )

    if not current_user:
        # Return demo portfolio for non-authenticated users with sorting
        logger.info("📊 Returning DEMO portfolio (user not authenticated)")
        demo_data = DEMO_PORTFOLIO.copy()

        # Built from the shared DEMO_HOLDINGS rather than a copy of it.
        #
        # This was a fourth transcription of the same demo portfolio — the other
        # three being _shared.DEMO_HOLDINGS, the dashboard's portfolio_wallet and
        # the frontend fixture — and the one actually served, so editing any of
        # the others changed nothing here. The id is the one field that cannot
        # come from the fixture: it must be stable across requests, which
        # `str(uuid4())` at import time is not (that is what broke Edit Holding
        # in demo).
        demo_holdings = [
            {**holding, "id": _demo_holding_id(holding["symbol"])}
            for holding in DEMO_HOLDINGS
        ]

        # Apply sorting to demo holdings
        if sortBy:
            sort_key = _get_sort_key(sortBy)
            reverse_order = sortOrder.lower() == "desc"
            demo_holdings = sorted(demo_holdings, key=sort_key, reverse=reverse_order)

        demo_data["holdings"] = demo_holdings
        return PortfolioResponse(**demo_data)

    try:
        logger.info(
            f"📊 Fetching portfolio for authenticated user: {current_user.email}"
        )
        portfolio_service = get_portfolio_service(session)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)

        logger.info(
            f"📊 Portfolio found: {portfolio is not None}, Holdings: {len(portfolio.holdings) if portfolio and portfolio.holdings else 0}"
        )

        # Prices are kept fresh by the background scheduler (market-close jobs).
        # Per-request updates were removed — at scale they caused every portfolio
        # page load to trigger DB writes for potentially hundreds of holdings.
        # Users who need an immediate refresh can use the POST /refresh-prices endpoint.

        if not portfolio:
            # Create default portfolio if none exists
            portfolio_create = PortfolioCreate(
                name="My Portfolio",
                description="Default investment portfolio",
                currency="USD",
                is_default=True,
            )
            portfolio = await portfolio_service.create_portfolio(
                portfolio_create, current_user.id
            )

        # Add life/emergency wallet cash as synthetic holdings to "All Wallets"
        # view. Both balances come from transactions, not portfolio holdings.
        # One query for both. Transaction-only: any legacy emergency-wallet
        # PortfolioHolding rows already appear in portfolio.holdings below, so
        # folding them in here as well would count them twice. This used to run
        # the dashboard's whole wallet calculation, holdings FX included, only
        # to read the Life balance off it.
        from app.modules.transactions.models import TransactionWalletType
        from app.modules.transactions.repositories import TransactionRepository

        cash = await TransactionRepository(session).cash_balances_twd(current_user.id)
        life_wallet_balance = cash.get(TransactionWalletType.LIFE, 0)
        emergency_wallet_balance = cash.get(TransactionWalletType.EMERGENCY, 0)

        # Create a synthetic cash holding for life wallet — always inject so
        # the row is visible even when balance is zero or temporarily negative
        # (a negative balance is a valid signal worth showing, not hiding).
        if True:
            import hashlib

            # Generate deterministic UUID v4 from user ID and "life_wallet_cash"
            # This ensures the same UUID for the same user's life wallet cash
            seed = f"{current_user.id}-life_wallet_cash".encode()
            hash_bytes = hashlib.md5(seed).digest()
            # Convert to UUID v4 format by setting version and variant bits
            life_wallet_id = UUID(bytes=hash_bytes, version=4)

            life_wallet_cash = HoldingResponse(
                id=life_wallet_id,
                user_id=current_user.id,
                portfolio_id=portfolio.id,
                wallet_type="life",
                symbol="CASH-TWD",
                name="Life Wallet Cash",
                type="cash",
                quantity=float(life_wallet_balance),
                average_cost=1.0,
                current_price=1.0,
                total_cost=float(life_wallet_balance),
                total_value=float(life_wallet_balance),
                gain_loss=0.0,
                gain_loss_percentage=0.0,
                currency="TWD",
                exchange="",
                sector="Cash",
                region=None,
                dividend_yield=None,
                annual_dividend=None,
                # This aggregates every Life-wallet transaction to date, not a
                # single purchase — "purchase_date" defaults to None, which
                # the frontend renders as "Not set". Use "now" so the Purchase
                # History date column shows something meaningful instead.
                purchase_date=datetime.now(ZoneInfo("UTC")),
                is_active=True,
                last_price_update_at=datetime.now(ZoneInfo("UTC")),
                metadata={},
                created_at=datetime.now(ZoneInfo("UTC")),
                updated_at=datetime.now(ZoneInfo("UTC")),
                sparkline_data=[],
            )

            # Add life wallet cash to holdings first
            if portfolio.holdings:
                portfolio.holdings.insert(0, life_wallet_cash)
            else:
                portfolio.holdings = [life_wallet_cash]

            logger.info(f"💳 Added life wallet cash holding: {life_wallet_balance} TWD")

            # A legacy emergency-wallet PortfolioHolding cash row (pre-#137)
            # already represents this wallet in the list below. The synthetic
            # row is transaction-only (see the comment above where it's
            # computed), so when it's nonzero it's genuinely new money, not a
            # duplicate of the real holding — inject it. Only skip it when
            # there's a real holding AND nothing new from transactions to add;
            # otherwise it'd show as an undeletable empty "lot" (no real DB
            # id, so Delete 404s on it) — that's the case that must be avoided.
            def _wallet_type_str(h) -> str:
                wt = h.wallet_type if hasattr(h, "wallet_type") else h.get("wallet_type")
                return str(wt.value if hasattr(wt, "value") else wt or "").lower()

            has_real_emergency_holding = any(
                _wallet_type_str(h) == "emergency" for h in (portfolio.holdings or [])
            )

            if not (has_real_emergency_holding and emergency_wallet_balance == 0):
                # Generate deterministic UUID v4 for emergency wallet cash,
                # mirroring the life wallet cash row above
                seed = f"{current_user.id}-emergency_wallet_cash".encode()
                hash_bytes = hashlib.md5(seed).digest()
                emergency_wallet_id = UUID(bytes=hash_bytes, version=4)

                emergency_wallet_cash = HoldingResponse(
                    id=emergency_wallet_id,
                    user_id=current_user.id,
                    portfolio_id=portfolio.id,
                    wallet_type="emergency",
                    symbol="CASH-TWD",
                    name="Emergency Cash",
                    type="cash",
                    quantity=float(emergency_wallet_balance),
                    average_cost=1.0,
                    current_price=1.0,
                    total_cost=float(emergency_wallet_balance),
                    total_value=float(emergency_wallet_balance),
                    gain_loss=0.0,
                    gain_loss_percentage=0.0,
                    currency="TWD",
                    exchange="",
                    sector="Cash",
                    region=None,
                    dividend_yield=None,
                    annual_dividend=None,
                    # Same reasoning as life_wallet_cash above — this aggregates
                    # transactions, not one purchase; use "now" instead of the
                    # "Not set" the frontend renders for a missing purchase_date.
                    purchase_date=datetime.now(ZoneInfo("UTC")),
                    is_active=True,
                    last_price_update_at=datetime.now(ZoneInfo("UTC")),
                    metadata={},
                    created_at=datetime.now(ZoneInfo("UTC")),
                    updated_at=datetime.now(ZoneInfo("UTC")),
                    sparkline_data=[],
                )

                # Insert right after life wallet cash so ordering is stable
                portfolio.holdings.insert(1, emergency_wallet_cash)

                logger.info(
                    f"💳 Added emergency wallet cash holding: {emergency_wallet_balance} TWD"
                )
            else:
                logger.info(
                    "💳 Skipped synthetic emergency wallet cash — real holding "
                    "already represents it and there's no transaction-only delta"
                )

        # Rename generic cash holding names based on wallet type (runs regardless of life wallet)
        if portfolio.holdings:
            for holding in portfolio.holdings:
                # Get symbol - handle both dict and object
                symbol = (
                    holding.symbol
                    if hasattr(holding, "symbol")
                    else holding.get("symbol")
                )
                if symbol == "CASH-TWD":
                    # Get wallet_type - handle enum values
                    wallet_type = (
                        holding.wallet_type
                        if hasattr(holding, "wallet_type")
                        else holding.get("wallet_type")
                    )
                    # Convert enum to string if needed
                    if wallet_type and hasattr(wallet_type, "value"):
                        wallet_type_str = wallet_type.value
                    else:
                        wallet_type_str = (
                            str(wallet_type)
                            if wallet_type
                            else "portfolio"
                        )

                    # Get current name
                    current_name = (
                        holding.name
                        if hasattr(holding, "name")
                        else holding.get("name")
                    )

                    # Update name based on wallet type if it's generic
                    if current_name in ["Cash", "Cash (TWD)", "CASH-TWD"]:
                        new_name = current_name  # default to keep current
                        if wallet_type_str == "portfolio":
                            new_name = "Savings Cash"
                        elif wallet_type_str == "emergency":
                            new_name = "Emergency Cash"
                        elif wallet_type_str == "life":
                            new_name = "Life Wallet Cash"

                        # Update the name
                        if hasattr(holding, "name"):
                            holding.name = new_name
                        else:
                            holding["name"] = new_name

                        logger.info(
                            f"💰 Updated cash holding name: {current_name} -> {new_name} (wallet: {wallet_type_str})"
                        )

        # Apply sorting and filtering to holdings if portfolio has holdings
        if portfolio.holdings:
            # Apply filtering
            filtered_holdings = portfolio.holdings

            # Filter by wallet type
            if wallet and wallet.lower() not in ["all", "all_wallets"]:
                filtered_holdings = [
                    h
                    for h in filtered_holdings
                    if (
                        h.wallet_type
                        if hasattr(h, "wallet_type")
                        else h.get("wallet_type", "")
                    ).lower()
                    == wallet.lower()
                ]
                logger.info(
                    f"🔍 Filtered by wallet type '{wallet}': {len(filtered_holdings)} holdings"
                )

            # Filter by market
            if market and market.lower() != "all":
                filtered_holdings = [
                    h
                    for h in filtered_holdings
                    if h.get("market", "").lower() == market.lower()
                ]

            # Filter by asset type
            if type and type.lower() != "all":
                filtered_holdings = [
                    h
                    for h in filtered_holdings
                    if h.get("type", "").lower() == type.lower()
                ]

            # Recalculate portfolio totals based on filtered holdings
            # This ensures the displayed totals match the filtered view
            from decimal import Decimal
            from app.utils.exchange_rate_service import ExchangeRateService

            def safe_decimal(value) -> Decimal:
                """Safely convert value to Decimal"""
                if value is None:
                    return Decimal("0")
                if isinstance(value, Decimal):
                    return value
                if isinstance(value, (int, float)):
                    return Decimal(str(value))
                if isinstance(value, str):
                    try:
                        return Decimal(value)
                    except Exception:
                        return Decimal("0")
                return Decimal("0")

            def get_holding_value(holding, field: str) -> Decimal:
                """Safely get a numeric value from a holding (dict or object)"""
                if isinstance(holding, dict):
                    value = holding.get(field, 0)
                else:
                    value = getattr(holding, field, 0)
                return safe_decimal(value)

            def get_holding_currency(holding) -> str:
                """Get currency from holding (dict or object)"""
                if isinstance(holding, dict):
                    return holding.get("currency", "TWD").upper()
                else:
                    return getattr(holding, "currency", "TWD").upper()

            # Initialize exchange rate service for currency conversion
            exchange_service = ExchangeRateService(db_session=session)

            # Pre-fetch every unique rate up front so the loop below does only
            # in-memory cache lookups. Serial, not gathered: these share this
            # request's session, and concurrent operations on one AsyncSession
            # raise (which used to be swallowed into a missing rate, silently
            # dropping the FX conversion for that currency).
            _unique_currencies = {
                get_holding_currency(h)
                for h in filtered_holdings
                if get_holding_currency(h) != "TWD"
            }
            _prefetched_rates: Dict[str, Any] = {}
            for _currency in _unique_currencies:
                try:
                    _prefetched_rates[_currency] = await exchange_service.get_exchange_rate(
                        from_currency=_currency, to_currency="TWD"
                    )
                except Exception as _fx_err:
                    logger.warning(f"Exchange rate lookup failed for {_currency}: {_fx_err}")
                    _prefetched_rates[_currency] = None

            # Calculate totals with currency conversion to TWD
            filtered_total_value = Decimal("0")
            filtered_total_cost = Decimal("0")

            # When showing all wallets, Portfolio Value = portfolio wallet only.
            # When a specific wallet is selected, that wallet's total is shown.
            specific_wallet = bool(wallet and wallet.lower() not in ("all", "all_wallets"))

            for h in filtered_holdings:
                h_wallet_type = (
                    h.get("wallet_type", "") if isinstance(h, dict)
                    else getattr(h, "wallet_type", "") or ""
                )
                h_wallet_type_str = str(h_wallet_type).lower()

                # Always skip the synthetic life wallet cash row — already counted
                # in Net Worth via the life wallet balance.
                if h_wallet_type_str == "life":
                    continue
                # In the all-wallets view, only sum the portfolio wallet so the
                # "Portfolio Value" stat excludes the emergency wallet.
                if not specific_wallet and h_wallet_type_str == "emergency":
                    continue

                holding_currency = get_holding_currency(h)
                total_value = get_holding_value(h, "total_value")
                total_cost = get_holding_value(h, "total_cost")

                # Convert to TWD if not already in TWD
                if holding_currency != "TWD" and total_value > 0:
                    try:
                        # Synchronous dict lookup — cache is warm from pre-fetch above
                        exchange_rate = _prefetched_rates.get(holding_currency)

                        if exchange_rate:
                            total_value_twd = total_value * exchange_rate
                            total_cost_twd = total_cost * exchange_rate
                            logger.debug(
                                f"💱 Converting {holding_currency} to TWD: "
                                f"Value {total_value} -> {total_value_twd}, "
                                f"Cost {total_cost} -> {total_cost_twd} "
                                f"(rate: {exchange_rate})"
                            )
                        else:
                            # Fallback: use approximate rate if API fails
                            logger.warning(
                                f"⚠️ Exchange rate not available for {holding_currency}->TWD, "
                                f"using approximate rate"
                            )
                            # Approximate rates (fallback only)
                            fallback_rates = {
                                "USD": Decimal("31.5"),  # Approximate USD to TWD
                                "EUR": Decimal("34.0"),  # Approximate EUR to TWD
                                "JPY": Decimal("0.21"),  # Approximate JPY to TWD
                                "CNY": Decimal("4.4"),  # Approximate CNY to TWD
                            }
                            exchange_rate = fallback_rates.get(
                                holding_currency, Decimal("1.0")
                            )
                            total_value_twd = total_value * exchange_rate
                            total_cost_twd = total_cost * exchange_rate
                    except Exception as e:
                        logger.error(
                            f"❌ Currency conversion error for {holding_currency}: {e}"
                        )
                        # Use original values if conversion fails
                        total_value_twd = total_value
                        total_cost_twd = total_cost
                else:
                    # Already in TWD or zero value
                    total_value_twd = total_value
                    total_cost_twd = total_cost

                filtered_total_value += total_value_twd
                filtered_total_cost += total_cost_twd

            filtered_total_gain_loss = filtered_total_value - filtered_total_cost
            filtered_total_gain_loss_percentage = (
                (filtered_total_gain_loss / filtered_total_cost * 100)
                if filtered_total_cost > 0
                else Decimal("0")
            )

            # Update portfolio totals to reflect filtered view (in TWD)
            portfolio.total_value = filtered_total_value
            portfolio.total_cost = filtered_total_cost
            portfolio.total_gain_loss = filtered_total_gain_loss
            portfolio.total_gain_loss_percentage = filtered_total_gain_loss_percentage
            # Totals are now in TWD — update the currency so the frontend formats correctly
            portfolio.currency = "TWD"

            logger.info(
                f"📊 Filtered portfolio totals (TWD): Value={filtered_total_value}, "
                f"Cost={filtered_total_cost}, G/L={filtered_total_gain_loss} "
                f"({filtered_total_gain_loss_percentage:.2f}%), Holdings={len(filtered_holdings)}"
            )

            # Add sparkline data to each holding (last 30 days)
            logger.debug(
                f"🔍 Fetching sparkline data for {len(filtered_holdings)} holdings"
            )
            end_date = business_today()
            start_date = end_date - timedelta(days=30)

            hist_service = get_historical_price_service(session)

            # Collect non-cash symbols for a single batch DB query.
            # Each holding carries every key its history may live under — see
            # _historical_symbol_variants — so a ticker stored in one form still
            # finds a series written in the other.
            holding_symbols: List[Optional[List[str]]] = []
            for holding in filtered_holdings:
                symbol = holding.get("symbol") if isinstance(holding, dict) else holding.symbol
                holding_type = holding.get("type") if isinstance(holding, dict) else holding.type
                if holding_type and holding_type.lower() == "cash":
                    holding_symbols.append(None)
                    continue
                holding_market = (
                    holding.get("market") if isinstance(holding, dict) else holding.market
                )
                holding_symbols.append(
                    _historical_symbol_variants(symbol, holding_market)
                )

            non_cash_symbols = sorted(
                {s for variants in holding_symbols if variants for s in variants}
            )
            prices_by_symbol: Dict[str, list] = {}
            if non_cash_symbols:
                try:
                    prices_by_symbol = await hist_service.repository.get_batch_price_history(
                        non_cash_symbols, start_date, end_date
                    )
                except Exception as e:
                    logger.warning(f"❌ Batch sparkline fetch failed: {str(e)[:100]}")

            sparkline_results = []
            previous_close_results = []

            for variants in holding_symbols:
                if variants is None:
                    # Cash holding — no sparkline
                    sparkline_results.append([])
                    previous_close_results.append(None)
                    continue

                # Pick the freshest series among the candidate keys. A relabelled
                # ticker leaves a dead series behind under its old key; taking the
                # one with the most recent close avoids reading months-old prices.
                valid_prices: List[Dict[str, Any]] = []
                for candidate in variants:
                    candidate_prices = [
                        p for p in prices_by_symbol.get(candidate, [])
                        if p.get("close") and math.isfinite(float(p["close"]))
                    ]
                    if not candidate_prices:
                        continue
                    if not valid_prices or str(candidate_prices[-1].get("date", "")) > str(
                        valid_prices[-1].get("date", "")
                    ):
                        valid_prices = candidate_prices

                sparkline = [float(p["close"]) for p in valid_prices]

                # previous_close = the most recent close strictly before today.
                # Suppressed when that close is too old to be "yesterday": the
                # frontend labels this delta "today", and a gap in the series
                # would silently turn it into a multi-day (or multi-month) change.
                prev_close: Optional[Decimal] = None
                prior_closes = [
                    p for p in valid_prices
                    if str(p.get("date", "")) != end_date.isoformat()
                ]
                if prior_closes:
                    last_close = prior_closes[-1]
                    try:
                        last_close_date = date.fromisoformat(str(last_close["date"]))
                    except ValueError:
                        last_close_date = None
                    if (
                        last_close_date is not None
                        and (end_date - last_close_date).days <= MAX_PREVIOUS_CLOSE_AGE_DAYS
                    ):
                        prev_close = Decimal(str(last_close["close"]))

                sparkline_results.append(sparkline)
                previous_close_results.append(prev_close)

            # Assign sparkline data to holdings
            # Create new HoldingResponse objects with sparkline data to ensure proper serialization
            logger.debug(
                f"📊 Processing {len(sparkline_results)} sparkline results for {len(filtered_holdings)} holdings"
            )
            updated_holdings = []
            for holding, sparkline_data, prev_close in zip(
                filtered_holdings, sparkline_results, previous_close_results
            ):
                # Handle exceptions
                if isinstance(sparkline_data, Exception):
                    sparkline_data = []

                # Convert holding to dict if it's a Pydantic model, otherwise use as-is
                if isinstance(holding, dict):
                    holding_dict = holding.copy()
                    holding_dict["sparkline_data"] = sparkline_data
                    holding_dict["previous_close"] = _pick_previous_close(
                        holding_dict.get("previous_close"), prev_close
                    )
                    logger.debug(
                        f"📊 [DICT] Setting sparkline for {holding_dict.get('symbol')}: {len(sparkline_data)} points"
                    )
                    updated_holdings.append(HoldingResponse(**holding_dict))
                else:
                    # Create a new HoldingResponse with sparkline data
                    holding_dict = holding.model_dump()
                    holding_dict["sparkline_data"] = sparkline_data
                    holding_dict["previous_close"] = _pick_previous_close(
                        holding_dict.get("previous_close"), prev_close
                    )
                    logger.debug(
                        f"📊 [MODEL] Setting sparkline for {holding.symbol}: {len(sparkline_data)} points"
                    )
                    new_holding = HoldingResponse(**holding_dict)
                    logger.debug(
                        f"📊 [VERIFY] Created HoldingResponse for {holding.symbol}, sparkline_data length: {len(new_holding.sparkline_data)}"
                    )
                    updated_holdings.append(new_holding)

            # Apply sorting
            if sortBy:
                sort_key = _get_sort_key(sortBy)
                reverse_order = sortOrder.lower() == "desc"
                updated_holdings = sorted(
                    updated_holdings, key=sort_key, reverse=reverse_order
                )

            portfolio.holdings = updated_holdings

            # Log final state before returning
            holdings_with_sparkline = sum(
                1
                for h in portfolio.holdings
                if h.sparkline_data and len(h.sparkline_data) > 0
            )
            logger.info(
                f"📊 Final portfolio has {holdings_with_sparkline}/{len(portfolio.holdings)} holdings with sparkline data"
            )

        # Manually serialize to JSON with by_alias=True to ensure sparklineData is used
        from fastapi.responses import JSONResponse

        portfolio_dict = portfolio.model_dump(mode="json", by_alias=True)

        return JSONResponse(content=portfolio_dict)

    except (HTTPException, AspiroException):
        # Let typed errors reach the global handlers with their real status codes
        raise
    except Exception:
        logger.exception("Failed to build portfolio overview")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


