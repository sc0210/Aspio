"""Portfolio router: Holdings & portfolio-root endpoints.

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
from sqlalchemy import select, and_, func

from ..models import PortfolioHolding

from app.core.exceptions import AspiroException
from app.utils.datetime_helpers import business_day_of, utc_now

router = APIRouter()

MAX_ACTIVE_HOLDINGS_PER_USER = 2000


@router.get("/holdings", response_model=PaginatedHoldingsResponse)
async def get_holdings(
    current_user=Depends(get_optional_current_user),
    pagination: PaginationParams = Depends(),
    filters: HoldingFilters = Depends(),
    session: AsyncSession = Depends(get_db),
):
    """Get portfolio holdings with filtering and pagination"""

    if not current_user:
        # Return demo holdings for non-authenticated users
        type_filter = getattr(filters, "type", None) or filters.asset_type
        sector_filter = filters.sector

        filtered_holdings = [
            holding
            for holding in DEMO_HOLDINGS
            if (not type_filter or holding.get("type") == type_filter)
            and (not sector_filter or holding.get("sector") == sector_filter)
        ]

        return PaginatedHoldingsResponse(
            items=[HoldingResponse(**holding) for holding in filtered_holdings],
            total=len(filtered_holdings),
            page=1,
            size=len(filtered_holdings),
            pages=1,
        )

    try:
        portfolio_service = get_portfolio_service(session)
        holdings, total = await portfolio_service.get_user_holdings(
            user_id=current_user.id,
            skip=(pagination.page - 1) * pagination.limit,
            limit=pagination.limit,
        )

        meta = PaginationMeta.create(pagination.page, pagination.limit, total)

        return PaginatedHoldingsResponse(
            items=holdings,
            total=total,
            page=pagination.page,
            size=pagination.limit,
            pages=meta.total_pages,
        )

    except (HTTPException, AspiroException):
        # Let typed errors reach the global handlers with their real status codes
        raise
    except Exception:
        logger.exception("Failed to retrieve holdings")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.post(
    "/holdings", response_model=HoldingResponse, status_code=status.HTTP_201_CREATED
)
async def add_holding(
    holding_data: HoldingCreate,
    background_tasks: BackgroundTasks,
    aggregate: bool = Query(
        False,
        description="If true, aggregate with existing holdings of same symbol. If false, create new lot.",
    ),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Add a new holding to the portfolio (supports both authenticated and demo mode)

    Args:
        holding_data: Holding data to add
        aggregate: If True, aggregate with existing holdings of same symbol.
                  If False, always create a new lot (useful for CSV imports)
    """

    logger.debug(
        f"add_holding called with user: {current_user.id if current_user else 'None'}, symbol: {holding_data.symbol}, aggregate={aggregate}"
    )

    if not current_user:
        # Demo mode - return a mock holding
        logger.debug("DEMO MODE: Creating demo holding without authentication")
        from uuid import uuid4

        demo_holding = HoldingResponse(
            id=str(uuid4()),
            symbol=holding_data.symbol,
            name=holding_data.name + " [DEMO]",  # Mark as demo
            type=holding_data.type,
            quantity=holding_data.quantity,
            average_cost=holding_data.average_cost,
            current_price=holding_data.average_cost,
            total_cost=holding_data.quantity * holding_data.average_cost,
            total_value=holding_data.quantity * holding_data.average_cost,
            gain_loss=Decimal("0"),
            gain_loss_percentage=Decimal("0"),
            currency=holding_data.currency,
            exchange=holding_data.exchange,
            # What the request resolved to (HoldingCreate sets TW for a Taiwan
            # code), not a hard-coded "US" that flagged a demo 0050 as American.
            market=holding_data.market or "US",
            sector=holding_data.sector,
            region=holding_data.region,
            dividend_yield=None,
            annual_dividend=None,
            purchase_date=holding_data.purchase_date or utc_now(),
            notes=holding_data.notes,
            is_active=True,
            last_price_update_at=utc_now(),
            metadata={},
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        return demo_holding

    try:
        portfolio_service = get_portfolio_service(session)
        # Every active holding's symbol is fetched from outside providers on each
        # all-users price run, so one account's holding count spends shared budget.
        active_count = (
            await session.execute(
                select(func.count(PortfolioHolding.id)).where(
                    PortfolioHolding.user_id == current_user.id,
                    PortfolioHolding.is_active == True,  # noqa: E712
                )
            )
        ).scalar_one()
        if active_count >= MAX_ACTIVE_HOLDINGS_PER_USER:
            raise ValueError(f"Holding limit reached ({MAX_ACTIVE_HOLDINGS_PER_USER} active holdings)")

        holding = await portfolio_service.add_holding(
            current_user.id, holding_data, aggregate=aggregate
        )

        # ⚡ PERFORMANCE: Removed unnecessary portfolio refresh
        # Frontend will refetch portfolio via React Query invalidation

        # Queue historical data fetch as background task (non-blocking)
        # This ensures daily performance charts have data without slowing down imports
        # Skip fetching for non-tradeable symbols (savings accounts, etc.)
        skip_symbols = ["SAVINGS", "CRYPTO", "CASH"]
        should_fetch = (
            holding_data.symbol.upper() not in skip_symbols
            and holding_data.type in ["stock", "etf", "crypto"]
        )

        if should_fetch:
            market = "US"
            if hasattr(holding_data, "market") and holding_data.market:
                market = holding_data.market
            elif hasattr(holding_data, "exchange") and holding_data.exchange:
                # Infer market from exchange
                if (
                    "TW" in holding_data.exchange.upper()
                    or "TAIWAN" in holding_data.exchange.upper()
                ):
                    market = "TW"
                elif "CRYPTO" in holding_data.exchange.upper():
                    market = "CRYPTO"

            background_tasks.add_task(
                fetch_historical_data_background,
                symbol=holding_data.symbol,
                market=market,
                days=90,
            )
            logger.info(
                f"Queued background historical data fetch for {holding_data.symbol}"
            )
        else:
            logger.info(
                f"Skipped historical data fetch for non-tradeable symbol: {holding_data.symbol}"
            )

        return holding

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/holdings/{holding_id}", response_model=HoldingResponse)
async def get_holding(
    holding_id: UUID,
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get a single portfolio holding by ID (supports both authenticated and demo mode)"""

    if not current_user:
        # Demo mode - return a mock holding
        from uuid import uuid4

        demo_holding = HoldingResponse(
            id=str(holding_id),
            symbol="DEMO",
            name="Demo Holding",
            type="stock",
            quantity=10,
            average_cost=100.0,
            current_price=105.0,
            total_cost=10 * 100.0,
            total_value=10 * 105.0,
            gain_loss=10 * 5.0,
            gain_loss_percentage=5.0,
            currency="USD",
            exchange="DEMO",
            market="US",
            sector="Technology",
            region=None,
            dividend_yield=None,
            annual_dividend=None,
            purchase_date=utc_now(),
            notes=None,
            is_active=True,
            last_price_update_at=utc_now(),
            metadata={},
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        return demo_holding

    try:
        holding_service = get_holding_repository(session)
        holding = await holding_service.get_by_id(holding_id, current_user.id)

        if not holding:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Holding with id {holding_id} not found",
            )

        return HoldingResponse.model_validate(holding)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting holding {holding_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.put("/holdings/{holding_id}", response_model=HoldingResponse)
async def update_holding(
    holding_id: UUID,
    holding_updates: HoldingUpdate,
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Update a portfolio holding (supports both authenticated and demo mode)

    When quantity or average_cost is updated, a corresponding transaction is created
    to maintain transaction history.
    """

    if not current_user:
        # Demo mode - return a mock updated holding
        from uuid import uuid4

        demo_holding = HoldingResponse(
            id=str(holding_id),
            symbol="DEMO",
            name="Demo Holding Updated",
            type="stock",
            quantity=10,
            average_cost=100.0,
            current_price=105.0,
            total_cost=10 * 100.0,
            total_value=10 * 105.0,
            gain_loss=10 * 5.0,
            gain_loss_percentage=5.0,
            currency="USD",
            exchange="DEMO",
            market="US",
            sector="Technology",
            region=None,
            dividend_yield=None,
            annual_dividend=None,
            purchase_date=utc_now(),
            notes=None,
            is_active=True,
            last_price_update_at=utc_now(),
            metadata={},
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        return demo_holding

    try:
        from ..manual_pricing import is_manually_priced
        from ..models import PortfolioHolding
        from ..services import PortfolioService
        from decimal import Decimal

        holding_service = get_holding_repository(session)

        # Get the original holding first to track changes
        original_holding = await holding_service.get_by_id(holding_id, current_user.id)
        if not original_holding:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Holding not found or does not belong to user",
            )

        # A price can be set by hand only where no feed sets it: the next price
        # refresh would silently overwrite it on a quoted holding.
        if holding_updates.current_price is not None and not is_manually_priced(
            original_holding.symbol, original_holding.type
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"{original_holding.symbol} is priced from market data, "
                    "so its current price cannot be set by hand."
                ),
            )

        # Copy the previous values out as plain numbers BEFORE updating.
        #
        # `original_holding` and `holding` are the same Python object: SQLAlchemy's
        # identity map hands back one instance per row per session, so mutating it
        # in update_holding() also "changes the past". Comparing the request
        # against original_holding.* afterwards therefore compared the new value
        # with itself and was always False — the ledger-sync block below never ran
        # once, which is why editing a holding left its wallet transaction alone.
        previous_quantity = Decimal(str(original_holding.quantity))
        previous_cost = Decimal(str(original_holding.average_cost))
        previous_purchase_day = business_day_of(original_holding.purchase_date)

        # Update the holding
        holding = await holding_service.update_holding(
            holding_id=holding_id,
            user_id=current_user.id,
            updates=holding_updates.model_dump(exclude_unset=True),
        )

        if not holding:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Holding not found or does not belong to user",
            )

        # A price belongs to the security, not the lot: every unit of USDT-LEND
        # is worth the same, and the holding view reads one price for all lots.
        # So a hand-set price lands on each active lot of the symbol.
        if holding_updates.current_price is not None:
            lots = (
                await session.execute(
                    select(PortfolioHolding).where(
                        and_(
                            PortfolioHolding.portfolio_id == holding.portfolio_id,
                            PortfolioHolding.user_id == current_user.id,
                            PortfolioHolding.symbol == holding.symbol,
                            PortfolioHolding.is_active == True,  # noqa: E712
                        )
                    )
                )
            ).scalars().all()
            for lot in lots:
                await holding_service.update_holding_prices(
                    lot.id, Decimal(str(holding_updates.current_price))
                )

        # Correct the linked wallet transaction if quantity, average_cost or the
        # purchase date changed.
        quantity_changed = (
            holding_updates.quantity is not None
            and Decimal(str(holding_updates.quantity)) != previous_quantity
        )
        cost_changed = (
            holding_updates.average_cost is not None
            and Decimal(str(holding_updates.average_cost)) != previous_cost
        )
        # Compared as business DAYS, not instants: the ledger leg stores a day, so
        # two stamps that differ only in wall-clock time are not a change to it.
        date_changed = (
            holding_updates.purchase_date is not None
            and business_day_of(holding_updates.purchase_date) != previous_purchase_day
        )

        if quantity_changed or cost_changed or date_changed:
            # Correct the Life Wallet expense that paid for this holding, rather
            # than posting a delta entry beside it. A holding edit means "what I
            # recorded was wrong", so the ledger should end up saying what the
            # user now says they spent — otherwise the wallet carries both the
            # original figure and a correction, and the running balance is right
            # only if you read every row.
            #
            # This block previously built a transactions.Transaction using
            # PortfolioTransaction fields (portfolio_id, symbol, quantity, price,
            # total_amount, category=...). Those are not columns on that model, so
            # it raised TypeError, hit the `except Exception` below, rolled back,
            # and returned 500 — editing quantity or cost could never save at all.
            new_qty = (
                holding_updates.quantity
                if holding_updates.quantity is not None
                else previous_quantity
            )
            new_cost = (
                holding_updates.average_cost
                if holding_updates.average_cost is not None
                else previous_cost
            )
            old_qty = previous_quantity
            old_cost = previous_cost

            new_total = Decimal(str(new_qty)) * Decimal(str(new_cost))

            # holding_id is set on more than the leg that paid for the holding, so
            # the rows are sorted before anything is written.
            #
            # `legs`        the purchase legs — what a correction applies to.
            # `offsetting`  INCOME rows, which a cash withdrawal books against the
            #               same holding. They mean the deposit leg no longer equals
            #               the lot on its own, so "one leg, one lot total" is false
            #               and the amount rewrite must not run: it would restate
            #               the deposit while leaving the withdrawal beside it, and
            #               the same money would sit in two wallets.
            # cancelled or failed rows are ignored entirely — they count toward no
            # total, so they neither take a correction nor block one.
            #
            # The same partition tells the edit form (GET /transactions/{id},
            # holding_sole_purchase) whether a buy may be edited through this
            # endpoint, so the page and this rewrite cannot disagree.
            from ...transactions.repositories import TransactionRepository

            linked_rows, legs, offsetting = await TransactionRepository(
                session
            ).holding_purchase_legs(holding.id, current_user.id)

            # Name what changed, so a warning below points at the right thing.
            edited = " and ".join(
                part
                for part in (
                    "amount" if quantity_changed or cost_changed else "",
                    "date" if date_changed else "",
                )
                if part
            )

            # A lot can carry more than one Life leg: `?aggregate=true` folds a
            # buy into an existing lot when its purchase instant matches exactly
            # (repositories.py::create_or_aggregate_holding), and add_holding
            # bridges each buy separately with the same holding_id. The
            # transactions "add expense → buy holding" flow uses it, so this is a
            # shape production has. The lookup above used to be `.first()` on an
            # unordered query, which corrected an arbitrary one of them.
            if not legs:
                # Holdings bought before transactions.holding_id existed have no
                # link (the backfill leaves ambiguous ones NULL on purpose). Say
                # so and move on — refusing the edit would be worse than an
                # out-of-step ledger the user can correct by hand.
                logger.warning(
                    "Holding %s had its %s edited but has no linked purchase leg "
                    "(%d other linked row(s)); the Life Wallet is unchanged.",
                    holding.id, edited, len(linked_rows),
                )
            else:
                if quantity_changed or cost_changed:
                    # Only when the money moved. A date-only edit reaches this
                    # block now, and restating the amount there would rewrite a
                    # figure nobody touched — at today's FX rate, via _to_twd,
                    # rather than the one the purchase was booked at.
                    if len(legs) == 1 and not offsetting:
                        # _to_twd lives in here, not above: on a multi-leg lot its
                        # result goes unused, and it is two Currency queries inside
                        # the open transaction whose errors it swallows — enough to
                        # abort the commit and 500 an edit that should only log.
                        twd_amount, display_currency = await PortfolioService(
                            session
                        )._to_twd(new_total, holding.currency or "TWD")

                        linked = legs[0]
                        previous_amount = linked.amount
                        linked.amount = twd_amount
                        linked.currency = display_currency
                        linked.description = (
                            f"Buy {holding.symbol} ×{Decimal(str(new_qty)):g} @ "
                            f"{Decimal(str(new_cost)):,.2f} "
                            f"{(holding.currency or 'TWD').upper()}"
                        )
                        logger.info(
                            "Holding %s edited (qty %s→%s, cost %s→%s); corrected "
                            "wallet transaction %s from %s to %s %s",
                            holding.id, old_qty, new_qty, old_cost, new_cost,
                            linked.id, previous_amount, twd_amount, display_currency,
                        )
                    else:
                        # Either several purchase legs, or one with cash withdrawn
                        # against it. In both cases no single row equals the lot:
                        # the legs already sum to the old total, so writing the new
                        # one onto one of them double counts (60k becoming
                        # 66k+20k+30k), and splitting it across them means inventing
                        # per-buy figures the lot no longer holds — it keeps one
                        # average cost, not a price per buy. So leave the rows as
                        # entered and say so: which way the ledger should read here
                        # is the user's call, not a default to pick silently.
                        # Reported in the holding's own currency. A TWD delta
                        # against the legs would fold in FX drift — they were booked
                        # at the rate of the day, _to_twd converts at today's — and
                        # for a currency it cannot convert it returns the native
                        # amount, which makes the subtraction meaningless.
                        logger.warning(
                            "Holding %s had its amount edited (%s → %s %s) but "
                            "carries %d purchase leg(s) and %d offsetting income "
                            "row(s); left them as entered, so the Life Wallet still "
                            "shows the old total and no longer matches the cost "
                            "basis.",
                            holding.id,
                            Decimal(str(old_qty)) * Decimal(str(old_cost)),
                            new_total,
                            (holding.currency or "TWD").upper(),
                            len(legs), len(offsetting),
                        )

                if date_changed:
                    # Same rule as the buy leg. Reading `.date()` here directly
                    # would re-date an expense the buy path had just booked
                    # correctly: a purchase stamped 2026-08-31T20:00Z is 09-01 in
                    # Taipei, so an edit that resent the same date moved it back
                    # into August.
                    new_day = business_day_of(holding_updates.purchase_date)
                    leg_days = {leg.transaction_date for leg in legs}

                    # One leg is ASSUMED to be the holding's own purchase leg, and
                    # follows the date the user just gave the holding whatever day
                    # it currently sits on. That assumption is not free: a lone leg
                    # could instead be a later no-date merge onto a lot whose
                    # original leg the backfill left unlinked, and then this moves a
                    # real purchase to another day. It is taken because the
                    # alternative — requiring the leg to already agree — leaves this
                    # branch's headline case, a drifted single leg, unable to
                    # repair itself, and drift is what the out-of-step rows in the
                    # database actually are (see the prod_sql script above, which
                    # counts them). With several legs there is no such majority
                    # reading, so only the ones on the day being corrected move.
                    #
                    # Legs that agree on some OTHER day are deliberately left: they
                    # could be drift from the bug fixed above (which moved
                    # purchase_date and left the ledger), or two genuine buys that
                    # merged into an older lot on the same day — `?aggregate=true`
                    # with no purchase_date merges into the most recent lot and
                    # dates its leg today. Nothing here can tell those apart, and
                    # guessing wrong moves real purchases out of the month they
                    # happened in, which is the harm this branch exists to stop.
                    # Drifted lots are repaired by
                    # scripts/prod_sql/2026_09_25_realign_drifted_holding_legs.sql,
                    # which a person runs having looked at the rows.
                    claimed = [
                        leg for leg in legs
                        if leg.transaction_date == previous_purchase_day
                    ]
                    moving = legs if len(legs) == 1 else claimed

                    for leg in moving:
                        leg.transaction_date = new_day

                    if not moving:
                        # Legs spread over days the holding does not claim —
                        # reachable through the other aggregation path, which merges
                        # into the most recent lot whatever its date. Those days are
                        # real purchases; flattening them would erase what the user
                        # recorded, and picking one is guesswork.
                        logger.warning(
                            "Holding %s re-dated (%s→%s) but its %d linked wallet "
                            "transactions sit on %s, none of them on the day being "
                            "corrected; left them as entered rather than collapsing "
                            "days the holding does not claim.",
                            holding.id, previous_purchase_day, new_day, len(legs),
                            sorted(str(day) for day in leg_days),
                        )
                    elif len(moving) < len(legs):
                        logger.warning(
                            "Holding %s re-dated (%s→%s); moved %d of %d linked "
                            "wallet transactions — the rest sit on %s, days the "
                            "holding does not claim, and were left as entered.",
                            holding.id, previous_purchase_day, new_day,
                            len(moving), len(legs),
                            sorted(
                                str(leg.transaction_date)
                                for leg in legs if leg not in moving
                            ),
                        )
                    else:
                        logger.info(
                            "Holding %s re-dated (%s→%s); moved %d wallet "
                            "transaction(s) with it",
                            holding.id, previous_purchase_day, new_day, len(legs),
                        )

        await session.commit()
        await session.refresh(holding)

        return holding

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update holding: {str(e)}", exc_info=True)
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.patch("/holdings/symbol/{symbol}")
async def update_holdings_by_symbol(
    symbol: str,
    updates: Dict[str, Any] = Body(...),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Update all holdings with the same symbol (useful for updating name/sector across all lots)

    Args:
        symbol: The symbol to update
        updates: Dictionary with 'name' and/or 'sector' fields
    """

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    try:
        portfolio_service = get_portfolio_service(session)
        default_portfolio = await portfolio_service.get_default_portfolio(
            current_user.id
        )

        if not default_portfolio:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="No portfolio found"
            )

        holding_repo = get_holding_repository(session)

        # Get all lots for this symbol
        lots = await holding_repo.get_all_lots_by_symbol(
            portfolio_id=default_portfolio.id,
            symbol=symbol.upper(),
            user_id=current_user.id,
        )

        if not lots:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No holdings found for symbol {symbol}",
            )

        # Update each lot with the new name/sector
        updated_count = 0
        for lot in lots:
            update_data = {}
            if "name" in updates and updates["name"]:
                update_data["name"] = updates["name"]
            if "sector" in updates and updates["sector"]:
                update_data["sector"] = updates["sector"]

            if update_data:
                await holding_repo.update_holding(
                    holding_id=lot.id, user_id=current_user.id, updates=update_data
                )
                updated_count += 1

        await session.commit()

        return ApiResponse.success_response(
            data={"updated_count": updated_count},
            message=f"Updated {updated_count} holdings for symbol {symbol}",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating holdings by symbol: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/holdings/symbol/{symbol}/lots")
async def get_holding_lots_by_symbol(
    symbol: str,
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get all lots for a specific symbol in the user's portfolio"""

    if not current_user:
        # Demo mode - return empty list
        return ApiResponse.success_response(data=[], message="No lots in demo mode")

    try:
        portfolio_service = get_portfolio_service(session)
        default_portfolio = await portfolio_service.get_default_portfolio(
            current_user.id
        )

        if not default_portfolio:
            return ApiResponse.success_response(data=[], message="No portfolio found")

        holding_repo = get_holding_repository(session)
        lots = await holding_repo.get_all_lots_by_symbol(
            portfolio_id=default_portfolio.id, symbol=symbol, user_id=current_user.id
        )

        # Convert to dict format
        lots_data = [
            {
                "id": str(lot.id),
                "symbol": lot.symbol,
                "name": lot.name,
                "type": lot.type,
                "exchange": lot.exchange,
                "currency": lot.currency,
                "sector": lot.sector,
                "region": lot.region,
                "quantity": float(lot.quantity),
                "averageCost": float(lot.average_cost),
                "currentPrice": float(lot.current_price),
                "totalCost": float(lot.total_cost),
                "totalValue": float(lot.total_value),
                "gainLoss": float(lot.gain_loss),
                "gainLossPercentage": float(lot.gain_loss_percentage),
                "dividendYield": (
                    float(lot.dividend_yield) if lot.dividend_yield else None
                ),
                "annualDividend": (
                    float(lot.annual_dividend) if lot.annual_dividend else None
                ),
                "purchaseDate": (
                    lot.purchase_date.isoformat() if lot.purchase_date else None
                ),
                "notes": lot.notes,
                "isActive": lot.is_active,
                "lastPriceUpdateAt": (
                    lot.last_price_update_at.isoformat()
                    if lot.last_price_update_at
                    else None
                ),
                "metadata": lot.item_metadata,
                "createdAt": lot.created_at.isoformat(),
                "updatedAt": lot.updated_at.isoformat(),
            }
            for lot in lots
        ]

        return ApiResponse.success_response(
            data=lots_data, message=f"Found {len(lots_data)} lot(s) for {symbol}"
        )

    except Exception as e:
        logger.error(f"Failed to retrieve holding lots: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/holdings/symbol/{symbol}/transactions")
async def get_holding_transactions(
    symbol: str,
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    transaction_type: Optional[str] = Query(
        None, description="Filter by transaction type (buy, sell, dividend, etc.)"
    ),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get transaction history for a specific symbol in the user's portfolio.

    Returns all portfolio transactions (buy, sell, dividend, split, etc.) for the given symbol.
    Useful for calculating IRR and showing investment history.
    """

    if not current_user:
        # Demo mode - return sample transactions
        return ApiResponse.success_response(
            data=[], message="No transaction history in demo mode"
        )

    try:
        portfolio_service = get_portfolio_service(session)
        default_portfolio = await portfolio_service.get_default_portfolio(
            current_user.id
        )

        if not default_portfolio:
            return ApiResponse.success_response(data=[], message="No portfolio found")

        transaction_repo = get_transaction_repository(session)
        transactions, total = await transaction_repo.get_portfolio_transactions(
            portfolio_id=default_portfolio.id,
            user_id=current_user.id,
            skip=skip,
            limit=limit,
            transaction_type=transaction_type,
            symbol=symbol.upper(),
        )

        # Convert to dict format
        transactions_data = [
            {
                "id": str(txn.id),
                "portfolioId": str(txn.portfolio_id),
                "holdingId": str(txn.holding_id) if txn.holding_id else None,
                "symbol": txn.symbol,
                "type": txn.type,
                "quantity": float(txn.quantity),
                "price": float(txn.price),
                "fees": float(txn.fees) if txn.fees else 0,
                "totalAmount": float(txn.total_amount),
                "currency": txn.currency,
                "transactionDate": (
                    txn.transaction_date.isoformat() if txn.transaction_date else None
                ),
                "notes": txn.notes,
                "metadata": txn.item_metadata,
                "createdAt": txn.created_at.isoformat(),
                "updatedAt": txn.updated_at.isoformat(),
            }
            for txn in transactions
        ]

        return ApiResponse.success_response(
            data=transactions_data,
            message=f"Found {len(transactions_data)} transaction(s) for {symbol}",
            meta=PaginationMeta.create(page=skip // limit + 1, limit=limit, total=total),
        )

    except Exception as e:
        logger.error(f"Failed to retrieve transactions for {symbol}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.post("/portfolio/calculate-irr")
async def calculate_portfolio_irr(
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Calculate and update IRR for all holdings in the user's portfolio.
    This endpoint processes all holdings and updates their IRR values based on transaction history.
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to calculate IRR",
        )

    try:
        # Get user's default portfolio
        portfolio_repo = get_portfolio_repository(session)
        # Returns (portfolios, total); the bare tuple was always truthy.
        portfolios, _ = await portfolio_repo.get_user_portfolios(current_user.id)

        if not portfolios:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No portfolio found for user",
            )

        default_portfolio = next((p for p in portfolios if p.is_default), portfolios[0])

        # Calculate IRR for all holdings
        irr_service = get_irr_update_service(session)
        summary = await irr_service.update_all_holdings_irr(
            user_id=current_user.id, portfolio_id=default_portfolio.id
        )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"message": "IRR calculation completed", "summary": summary},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to calculate IRR: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.delete("/holdings/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_holding(
    holding_id: UUID,
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Remove a holding from the portfolio (supports both authenticated and demo mode)"""

    logger.info(
        f"DELETE request received for holding {holding_id}, user: {current_user.id if current_user else 'None (demo)'}, user_obj: {current_user}"
    )

    if not current_user:
        # Demo mode - just return success (no actual deletion needed)
        logger.warning(
            f"Demo mode: Skipping actual deletion for holding {holding_id}. This means no authentication token was provided."
        )
        return

    try:
        # Get the holding first to verify it exists and get portfolio_id
        holding_repo = get_holding_repository(session)

        # Verify holding exists and belongs to user
        holding = await holding_repo.get_by_id(holding_id, current_user.id)
        if not holding:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Holding not found or does not belong to user",
            )

        portfolio_id = holding.portfolio_id

        # Reverse the Life Wallet expense that paid for this holding.
        #
        # Deleting a holding means "this purchase should not be on my books" —
        # a correction, not a disposal. Selling has its own path
        # (credit_sale_proceeds_to_life) which credits proceeds at the sale
        # price; conflating the two would book a gain or loss the user never
        # realised. So the purchase entry is withdrawn, returning exactly the
        # cash it took out.
        #
        # Previously nothing here touched the ledger at all: the asset vanished
        # from the Portfolio wallet while the cash stayed spent, so Total Asset
        # silently dropped by the whole cost basis.
        from ...transactions.models import Transaction

        # EVERY linked row, unlike the edit path above, which takes only completed
        # expenses. That difference is deliberate: an edit corrects one purchase, so
        # it must not touch a cash withdrawal's income leg or a cancelled row, while
        # a delete says the holding should not be on the books at all — leaving its
        # withdrawal behind would credit Life for cash that never went anywhere.
        linked_txns = (
            await session.execute(
                select(Transaction).where(
                    and_(
                        Transaction.holding_id == holding_id,
                        Transaction.user_id == current_user.id,
                        Transaction.is_deleted == False,  # noqa: E712
                    )
                )
            )
        ).scalars().all()

        for txn in linked_txns:
            # Soft delete, matching how transactions are removed everywhere else,
            # so the entry stays auditable rather than disappearing outright.
            txn.is_deleted = True
            txn.deleted_at = datetime.now(timezone.utc)
            logger.info(
                "Holding %s deleted; withdrew linked wallet transaction %s (%s %s)",
                holding_id, txn.id, txn.amount, txn.currency,
            )
        if not linked_txns:
            logger.warning(
                "Holding %s deleted but no linked wallet transaction was found; "
                "the original Life Wallet expense (if any) remains.",
                holding_id,
            )

        # Perform soft delete
        success = await holding_repo.delete_holding(
            holding_id=holding_id, user_id=current_user.id
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Failed to delete holding"
            )

        # Explicitly commit the transaction
        await session.commit()

        # Expire all cached objects to ensure fresh data on next fetch
        session.expire_all()

        logger.info(
            f"✅ Successfully deleted holding {holding_id} for user {current_user.id}"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete holding {holding_id}: {str(e)}")
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.post("/holdings/{holding_id}/sell")
async def sell_holding(
    holding_id: UUID,
    quantity: Decimal = Body(..., gt=0, description="Quantity to sell"),
    price: Optional[Decimal] = Body(
        None, gt=0, description="Sale price (uses current market price if not provided)"
    ),
    fees: Decimal = Body(Decimal("0"), ge=0, description="Transaction fees"),
    taxes: Decimal = Body(Decimal("0"), ge=0, description="Taxes on sale"),
    notes: Optional[str] = Body(None, description="Optional notes"),
    transaction_date: Optional[datetime] = Body(
        None, description="Transaction date (defaults to now)"
    ),
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Sell a holding and credit proceeds to cash wallet.

    This endpoint:
    1. Validates the holding and quantity
    2. Creates a 'sell' transaction
    3. Reduces the holding quantity (or marks as inactive if fully sold)
    4. Credits net proceeds to the portfolio's CASH holding
    5. Returns transaction details including realized gain/loss
    """

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required for sell transactions",
        )

    try:
        from ..sell_schemas import SellHoldingResponse
        from ..models import PortfolioTransaction
        from ..cost_basis import allocate_fifo, total_available

        holding_repo = get_holding_repository(session)

        # The holding_id identifies the position; the sell draws down all active
        # lots of that symbol (FIFO), not just this one lot.
        holding = await holding_repo.get_by_id(holding_id, current_user.id)
        if not holding:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Holding not found or does not belong to user",
            )

        # All active lots for this symbol+wallet, oldest purchase first (FIFO).
        lots = await holding_repo.get_sellable_lots(
            holding.portfolio_id,
            holding.symbol,
            current_user.id,
            wallet_type=holding.wallet_type,
        )
        available = total_available(lots)
        if available < quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient quantity. You have {available} but trying to sell {quantity}",
            )

        # Use current market price if not provided
        sale_price = price if price is not None else holding.current_price
        if sale_price <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sale price must be positive. Please provide a valid price or update current market price.",
            )

        # FIFO allocation across lots determines the cost basis of the sale.
        allocation = allocate_fifo(lots, quantity)
        cost_basis = allocation.cost_basis

        # Calculate transaction amounts
        total_proceeds = quantity * sale_price
        net_proceeds = total_proceeds - fees - taxes
        realized_gain_loss = total_proceeds - cost_basis - fees - taxes
        realized_gain_loss_pct = (
            (realized_gain_loss / cost_basis * Decimal("100"))
            if cost_basis > 0
            else Decimal("0")
        )

        now = datetime.now(timezone.utc)

        # Draw down each consumed lot oldest-first.
        for consumption in allocation.consumptions:
            lot = consumption.lot
            lot.quantity = lot.quantity - consumption.quantity_taken
            if lot.quantity <= 0:
                lot.is_active = False
                lot.quantity = Decimal("0")
                lot.total_cost = Decimal("0")
                lot.total_value = Decimal("0")
                lot.gain_loss = Decimal("0")
            else:
                lot.total_cost = lot.quantity * lot.average_cost
                lot.total_value = lot.quantity * lot.current_price
                lot.gain_loss = lot.total_value - lot.total_cost
                if lot.total_cost > 0:
                    lot.gain_loss_percentage = (
                        lot.gain_loss / lot.total_cost
                    ) * Decimal("100")
            lot.updated_at = now

        # Quantity left for this symbol across all lots after the sale.
        remaining_quantity = available - quantity

        # Record a single sell transaction with the FIFO cost-basis audit trail.
        transaction = PortfolioTransaction(
            portfolio_id=holding.portfolio_id,
            holding_id=holding.id,
            user_id=current_user.id,
            symbol=holding.symbol,
            exchange=holding.exchange,
            type="sell",
            quantity=quantity,
            price=sale_price,
            total_amount=total_proceeds,
            fees=fees,
            taxes=taxes,
            currency=holding.currency,
            transaction_date=transaction_date or now,
            notes=notes or f"Sold {quantity} shares of {holding.symbol}",
            cost_basis_method="FIFO",
            lot_ids=allocation.lot_ids,
            cost_basis=cost_basis,
            capital_gain=realized_gain_loss,
        )
        session.add(transaction)

        # Sale proceeds return to the Life Wallet — the Portfolio wallet holds
        # assets only, never cash. This mirrors the Life-Wallet EXPENSE a buy
        # creates, so a buy→sell round trip nets to zero in the Life Wallet
        # (minus fees/taxes and ± realized gain/loss).
        portfolio_service = get_portfolio_service(session)
        await portfolio_service.credit_sale_proceeds_to_life(
            user_id=current_user.id,
            net_proceeds=net_proceeds,
            currency=holding.currency,
            symbol=holding.symbol,
            transaction_date=transaction_date or now,
        )

        # Commit all changes
        await session.commit()
        await session.refresh(transaction)
        await session.refresh(holding)

        logger.info(
            f"✅ Sold {quantity} of {holding.symbol} for {sale_price} each. "
            f"Net proceeds: {net_proceeds}, Realized G/L: {realized_gain_loss}"
        )

        # Return response
        response = SellHoldingResponse(
            transaction_id=transaction.id,
            holding_id=holding.id,
            symbol=holding.symbol,
            quantity_sold=quantity,
            sale_price=sale_price,
            total_proceeds=total_proceeds,
            fees=fees,
            taxes=taxes,
            net_proceeds=net_proceeds,
            realized_gain_loss=realized_gain_loss,
            realized_gain_loss_percentage=realized_gain_loss_pct,
            remaining_quantity=remaining_quantity,
            # Proceeds now flow to the Life Wallet (no in-portfolio cash holding).
            cash_wallet_balance=net_proceeds,
            transaction_date=transaction.transaction_date,
        )

        return ApiResponse.success_response(
            data=response.model_dump(),
            message=f"Successfully sold {quantity} shares of {holding.symbol}",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to sell holding {holding_id}: {str(e)}", exc_info=True)
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


@router.get("/realized-pnl")
async def get_realized_pnl(
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Total realized profit/loss from completed sells (sum of FIFO capital gains).

    Unauthenticated/demo callers get zeros so the UI simply hides the card.
    """
    if not current_user:
        return ApiResponse.success_response(
            data={"realized_gain_loss": 0, "realized_count": 0}
        )

    txn_repo = get_transaction_repository(session)
    realized, count = await txn_repo.sum_realized_pnl(current_user.id)
    return ApiResponse.success_response(
        data={"realized_gain_loss": float(realized), "realized_count": count}
    )


@router.get("/cash-wallet")
async def get_cash_wallet(
    current_user=Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get current cash wallet balance(s) for the user's portfolio.

    Returns all CASH holdings grouped by currency.
    """

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    try:
        portfolio_service = get_portfolio_service(session)
        portfolio = await portfolio_service.get_default_portfolio(current_user.id)

        if not portfolio:
            return ApiResponse.success_response(
                data={"wallets": []}, message="No portfolio found"
            )

        # Get all CASH holdings
        cash_holdings = [
            h for h in portfolio.holdings if h.type == "cash" and h.is_active
        ]

        wallets = []
        for holding in cash_holdings:
            wallets.append(
                {
                    "portfolio_id": str(portfolio.id),
                    "currency": holding.currency,
                    "balance": float(holding.quantity),
                    "symbol": holding.symbol,
                    "wallet_type": (
                        holding.wallet_type.value
                        if hasattr(holding.wallet_type, "value")
                        else str(holding.wallet_type)
                    ),
                    "name": holding.name,
                    "last_updated": holding.updated_at.isoformat(),
                }
            )

        return ApiResponse.success_response(
            data={"wallets": wallets, "total_wallets": len(wallets)},
            message=f"Retrieved {len(wallets)} cash wallet(s)",
        )

    except Exception as e:
        logger.error(f"Failed to get cash wallet: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred",
        )


# Market Data Endpoints
