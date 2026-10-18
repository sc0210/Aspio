"""
FastAPI router for transaction endpoints in the Aspiro personal finance application.
Provides comprehensive REST API for transaction management with Asian market features.
"""

import logging
from datetime import date, datetime, timezone

logger = logging.getLogger(__name__)
from typing import Optional, List
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Path,
    Body,
    UploadFile,
    File,
    status,
)
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.core.database import get_db, get_async_session

from app.core.exceptions import AspiroException, ValidationException
from app.modules.users.dependencies import (
    get_current_active_user as get_current_user,
    get_optional_current_user,
)
from app.modules.users.models import User
from app.modules.admin.dependencies import get_current_admin
from app.modules.admin.models import AdminUser
from .dependencies import (
    get_transaction_service,
    get_categorization_service,
    get_recurring_service,
    get_category_repository,
    get_attachment_service,
    get_import_export_service,
    TransactionServiceDepends,
    CategorizationServiceDepends,
    RecurringServiceDepends,
    CategoryRepoDepends,
    AttachmentServiceDepends,
    ImportExportServiceDepends,
)
from .demo_service import demo_transaction_service
from app.utils.fx_sql import twd_rates_for
from .schemas import (
    TransactionCreate,
    TransactionUpdate,
    TransactionResponse,
    TransactionFilter,
    TransactionAnalytics,
    BulkTransactionCreate,
    BulkTransactionResponse,
    TransactionCategoryCreate,
    TransactionCategoryUpdate,
    TransactionCategoryResponse,
    RecurringTransactionCreate,
    RecurringTransactionUpdate,
    RecurringTransactionResponse,
    AutoCategorizationRequest,
    AutoCategorizationResponse,
    QRPaymentTransaction,
    TransactionAttachmentResponse,
    DayOrderRequest,
    DayOrderResponse,
)
from .models import TransactionType, TransactionWalletType
from app.common.schemas import ApiResponse
import re as _re
from app.utils.datetime_helpers import business_today
from app.utils.datetime_helpers import utc_now

router = APIRouter(tags=["transactions"])


# ---------------------------------------------------------------------------
# Portfolio ↔ Transaction sync helpers
# ---------------------------------------------------------------------------

def _parse_buy_description(description: str):
    """Parse 'Buy SYMBOL ×QTY @ PRICE CURRENCY' → (symbol, qty, price, currency) or None."""
    if not description:
        return None
    m = _re.match(r'^Buy\s+(\S+)\s+×([0-9.]+)\s+@\s+([0-9,.]+)\s+(\S+)', description.strip())
    if not m:
        return None
    try:
        return m.group(1), float(m.group(2)), float(m.group(3).replace(',', '')), m.group(4)
    except (ValueError, IndexError):
        return None


async def _sync_portfolio_on_delete(transaction_obj) -> None:
    """Soft-delete the matching PortfolioHolding when an investment purchase is deleted."""
    if transaction_obj is None:
        return
    desc = getattr(transaction_obj, 'description', None) or ''
    cat_obj = getattr(transaction_obj, 'category_obj', None)
    cat_name = (getattr(cat_obj, 'name', '') or '').lower() if cat_obj else ''
    if cat_name not in ('investment purchase', 'investment') and not desc.startswith('Buy '):
        return
    parsed = _parse_buy_description(desc)
    if not parsed:
        return
    symbol, _qty, _price, _currency = parsed
    tx_date = getattr(transaction_obj, 'transaction_date', None)
    user_id = getattr(transaction_obj, 'user_id', None)
    if not tx_date or not user_id:
        return
    try:
        from sqlalchemy import and_, func, select as _sa_select
        from app.modules.portfolio.models import PortfolioHolding
        from app.core.database import get_db
        from datetime import datetime, timezone
        purchase_date_val = tx_date.date() if hasattr(tx_date, 'date') else tx_date
        async for db in get_db():
            try:
                stmt = _sa_select(PortfolioHolding).where(
                    and_(
                        PortfolioHolding.user_id == user_id,
                        PortfolioHolding.symbol == symbol.upper(),
                        PortfolioHolding.is_active == True,
                        func.date(PortfolioHolding.purchase_date) == purchase_date_val,
                    )
                ).limit(1)
                result = await db.execute(stmt)
                holding = result.scalar_one_or_none()
                if holding:
                    holding.is_active = False
                    holding.updated_at = datetime.now(timezone.utc)
                    await db.commit()
                    import logging as _logging
                    _logging.getLogger(__name__).info(
                        f"Portfolio sync: deactivated holding {holding.id} ({symbol}) on transaction delete"
                    )
            except Exception as inner_e:
                import logging as _logging
                _logging.getLogger(__name__).warning(f"Portfolio sync (delete) inner: {inner_e}")
            break
    except Exception as e:
        import logging as _logging
        _logging.getLogger(__name__).warning(f"Portfolio sync (delete) failed: {e}")


async def _sync_portfolio_on_update(old_transaction_obj, new_transaction_obj) -> None:
    """Update the matching PortfolioHolding when an investment purchase transaction is edited."""
    if old_transaction_obj is None:
        return
    old_desc = getattr(old_transaction_obj, 'description', None) or ''
    cat_obj = getattr(old_transaction_obj, 'category_obj', None)
    cat_name = (getattr(cat_obj, 'name', '') or '').lower() if cat_obj else ''
    if cat_name not in ('investment purchase', 'investment') and not old_desc.startswith('Buy '):
        return
    old_parsed = _parse_buy_description(old_desc)
    if not old_parsed:
        return
    old_symbol = old_parsed[0]
    new_desc = getattr(new_transaction_obj, 'description', None) or old_desc
    new_parsed = _parse_buy_description(new_desc)
    if not new_parsed:
        return
    new_symbol, new_qty, new_price, _new_currency = new_parsed
    if old_symbol.upper() != new_symbol.upper():
        return
    old_tx_date = getattr(old_transaction_obj, 'transaction_date', None)
    user_id = getattr(old_transaction_obj, 'user_id', None)
    if not old_tx_date or not user_id:
        return
    new_tx_date = getattr(new_transaction_obj, 'transaction_date', None)
    try:
        from sqlalchemy import and_, func, select as _sa_select
        from app.modules.portfolio.models import PortfolioHolding
        from app.core.database import get_db
        from datetime import datetime, timezone
        from decimal import Decimal
        purchase_date_val = old_tx_date.date() if hasattr(old_tx_date, 'date') else old_tx_date
        async for db in get_db():
            try:
                stmt = _sa_select(PortfolioHolding).where(
                    and_(
                        PortfolioHolding.user_id == user_id,
                        PortfolioHolding.symbol == new_symbol.upper(),
                        PortfolioHolding.is_active == True,
                        func.date(PortfolioHolding.purchase_date) == purchase_date_val,
                    )
                ).limit(1)
                result = await db.execute(stmt)
                holding = result.scalar_one_or_none()
                if holding:
                    holding.quantity = Decimal(str(new_qty))
                    holding.average_cost = Decimal(str(new_price))
                    holding.total_cost = holding.quantity * holding.average_cost
                    holding.total_value = holding.quantity * holding.current_price
                    holding.gain_loss = holding.total_value - holding.total_cost
                    holding.gain_loss_percentage = (
                        (holding.gain_loss / holding.total_cost) * Decimal('100')
                        if holding.total_cost > 0 else Decimal('0')
                    )
                    if new_tx_date:
                        new_date_dt = (
                            new_tx_date if isinstance(new_tx_date, datetime)
                            else datetime.combine(new_tx_date, datetime.min.time()).replace(tzinfo=timezone.utc)
                        )
                        holding.purchase_date = new_date_dt
                    holding.updated_at = datetime.now(timezone.utc)
                    await db.commit()
                    import logging as _logging
                    _logging.getLogger(__name__).info(
                        f"Portfolio sync: updated holding {holding.id} ({new_symbol}) "
                        f"qty={new_qty} avg_cost={new_price}"
                    )
            except Exception as inner_e:
                import logging as _logging
                _logging.getLogger(__name__).warning(f"Portfolio sync (update) inner: {inner_e}")
            break
    except Exception as e:
        import logging as _logging
        _logging.getLogger(__name__).warning(f"Portfolio sync (update) failed: {e}")


# Health check endpoint (must be first to avoid conflict with /{transaction_id})
@router.get("/health")
async def health_check(
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """Health check endpoint for the transactions module"""
    return {
        "status": "healthy",
        "module": "transactions",
        "mode": "demo" if current_user is None else "authenticated",
        "user_id": current_user.id if current_user else None,
        "timestamp": datetime.now(timezone.utc),
    }


# Transaction CRUD endpoints
@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_transaction(
    transaction_data: TransactionCreate,
    transaction_service: TransactionServiceDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """Create a new transaction with automatic categorization (supports both demo and authenticated modes)"""
    try:
        if current_user is None:
            # Demo mode - use demo service
            result = await demo_transaction_service.create_transaction(transaction_data)
            return result
        else:
            # Authenticated mode - use real service
            result = await transaction_service.create_transaction(
                transaction_data, current_user.id
            )


            return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to create transaction: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.post("/transfer", status_code=status.HTTP_201_CREATED)
async def create_wallet_transfer(
    transaction_service: TransactionServiceDepends,
    current_user: User = Depends(get_current_user),
    from_wallet: str = Body(..., description="Source wallet type"),
    to_wallet: str = Body(..., description="Destination wallet type"),
    amount: float = Body(..., gt=0, description="Transfer amount"),
    currency: str = Body("TWD", description="Currency code"),
    transaction_date: Optional[date] = Body(None, description="Transfer date"),
    notes: Optional[str] = Body(None, description="Optional notes"),
):
    """
    Create a wallet-to-wallet transfer.

    Automatically creates synchronized transactions/holdings to maintain accurate balances.

    Valid wallet types:
    - life: Life Wallet (daily expenses)
    - emergency: Emergency Wallet (emergency fund)
    - portfolio: Portfolio Wallet (invested assets)
    """
    try:
        from decimal import Decimal

        result = await transaction_service.create_transfer(
            user_id=str(current_user.id),
            from_wallet=from_wallet,
            to_wallet=to_wallet,
            amount=Decimal(str(amount)),
            currency=currency,
            transaction_date=transaction_date or business_today(),
            notes=notes,
        )

        return {
            "success": True,
            "message": f"Successfully transferred {amount} {currency} from {from_wallet} to {to_wallet}",
            "data": result,
        }

    except ValidationException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Transfer failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/transfer/{group_id}")
async def get_wallet_transfer(
    transaction_service: TransactionServiceDepends,
    current_user: User = Depends(get_current_user),
    group_id: str = Path(..., description="Transfer group ID"),
):
    """Fetch both legs of a wallet transfer as a single editable unit."""
    try:
        result = await transaction_service.get_transfer(
            user_id=str(current_user.id), group_id=group_id
        )
        if not result:
            raise HTTPException(status_code=404, detail="Transfer not found")

        return {"success": True, "data": result}

    except HTTPException:
        raise
    except ValidationException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Fetching transfer failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.put("/transfer/{group_id}")
async def update_wallet_transfer(
    transaction_service: TransactionServiceDepends,
    current_user: User = Depends(get_current_user),
    group_id: str = Path(..., description="Transfer group ID"),
    from_wallet: str = Body(..., description="Source wallet type"),
    to_wallet: str = Body(..., description="Destination wallet type"),
    amount: float = Body(..., gt=0, description="Transfer amount"),
    currency: str = Body("TWD", description="Currency code"),
    transaction_date: Optional[date] = Body(None, description="Transfer date"),
    notes: Optional[str] = Body(None, description="Optional notes"),
):
    """
    Update both legs of an existing wallet transfer atomically.

    Rewrites the debit and credit rows together so the wallets stay
    balanced — there is no path that edits only one leg.
    """
    try:
        from decimal import Decimal

        result = await transaction_service.update_transfer(
            user_id=str(current_user.id),
            group_id=group_id,
            from_wallet=from_wallet,
            to_wallet=to_wallet,
            amount=Decimal(str(amount)),
            currency=currency,
            transaction_date=transaction_date or business_today(),
            notes=notes,
        )

        return {
            "success": True,
            "message": f"Successfully updated transfer from {from_wallet} to {to_wallet}",
            "data": result,
        }

    except ValidationException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Transfer update failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")



# Registered before PUT /{transaction_id}, which would otherwise take "day-order"
# as a transaction id.
@router.put("/day-order", response_model=ApiResponse[DayOrderResponse])
async def set_day_order(
    transaction_service: TransactionServiceDepends,
    current_user: User = Depends(get_current_user),
    body: DayOrderRequest = Body(...),
):
    """
    Put one day's rows in the order the user dragged them into (#478).

    `ids` may be the whole day or only the rows the client showed; rows it does
    not name keep their places. Answers with the whole day in its new order.
    Demo mode reorders on the client and never calls this.
    """
    try:
        ordered = await transaction_service.set_day_order(
            current_user.id, body.date, body.ids
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ApiResponse.success_response(
        data=DayOrderResponse(date=body.date, ids=ordered)
    )


@router.get("/")
async def get_transactions(
    transaction_service: TransactionServiceDepends,
    category_repo: CategoryRepoDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=200, description="Items per page"),
    sort_by: str = Query("transaction_date", description="Sort field"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order"),
    # Filters
    type: Optional[TransactionType] = Query(None, description="Transaction type"),
    category: Optional[str] = Query(None, description="Category name filter"),
    category_ids: Optional[str] = Query(
        None, description="Comma-separated category IDs"
    ),
    payment_methods: Optional[str] = Query(
        None, description="Comma-separated payment methods"
    ),
    currencies: Optional[str] = Query(None, description="Comma-separated currencies"),
    wallet_type: Optional[TransactionWalletType] = Query(
        None, description="Wallet type filter (life/emergency)"
    ),
    date_from: Optional[date] = Query(None, description="Start date"),
    date_to: Optional[date] = Query(None, description="End date"),
    amount_min: Optional[float] = Query(None, ge=0, description="Minimum amount"),
    amount_max: Optional[float] = Query(None, ge=0, description="Maximum amount"),
    merchant_name: Optional[str] = Query(None, description="Merchant name search"),
    location: Optional[str] = Query(None, description="Location search"),
    tags: Optional[str] = Query(None, description="Comma-separated tags"),
    auto_categorized: Optional[bool] = Query(
        None, description="Filter by auto-categorized"
    ),
    reviewed_by_user: Optional[bool] = Query(
        None, description="Filter by user reviewed"
    ),
    has_attachments: Optional[bool] = Query(None, description="Filter by attachments"),
    is_recurring: Optional[bool] = Query(None, description="Filter by recurring"),
    search: Optional[str] = Query(None, description="General search term"),
):
    """Get transactions with filtering, sorting, and pagination (supports both demo and authenticated modes)"""

    # Parse comma-separated values
    def parse_csv(value: Optional[str]) -> Optional[List[str]]:
        return value.split(",") if value else None

    # Convert category name(s) to category IDs if provided. Supports a single
    # name or a comma-separated list (the frontend's multi-category filter).
    final_category_ids = parse_csv(category_ids)
    if category and not category_ids:
        names = [c.strip() for c in category.split(",") if c.strip()]
        if current_user is None:
            # Demo mode - search in demo categories
            wanted = {n.lower() for n in names}
            resolved = [
                cat["id"]
                for cat in demo_transaction_service.demo_categories
                if cat["name"].lower() in wanted
            ]
        else:
            # Authenticated mode — resolve to ALL matching active category ids
            # so duplicate category names don't silently drop the filter.
            resolved = await category_repo.get_ids_by_names(names)
        if resolved:
            final_category_ids = resolved

    # Validate amount range
    if amount_min is not None and amount_max is not None and amount_min > amount_max:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="amount_min must not be greater than amount_max",
        )

    # Build filter object
    filter_params = (
        TransactionFilter(
            type=type,
            category_ids=final_category_ids,
            payment_methods=parse_csv(payment_methods),
            currencies=parse_csv(currencies),
            wallet_type=wallet_type,
            date_from=date_from,
            date_to=date_to,
            amount_min=amount_min,
            amount_max=amount_max,
            merchant_name=merchant_name,
            location=location,
            tags=parse_csv(tags),
            auto_categorized=auto_categorized,
            reviewed_by_user=reviewed_by_user,
            has_attachments=has_attachments,
            is_recurring=is_recurring,
            search=search,
        )
        if any(
            [
                type,
                category,
                final_category_ids,
                payment_methods,
                currencies,
                wallet_type,
                date_from,
                date_to,
                amount_min,
                amount_max,
                merchant_name,
                location,
                tags,
                auto_categorized is not None,
                reviewed_by_user is not None,
                has_attachments is not None,
                is_recurring is not None,
                search,
            ]
        )
        else None
    )

    try:
        if current_user is None:
            # Demo mode - use demo service
            result = await demo_transaction_service.get_transactions(
                filter_params=filter_params,
                page=page,
                limit=limit,
                sort_by=sort_by,
                sort_order=sort_order,
            )
            return result
        else:
            # Authenticated mode - use real service
            result = await transaction_service.get_transactions(
                user_id=current_user.id,
                filter_params=filter_params,
                page=page,
                limit=limit,
                sort_by=sort_by,
                sort_order=sort_order,
            )
            return result
    except (HTTPException, AspiroException):
        # Let typed errors reach the global handlers with their real status codes
        raise
    except Exception:
        logger.exception("Failed to retrieve transactions")
        raise HTTPException(status_code=500, detail="Failed to retrieve transactions")


# Bulk operations
@router.post(
    "/bulk", response_model=BulkTransactionResponse, status_code=status.HTTP_201_CREATED
)
async def bulk_create_transactions(
    bulk_data: BulkTransactionCreate,
    transaction_service: TransactionServiceDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """Bulk create transactions (supports both demo and authenticated modes)"""
    try:
        if current_user is None:
            # Demo mode - use demo service
            result = await demo_transaction_service.bulk_create_transactions(bulk_data)
            return result
        else:
            # Authenticated mode - use real service
            result = await transaction_service.bulk_create_transactions(
                bulk_data, current_user.id
            )
            return result
    except (HTTPException, AspiroException):
        # Let typed errors reach the global handlers with their real status codes
        raise
    except Exception:
        logger.exception("Failed to bulk create transactions")
        raise HTTPException(status_code=500, detail="Failed to create transactions")


# Analytics endpoints
@router.get("/analytics/summary", response_model=TransactionAnalytics)
async def get_transaction_analytics(
    transaction_service: TransactionServiceDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
    period: str = Query(
        "30d", pattern="^(30d|90d|1y)$", description="Analytics period"
    ),
    date_from: Optional[date] = Query(
        None, description="Start date (overrides period)"
    ),
    date_to: Optional[date] = Query(None, description="End date (overrides period)"),
):
    """Get comprehensive transaction analytics (supports both demo and authenticated modes)"""
    try:
        # If specific dates aren't provided, calculate from period
        if not date_from or not date_to:
            from datetime import timedelta

            # business_today(), not utc_now().date(): LINE /txn stamps an expense
            # with the business day, so a UTC window would end a day earlier and hide
            # anything recorded between midnight and 08:00 Taipei.
            today = business_today()

            if period == "30d":
                date_from = today - timedelta(days=30)
                date_to = today
            elif period == "90d":
                date_from = today - timedelta(days=90)
                date_to = today
            elif period == "1y":
                date_from = today - timedelta(days=365)
                date_to = today

        if current_user is None:
            # Demo mode - use demo service
            analytics = await demo_transaction_service.get_analytics(
                date_from=date_from, date_to=date_to
            )
            summary = analytics.summary
            total_income = float(summary.total_income)
            total_expenses = float(summary.total_expenses)
            transaction_count = summary.transaction_count
            avg_amount = (
                (total_income + total_expenses) / transaction_count
                if transaction_count
                else 0
            )

            # Return a simplified analytics view expected by demo tests
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "total_income": total_income,
                    "total_expenses": total_expenses,
                    "net_income": total_income - total_expenses,
                    "transaction_count": transaction_count,
                    "average_transaction_amount": avg_amount,
                },
            )
        else:
            # Authenticated mode - use real service
            analytics = await transaction_service.get_analytics(
                user_id=current_user.id, date_from=date_from, date_to=date_to
            )
            return analytics
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to generate analytics")


@router.get("/stats")
async def get_transaction_page_stats(
    transaction_service: TransactionServiceDepends,
    category_repo: CategoryRepoDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
    type: Optional[TransactionType] = Query(None, description="Transaction type"),
    category: Optional[str] = Query(
        None, description="Comma-separated category names"
    ),
    wallet_type: Optional[TransactionWalletType] = Query(
        None, description="Wallet type filter (life/emergency)"
    ),
    date_from: Optional[date] = Query(None, description="Start date"),
    date_to: Optional[date] = Query(None, description="End date"),
    search: Optional[str] = Query(None, description="General search term"),
    exclude_transfers: bool = Query(
        False,
        description=(
            "Leave both legs of a wallet transfer out of the totals. One move between "
            "the user's own wallets is stored as a matching income and expense row, so "
            "counting it raises both totals by the same amount."
        ),
    ),
):
    """TWD-normalized stats, category breakdowns, and top transactions for the
    transactions page — replaces the client fetching every row to compute these."""
    if current_user is None:
        # Demo mode: the frontend computes stats client-side from fixtures and
        # never calls this; return a minimal payload for direct API consumers.
        analytics = await demo_transaction_service.get_analytics(
            date_from=date_from, date_to=date_to
        )
        summary = analytics.summary
        total_income = float(summary.total_income)
        total_expenses = float(summary.total_expenses)
        count = summary.transaction_count
        return {
            "stats": {
                "total_income": total_income,
                "total_expenses": total_expenses,
                "net_income": total_income - total_expenses,
                "transaction_count": count,
                "avg_transaction_amount": (
                    (total_income + total_expenses) / count if count else 0.0
                ),
            },
            "category_breakdown": [],
            "expense_category_breakdown": [],
            "top_expenses": [],
            "top_income": [],
            "currency": "TWD",
        }

    final_category_ids = None
    if category:
        # Resolve to ALL active category ids matching each name — duplicate
        # category names must not silently drop the filter (was: get_by_name in
        # a try/except that swallowed MultipleResultsFound and returned all rows).
        names = [c.strip() for c in category.split(",") if c.strip()]
        resolved = await category_repo.get_ids_by_names(names)
        if resolved:
            final_category_ids = resolved

    filter_params = TransactionFilter(
        type=type,
        category_ids=final_category_ids,
        wallet_type=wallet_type,
        date_from=date_from,
        date_to=date_to,
        search=search,
        exclude_transfers=exclude_transfers,
    )

    try:
        return await transaction_service.get_page_stats(
            current_user.id, filter_params
        )
    except (HTTPException, AspiroException):
        raise
    except Exception:
        logger.exception("Failed to compute transaction page stats")
        raise HTTPException(
            status_code=500, detail="Failed to compute transaction stats"
        )


@router.get("/monthly-summary")
async def get_monthly_summary(
    transaction_service: TransactionServiceDepends,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
    year: int = Query(
        None, description="Year to get summary for (defaults to current year)"
    ),
):
    """Monthly spending split into housing / eat / investment / debt / transfer / others."""
    try:
        from datetime import datetime
        from sqlalchemy import and_, extract
        from sqlalchemy.future import select
        if year is None:
            # On 1 January, 00:00-08:00 Taipei, the UTC clock is still in the old year.
            year = business_today().year

        logger.info(
            f"Monthly summary requested for year {year} - User: {current_user.id if current_user else 'None (demo mode)'}"
        )

        # Bucket rules live in spending_buckets.py: this endpoint and demo_service.py
        # both classify, and they used to hold byte-identical copies of every set.
        from .spending_buckets import bucket_for, empty_buckets

        if current_user is None:
            # Demo mode
            monthly_data = await demo_transaction_service.get_monthly_summary(year)
            return JSONResponse(
                status_code=status.HTTP_200_OK, content={"data": monthly_data}
            )
        else:
            # Authenticated mode - use the injected db session
            from .models import Transaction, TransactionCategory
            from .repositories import TransactionRepository

            # Get all expense transactions for the year with eager loading of category + parent
            query = (
                select(Transaction)
                .options(
                    selectinload(Transaction.category_obj).selectinload(
                        TransactionCategory.parent
                    )
                )
                .where(
                    and_(
                        Transaction.user_id == current_user.id,
                        Transaction.type == "expense",
                        Transaction.is_deleted == False,
                        Transaction.status == "completed",
                        extract("year", Transaction.transaction_date) == year,
                    )
                )
            )

            result = await db.execute(query)
            transactions = result.scalars().all()

            # Also fetch income transactions for the year. The category has to be
            # eager-loaded like the expense side: the transfer check reads it, and a
            # lazy load inside the async session raises MissingGreenlet.
            income_query = (
                select(Transaction)
                .options(selectinload(Transaction.category_obj))
                .where(
                    and_(
                        Transaction.user_id == current_user.id,
                        Transaction.type == "income",
                        Transaction.is_deleted == False,
                        Transaction.status == "completed",
                        extract("year", Transaction.transaction_date) == year,
                    )
                )
            )
            income_result = await db.execute(income_query)
            income_transactions = income_result.scalars().all()

            # Live rates, through the same helper the dashboard and the reports
            # use. This table was a third set of numbers for one question: with
            # USD pinned at 31.5 here and fetched elsewhere, the monthly chart
            # and the card above it disagreed about the same transaction by
            # whatever the rate had moved since the constant was written.
            _rates = await twd_rates_for(
                db, [t.currency for t in transactions] + [t.currency for t in income_transactions]
            )
            _TO_TWD = {currency: float(rate) for currency, rate in _rates.items()}

            # Group by month and categorize - Initialize all 12 months
            monthly_summaries = {}
            for month_num in range(1, 13):
                month_key = f"{year}-{month_num:02d}"
                monthly_summaries[month_key] = {
                    "month": month_key,
                    **empty_buckets(),
                    "transfer": 0.0,
                    "total": 0.0,
                    "income": 0.0,
                }

            # Aggregate income by month. A transfer's inflow is the user's own money
            # arriving from their other wallet, so it never counted as earnings — it
            # used to spike this line by the size of the month's top-up.
            for txn in income_transactions:
                if TransactionRepository.is_transfer_leg(txn):
                    continue
                month_key = f"{year}-{txn.transaction_date.month:02d}"
                raw = float(txn.amount)
                currency = (txn.currency or "TWD").upper()
                monthly_summaries[month_key]["income"] += raw * _TO_TWD.get(currency, 1.0)

            # Categorize transactions
            for txn in transactions:
                month_key = f"{year}-{txn.transaction_date.month:02d}"
                raw = float(txn.amount)
                currency = (txn.currency or "TWD").upper()
                amount = raw * _TO_TWD.get(currency, 1.0)

                # Get category name and parent category name for matching
                cat = txn.category_obj
                category_name = (cat.name or "Others") if cat else "Others"
                category_name_lower = category_name.lower()

                # Also check parent category name
                parent_name_lower = ""
                if cat and cat.parent:
                    parent_name_lower = (cat.parent.name or "").lower()

                # Also check Chinese name fields
                cat_name_zh = ""
                if cat and cat.name_zh:
                    cat_name_zh = cat.name_zh.lower()

                # Its own bucket, the way investment purchases get one: money that
                # only changed pocket is not shopping, and folding it into "others"
                # made a wallet top-up read as a month of heavy spending.
                if TransactionRepository.is_transfer_leg(txn):
                    monthly_summaries[month_key]["transfer"] += amount
                    monthly_summaries[month_key]["total"] += amount
                    continue

                # loan_id set means the user tied this expense to a debt account,
                # which is what actually reduces the balance. It outranks every category
                # name except housing (see spending_buckets.bucket_for), and it is not
                # redundant with the names: two of the loan payments on the live box
                # have the category but no link.
                bucket = bucket_for(
                    (category_name_lower, parent_name_lower, cat_name_zh),
                    has_loan_link=txn.loan_id is not None,
                )
                monthly_summaries[month_key][bucket] += amount
                monthly_summaries[month_key]["total"] += amount

            # Convert to list and sort by month - Return ALL months including zeros
            result_list = sorted(
                monthly_summaries.values(), key=lambda x: x["month"]
            )

            return JSONResponse(
                status_code=status.HTTP_200_OK, content={"data": result_list}
            )

    except Exception as e:
        logger.error("Failed to generate monthly summary: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")


# QR Payment specific endpoint
@router.post(
    "/qr-payment",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_qr_payment_transaction(
    qr_transaction: QRPaymentTransaction,
    transaction_service: TransactionServiceDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """Create a transaction from QR payment data (supports both demo and authenticated modes)"""
    try:
        # Convert QR payment data to regular transaction
        transaction_data = TransactionCreate(
            **qr_transaction.model_dump(exclude={"qr_payment_data"}),
            qr_payment_data=qr_transaction.qr_payment_data.model_dump(),
        )

        if current_user is None:
            # Demo mode - use demo service
            result = await demo_transaction_service.create_transaction(transaction_data)
            return result.get("transaction", result)
        else:
            # Authenticated mode - use real service
            result = await transaction_service.create_transaction(
                transaction_data, current_user.id
            )
            return result.get("transaction", result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to create QR payment transaction"
        )


# Auto-categorization endpoints
@router.post("/auto-categorize", response_model=AutoCategorizationResponse)
async def auto_categorize_transaction(
    request: AutoCategorizationRequest,
    categorization_service: CategorizationServiceDepends,
    current_user: User = Depends(get_current_user),
):
    """Get auto-categorization suggestions for a transaction"""
    try:
        result = await categorization_service.auto_categorize(
            description=request.description,
            amount=request.amount,
            merchant_name=request.merchant_name,
            payment_method=request.payment_method,
            user_id=current_user.id,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to categorize transaction")


# Transaction Categories endpoints
@router.post(
    "/categories",
    response_model=TransactionCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_category(
    category_data: TransactionCategoryCreate,
    category_repo: CategoryRepoDepends,
    # Categories are shared by every user, so only an admin may change them.
    current_admin: AdminUser = Depends(get_current_admin),
):
    """Create a new transaction category"""
    try:
        category = await category_repo.create(category_data.model_dump())
        return category
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to create category")


@router.get("/categories", response_model=List[TransactionCategoryResponse])
async def get_categories(
    category_repo: CategoryRepoDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
    type: Optional[str] = Query(None, description="Category type filter"),
    include_inactive: bool = Query(False, description="Include inactive categories"),
):
    """Get all transaction categories (supports both demo and authenticated modes)"""
    try:
        if current_user is None:
            # Demo mode - use demo service
            categories = await demo_transaction_service.get_categories(
                include_inactive=include_inactive
            )
            # Filter by type if specified
            if type:
                categories = [cat for cat in categories if cat.type.value == type]
            return categories
        else:
            # Authenticated mode - use real service
            categories = await category_repo.get_all(
                category_type=type, include_inactive=include_inactive
            )
            return categories
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to retrieve categories")


@router.get("/categories/popular", response_model=List[TransactionCategoryResponse])
async def get_popular_categories(
    category_repo: CategoryRepoDepends,
    current_user: User = Depends(get_current_user),
    type: Optional[str] = Query(None, description="Category type filter"),
    limit: int = Query(10, ge=1, le=50, description="Number of categories to return"),
):
    """Get popular categories based on user's transaction history"""
    try:
        categories = await category_repo.get_popular_categories(
            user_id=current_user.id, category_type=type, limit=limit
        )
        return categories
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to retrieve popular categories"
        )


@router.get("/categories/{category_id}", response_model=TransactionCategoryResponse)
async def get_category(
    category_repo: CategoryRepoDepends,
    current_user: User = Depends(get_current_user),
    category_id: str = Path(..., description="Category ID"),
):
    """Get a specific transaction category"""
    category = await category_repo.get_by_id(category_id)

    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    return category


@router.put("/categories/{category_id}", response_model=TransactionCategoryResponse)
async def update_category(
    category_repo: CategoryRepoDepends,
    # Categories are shared by every user, so only an admin may change them.
    current_admin: AdminUser = Depends(get_current_admin),
    category_id: str = Path(..., description="Category ID"),
    category_data: TransactionCategoryUpdate = Body(...),
):
    """Update a transaction category"""
    try:
        category = await category_repo.update(
            category_id, category_data.model_dump(exclude_unset=True)
        )

        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

        return category
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to update category")


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_repo: CategoryRepoDepends,
    # Categories are shared by every user, so only an admin may change them.
    current_admin: AdminUser = Depends(get_current_admin),
    category_id: str = Path(..., description="Category ID"),
):
    """Delete a transaction category (soft delete)"""
    success = await category_repo.delete(category_id)

    if not success:
        raise HTTPException(status_code=404, detail="Category not found")


# Recurring Transactions endpoints
@router.post(
    "/recurring",
    response_model=RecurringTransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_recurring_transaction(
    recurring_data: RecurringTransactionCreate,
    recurring_service: RecurringServiceDepends,
    current_user: User = Depends(get_current_user),
):
    """Create a new recurring transaction"""
    try:
        recurring = await recurring_service.create_recurring_transaction(
            recurring_data.model_dump(), current_user.id
        )
        return recurring
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to create recurring transaction"
        )


@router.get("/recurring", response_model=List[RecurringTransactionResponse])
async def get_recurring_transactions(
    recurring_service: RecurringServiceDepends,
    current_user: User = Depends(get_current_user),
):
    """Get all recurring transactions for the current user"""
    try:
        recurring_transactions = await recurring_service.recurring_repo.get_all_by_user(
            current_user.id
        )
        return recurring_transactions
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to retrieve recurring transactions"
        )


@router.get("/recurring/{recurring_id}", response_model=RecurringTransactionResponse)
async def get_recurring_transaction(
    recurring_service: RecurringServiceDepends,
    current_user: User = Depends(get_current_user),
    recurring_id: str = Path(..., description="Recurring transaction ID"),
):
    """Get a specific recurring transaction"""
    recurring = await recurring_service.recurring_repo.get_by_id(
        recurring_id, current_user.id
    )

    if not recurring:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")

    return recurring


@router.put("/recurring/{recurring_id}", response_model=RecurringTransactionResponse)
async def update_recurring_transaction(
    recurring_service: RecurringServiceDepends,
    current_user: User = Depends(get_current_user),
    recurring_id: str = Path(..., description="Recurring transaction ID"),
    recurring_data: RecurringTransactionUpdate = Body(...),
):
    """Update a recurring transaction"""
    try:
        recurring = await recurring_service.update_recurring_transaction(
            recurring_id, current_user.id, recurring_data
        )

        if not recurring:
            raise HTTPException(
                status_code=404, detail="Recurring transaction not found"
            )

        return recurring
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to update recurring transaction"
        )


@router.delete("/recurring/{recurring_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recurring_transaction(
    recurring_service: RecurringServiceDepends,
    current_user: User = Depends(get_current_user),
    recurring_id: str = Path(..., description="Recurring transaction ID"),
):
    """Delete a recurring transaction"""
    success = await recurring_service.delete_recurring_transaction(
        recurring_id, current_user.id
    )

    if not success:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")


# Process due recurring transactions (admin endpoint)
@router.post("/recurring/process-due")
async def process_due_recurring_transactions(
    recurring_service: RecurringServiceDepends,
    current_user: User = Depends(get_current_user),
):
    """Process recurring transactions that are due (admin only)"""
    try:
        # In a real application, you'd want to restrict this to admin users
        result = await recurring_service.process_due_transactions()
        return JSONResponse(
            content={
                "message": "Due recurring transactions processed",
                "result": result,
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to process recurring transactions"
        )


# File attachment endpoints
@router.post(
    "/{transaction_id}/attachments",
    response_model=TransactionAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_transaction_attachment(
    attachment_service: AttachmentServiceDepends,
    current_user: User = Depends(get_current_user),
    transaction_id: str = Path(..., description="Transaction ID"),
    file: UploadFile = File(...),
    is_receipt: bool = Query(True, description="Is this a receipt?"),
):
    """Upload an attachment to a transaction"""
    try:
        attachment = await attachment_service.upload_attachment(
            transaction_id=transaction_id,
            user_id=current_user.id,
            file=file,
            is_receipt=is_receipt,
        )
        return attachment
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Attachment upload failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to upload attachment")


@router.get(
    "/{transaction_id}/attachments", response_model=List[TransactionAttachmentResponse]
)
async def get_transaction_attachments(
    attachment_service: AttachmentServiceDepends,
    current_user: User = Depends(get_current_user),
    transaction_id: str = Path(..., description="Transaction ID"),
):
    """Get attachments for a transaction"""
    try:
        attachments = await attachment_service.get_attachments(
            transaction_id, current_user.id
        )
        return attachments
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Attachment listing failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve attachments")


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction_attachment(
    attachment_service: AttachmentServiceDepends,
    current_user: User = Depends(get_current_user),
    attachment_id: str = Path(..., description="Attachment ID"),
):
    """Delete a transaction attachment"""
    success = await attachment_service.delete_attachment(attachment_id, current_user.id)

    if not success:
        raise HTTPException(status_code=404, detail="Attachment not found")


# Import/Export endpoints
@router.post("/upload-import")
async def bulk_import_transactions(
    import_service: ImportExportServiceDepends,
    current_user: User = Depends(get_current_user),
    file: UploadFile = File(...),
    skip_duplicates: bool = Query(True, description="Skip duplicate transactions"),
    auto_categorize: bool = Query(True, description="Auto-categorize transactions"),
    default_currency: str = Query(
        "TWD", description="Default currency for transactions"
    ),
    default_category_id: Optional[str] = Query(None, description="Default category ID"),
):
    """Bulk import transactions from CSV file"""

    # Validate file type
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    import_settings = {
        "skip_duplicates": skip_duplicates,
        "auto_categorize": auto_categorize,
        "default_currency": default_currency,
        "default_category_id": default_category_id,
    }

    try:
        result = await import_service.import_csv(current_user.id, file, import_settings)
        return JSONResponse(
            content={
                "imported": result.get("successful", 0),
                "failed": result.get("failed", 0),
                "errors": result.get("errors", []),
            }
        )
    except Exception as e:
        logger.error("Import failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.post("/import/csv")
async def import_transactions_csv(
    import_service: ImportExportServiceDepends,
    current_user: User = Depends(get_current_user),
    file: UploadFile = File(...),
    skip_duplicates: bool = Query(True, description="Skip duplicate transactions"),
    auto_categorize: bool = Query(True, description="Auto-categorize transactions"),
    default_currency: str = Query(
        "TWD", description="Default currency for transactions"
    ),
    default_category_id: Optional[str] = Query(None, description="Default category ID"),
):
    """Import transactions from CSV file (legacy endpoint)"""

    # Validate file type
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    import_settings = {
        "skip_duplicates": skip_duplicates,
        "auto_categorize": auto_categorize,
        "default_currency": default_currency,
        "default_category_id": default_category_id,
    }

    try:
        result = await import_service.import_csv(current_user.id, file, import_settings)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error("Import failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/export")
async def export_transactions(
    import_service: ImportExportServiceDepends,
    current_user: User = Depends(get_current_user),
    format: str = Query("csv", pattern="^(csv|excel|xlsx|pdf)$", description="Export format"),
    date_from: Optional[date] = Query(None, description="Start date"),
    date_to: Optional[date] = Query(None, description="End date"),
    category: Optional[str] = Query(None, description="Category filter"),
    type: Optional[str] = Query(None, description="Transaction type filter"),
):
    """Export transactions in specified format (csv, excel/xlsx)"""

    try:
        _date_from = datetime.combine(date_from, datetime.min.time()) if date_from else None
        _date_to = datetime.combine(date_to, datetime.max.time()) if date_to else None

        date_suffix = ""
        if date_from or date_to:
            start = date_from.strftime("%Y%m%d") if date_from else "start"
            end = date_to.strftime("%Y%m%d") if date_to else "end"
            date_suffix = f"_{start}_to_{end}"

        if format == "csv":
            csv_content = await import_service.export_csv(
                user_id=current_user.id,
                date_from=_date_from,
                date_to=_date_to,
            )
            filename = f"transactions{date_suffix}.csv"
            # RFC 6266: filename must be double-quoted to prevent header injection
            return StreamingResponse(
                iter([csv_content]),
                media_type="text/csv",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        elif format in ("excel", "xlsx"):
            xlsx_bytes = await import_service.export_excel(
                user_id=current_user.id,
                date_from=_date_from,
                date_to=_date_to,
            )
            filename = f"transactions{date_suffix}.xlsx"
            # RFC 6266: filename must be double-quoted to prevent header injection
            return StreamingResponse(
                iter([xlsx_bytes]),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        elif format == "pdf":
            raise HTTPException(status_code=501, detail="PDF export not implemented yet")
        else:
            raise HTTPException(status_code=400, detail="Unsupported export format")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Export failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/export/csv")
async def export_transactions_csv(
    import_service: ImportExportServiceDepends,
    current_user: User = Depends(get_current_user),
    date_from: Optional[date] = Query(None, description="Start date"),
    date_to: Optional[date] = Query(None, description="End date"),
):
    """Export transactions to CSV file (legacy endpoint)"""

    try:
        csv_content = await import_service.export_csv(
            user_id=current_user.id,
            date_from=(
                datetime.combine(date_from, datetime.min.time()) if date_from else None
            ),
            date_to=datetime.combine(date_to, datetime.max.time()) if date_to else None,
        )

        # Create filename with date range
        date_suffix = ""
        if date_from or date_to:
            start = date_from.strftime("%Y%m%d") if date_from else "start"
            end = date_to.strftime("%Y%m%d") if date_to else "end"
            date_suffix = f"_{start}_to_{end}"

        filename = f"transactions{date_suffix}.csv"

        # RFC 6266: filename must be double-quoted to prevent header injection
        return StreamingResponse(
            iter([csv_content]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.error("Export failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred")


# Import batch status endpoints
@router.get("/import/batches")
async def get_import_batches(
    db: AsyncSession = Depends(get_async_session),
    limit: int = Query(20, ge=1, le=200),
    current_user: User = Depends(get_current_user),
):
    """Get import batch history for the user"""
    from .models import TransactionImportBatch
    from sqlalchemy import select

    result = await db.execute(
        select(TransactionImportBatch)
        .where(TransactionImportBatch.user_id == current_user.id)
        # id tiebreaker: created_at can tie for batches made in one statement,
        # making this limited/ordered query otherwise non-deterministic.
        .order_by(TransactionImportBatch.created_at.desc(), TransactionImportBatch.id.desc())
        .limit(limit)
    )
    batches = result.scalars().all()

    data = [
        {
            "id": b.id,
            "source": b.source,
            "filename": b.filename,
            "status": b.status,
            "total_records": b.total_records,
            "processed_records": b.processed_records,
            "successful_imports": b.successful_imports,
            "failed_imports": b.failed_imports,
            "processing_started_at": b.processing_started_at.isoformat() if b.processing_started_at else None,
            "processing_completed_at": b.processing_completed_at.isoformat() if b.processing_completed_at else None,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in batches
    ]
    return {"success": True, "data": {"batches": data, "total": len(data)}}


@router.get("/import/batches/{batch_id}")
async def get_import_batch_status(
    batch_id: str = Path(..., description="Import batch ID"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """Get status of a specific import batch"""
    from .models import TransactionImportBatch
    from sqlalchemy import select

    result = await db.execute(
        select(TransactionImportBatch)
        .where(
            TransactionImportBatch.id == batch_id,
            TransactionImportBatch.user_id == current_user.id,
        )
    )
    batch = result.scalar_one_or_none()

    if not batch:
        raise HTTPException(status_code=404, detail="Import batch not found")

    return {
        "success": True,
        "data": {
            "id": batch.id,
            "source": batch.source,
            "filename": batch.filename,
            "status": batch.status,
            "total_records": batch.total_records,
            "processed_records": batch.processed_records,
            "successful_imports": batch.successful_imports,
            "failed_imports": batch.failed_imports,
            "errors": batch.errors or [],
            "warnings": batch.warnings or [],
            "import_settings": batch.import_settings or {},
            "processing_started_at": batch.processing_started_at.isoformat() if batch.processing_started_at else None,
            "processing_completed_at": batch.processing_completed_at.isoformat() if batch.processing_completed_at else None,
            "created_at": batch.created_at.isoformat() if batch.created_at else None,
        },
    }


# Receipt scanning endpoint
@router.post("/scan-receipt")
async def scan_receipt(
    attachment_service: AttachmentServiceDepends,
    current_user: User = Depends(get_current_user),
    file: UploadFile = File(...),
):
    """Scan a receipt and extract transaction data"""

    # Validate file type
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    allowed_types = [".jpg", ".jpeg", ".png", ".pdf"]
    if not any(file.filename.lower().endswith(ext) for ext in allowed_types):
        raise HTTPException(
            status_code=400, detail="Unsupported file type. Use JPG, PNG, or PDF"
        )

    try:
        receipt_data = await attachment_service.scan_receipt(file, current_user.id)

        # Return partial transaction data extracted from receipt
        return JSONResponse(
            content={
                "amount": receipt_data.get("amount"),
                "merchant_name": receipt_data.get("merchant_name"),
                "date": receipt_data.get("date"),
                "description": receipt_data.get("description"),
                "category": receipt_data.get("category"),
                "confidence": receipt_data.get("confidence", 0.0),
            }
        )
    except TimeoutError:
        # A 200 full of nulls reads as "nothing on this receipt". This is retryable
        # and the user can act on it.
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Receipt scan timed out. Try again, or use a smaller photo.",
        )
    except NotImplementedError:
        raise HTTPException(
            status_code=501,
            detail=(
                "Receipt scanning is unavailable: the tesseract binary is missing "
                "from this deployment."
            ),
        )
    except Exception as e:
        logger.error("Receipt scanning failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500, detail="An internal error occurred"
        )


# Transaction by ID endpoints (must be last to avoid matching specific routes)
@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_service: TransactionServiceDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
    transaction_id: str = Path(..., description="Transaction ID"),
):
    """Get a specific transaction by ID (supports both demo and authenticated modes)"""
    if current_user is None:
        # Demo mode - use demo service
        transaction = await demo_transaction_service.get_transaction(transaction_id)
    else:
        # Authenticated mode - use real service
        transaction = await transaction_service.get_transaction(
            transaction_id, current_user.id
        )

    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    return transaction


@router.put("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_service: TransactionServiceDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
    transaction_id: str = Path(..., description="Transaction ID"),
    transaction_data: TransactionUpdate = Body(...),
):
    """Update a transaction (supports both demo and authenticated modes)"""
    try:
        # Get old transaction data before update for the portfolio sync below
        old_transaction_data = None
        if current_user:
            try:
                old_transaction_data = await transaction_service.get_transaction(
                    transaction_id, current_user.id
                )
            except Exception as _pre_fetch_err:
                import logging as _log
                _log.getLogger(__name__).debug(
                    "Pre-update transaction fetch failed (non-fatal): %s", _pre_fetch_err
                )

        if current_user is None:
            # Demo mode - use demo service
            transaction = await demo_transaction_service.update_transaction(
                transaction_id, transaction_data
            )
        else:
            # Authenticated mode - use real service
            transaction = await transaction_service.update_transaction(
                transaction_id, current_user.id, transaction_data
            )


            # Sync portfolio holding if this was an investment purchase
            if transaction and old_transaction_data:
                await _sync_portfolio_on_update(old_transaction_data, transaction)

        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")

        return transaction
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to update transaction")


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_service: TransactionServiceDepends,
    current_user: Optional[User] = Depends(get_optional_current_user),
    transaction_id: str = Path(..., description="Transaction ID"),
):
    """Delete a transaction (supports both demo and authenticated modes)"""
    # Get transaction data before deletion for the portfolio sync below
    transaction_data = None
    if current_user:
        try:
            transaction_data = await transaction_service.get_transaction(
                transaction_id, current_user.id
            )
        except Exception as _pre_delete_err:
            import logging as _log
            _log.getLogger(__name__).debug(
                "Pre-delete transaction fetch failed (non-fatal): %s", _pre_delete_err
            )

    if current_user is None:
        # Demo mode - use demo service
        success = await demo_transaction_service.delete_transaction(transaction_id)
    else:
        # Authenticated mode - use real service (soft delete)
        success = await transaction_service.delete_transaction(
            transaction_id, current_user.id
        )


        # Sync portfolio holding if this was an investment purchase
        if success and transaction_data:
            await _sync_portfolio_on_delete(transaction_data)

    if not success:
        raise HTTPException(status_code=404, detail="Transaction not found")
