"""
Portfolio repository layer for Aspiro FastAPI backend.

This module provides data access operations for portfolio management,
including CRUD operations and complex queries for performance analytics.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, desc, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ...core.exceptions import NotFoundException
from ...utils.datetime_helpers import to_utc
from .models import (
    Portfolio,
    PortfolioHolding,
    PortfolioTransaction,
    MarketData,
    CurrencyRate,
)

logger = logging.getLogger(__name__)


class PortfolioRepository:
    """Repository for portfolio operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, portfolio_data: Dict[str, Any], user_id: UUID) -> Portfolio:
        """
        Create a new portfolio.

        Args:
            portfolio_data: Portfolio creation data
            user_id: Owner user ID

        Returns:
            Portfolio: Created portfolio instance
        """
        # Check if this will be the user's first portfolio (make it default)
        if not portfolio_data.get("is_default", False):
            existing_count = await self.get_user_portfolios_count(user_id)
            if existing_count == 0:
                portfolio_data["is_default"] = True

        # If setting as default, unset other defaults
        if portfolio_data.get("is_default", False):
            await self._unset_default_portfolios(user_id)

        portfolio = Portfolio(user_id=user_id, **portfolio_data)
        self.session.add(portfolio)
        await self.session.flush()
        await self.session.refresh(portfolio)

        logger.info(f"Created portfolio {portfolio.id} for user {user_id}")
        return portfolio

    async def get_by_id(self, portfolio_id: UUID, user_id: UUID) -> Optional[Portfolio]:
        """
        Get portfolio by ID for a specific user.

        Args:
            portfolio_id: Portfolio ID
            user_id: Owner user ID

        Returns:
            Portfolio: Portfolio instance or None

        Note:
            Uses nested eager loading to prevent N+1 queries:
            - Eagerly loads all holdings with their transactions
            - Eagerly loads all portfolio transactions
        """
        stmt = (
            select(Portfolio)
            .options(selectinload(Portfolio.holdings))
            .where(
                and_(
                    Portfolio.id == portfolio_id,
                    Portfolio.user_id == user_id,
                    Portfolio.is_active == True,
                )
            )
        )

        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_user_portfolios(
        self,
        user_id: UUID,
        skip: int = 0,
        limit: int = 20,
        is_active: Optional[bool] = None,
        currency: Optional[str] = None,
    ) -> Tuple[List[Portfolio], int]:
        """
        Get paginated portfolios for a user.

        Args:
            user_id: User ID
            skip: Number of records to skip
            limit: Number of records to return
            is_active: Filter by active status
            currency: Filter by currency

        Returns:
            Tuple[List[Portfolio], int]: (portfolios, total_count)

        Performance:
            - Eagerly loads holdings with their transactions (prevents N+1)
            - Separate count query for accurate pagination
            - Filters applied at database level
        """
        # Build base query
        conditions = [Portfolio.user_id == user_id]

        if is_active is not None:
            conditions.append(Portfolio.is_active == is_active)

        if currency:
            conditions.append(Portfolio.currency == currency.upper())

        # Count query
        count_stmt = select(func.count(Portfolio.id)).where(and_(*conditions))
        count_result = await self.session.execute(count_stmt)
        total_count = count_result.scalar()

        stmt = (
            select(Portfolio)
            .options(selectinload(Portfolio.holdings))
            .where(and_(*conditions))
            .order_by(desc(Portfolio.is_default), desc(Portfolio.updated_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        portfolios = result.scalars().all()

        return portfolios, total_count

    async def get_user_portfolios_count(self, user_id: UUID) -> int:
        """Get count of user's portfolios"""
        stmt = select(func.count(Portfolio.id)).where(
            and_(Portfolio.user_id == user_id, Portfolio.is_active == True)
        )
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def get_default_portfolio(self, user_id: UUID) -> Optional[Portfolio]:
        """Get user's default portfolio.

        Tolerates duplicate active defaults defensively: a partial unique index
        (uq_portfolios_one_active_default_per_user) now enforces at most one,
        but pre-existing/legacy data could still have duplicates. Ordering by
        most-recently-updated + first() degrades gracefully, whereas
        scalar_one_or_none() would raise MultipleResultsFound and break every
        caller (portfolio page, dashboard trend recompute, rebalancing, ...).
        """
        stmt = (
            select(Portfolio)
            .options(selectinload(Portfolio.holdings))
            .where(
                and_(
                    Portfolio.user_id == user_id,
                    Portfolio.is_default == True,
                    Portfolio.is_active == True,
                )
            )
            .order_by(desc(Portfolio.updated_at))
            .limit(1)
        )

        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def update(
        self, portfolio_id: UUID, user_id: UUID, update_data: Dict[str, Any]
    ) -> Optional[Portfolio]:
        """
        Update portfolio information.

        Args:
            portfolio_id: Portfolio ID
            user_id: Owner user ID
            update_data: Data to update

        Returns:
            Portfolio: Updated portfolio instance
        """
        # If setting as default, unset other defaults first
        if update_data.get("is_default", False):
            await self._unset_default_portfolios(user_id)

        stmt = (
            update(Portfolio)
            .where(and_(Portfolio.id == portfolio_id, Portfolio.user_id == user_id))
            .values(**update_data, updated_at=datetime.now(timezone.utc))
        )

        await self.session.execute(stmt)

        # Return updated portfolio
        return await self.get_by_id(portfolio_id, user_id)

    async def delete(self, portfolio_id: UUID, user_id: UUID) -> bool:
        """
        Soft delete portfolio (mark as inactive).

        Args:
            portfolio_id: Portfolio ID
            user_id: Owner user ID

        Returns:
            bool: True if deleted successfully
        """
        # Check if this is the default portfolio
        portfolio = await self.get_by_id(portfolio_id, user_id)
        if not portfolio:
            return False

        # If deleting default portfolio, set another as default
        if portfolio.is_default:
            other_portfolios = await self.get_user_portfolios(
                user_id=user_id, limit=2, is_active=True
            )
            other_active = [p for p in other_portfolios[0] if p.id != portfolio_id]
            if other_active:
                await self._set_default_portfolio(other_active[0].id, user_id)

        # Soft delete
        stmt = (
            update(Portfolio)
            .where(and_(Portfolio.id == portfolio_id, Portfolio.user_id == user_id))
            .values(is_active=False, updated_at=datetime.now(timezone.utc))
        )

        await self.session.execute(stmt)
        logger.info(f"Soft deleted portfolio {portfolio_id} for user {user_id}")
        return True

    async def update_portfolio_values(self, portfolio_id: UUID) -> Portfolio:
        """
        Recalculate and update portfolio total values.

        Args:
            portfolio_id: Portfolio ID

        Returns:
            Portfolio: Updated portfolio
        """
        # Get portfolio with holdings
        stmt = (
            select(Portfolio)
            .options(selectinload(Portfolio.holdings))
            .where(Portfolio.id == portfolio_id)
        )

        result = await self.session.execute(stmt)
        portfolio = result.scalar_one()

        if not portfolio:
            raise NotFoundException("Portfolio", str(portfolio_id))

        # Calculate totals
        total_cost = Decimal("0.00")
        total_value = Decimal("0.00")

        for holding in portfolio.holdings:
            if holding.is_active:
                total_cost += holding.total_cost or Decimal("0.00")
                total_value += holding.total_value or Decimal("0.00")

        total_gain_loss = total_value - total_cost
        total_gain_loss_percentage = Decimal("0.00")

        if total_cost > 0:
            total_gain_loss_percentage = (total_gain_loss / total_cost) * Decimal("100")

        # Update portfolio
        portfolio.total_cost = total_cost
        portfolio.total_value = total_value
        portfolio.total_gain_loss = total_gain_loss
        portfolio.total_gain_loss_percentage = total_gain_loss_percentage
        portfolio.updated_at = datetime.now(timezone.utc)

        await self.session.flush()
        return portfolio

    async def _unset_default_portfolios(self, user_id: UUID) -> None:
        """Unset all default portfolios for a user"""
        stmt = (
            update(Portfolio)
            .where(and_(Portfolio.user_id == user_id, Portfolio.is_default == True))
            .values(is_default=False, updated_at=datetime.now(timezone.utc))
        )

        await self.session.execute(stmt)

    async def _set_default_portfolio(self, portfolio_id: UUID, user_id: UUID) -> None:
        """Set a specific portfolio as default"""
        await self._unset_default_portfolios(user_id)

        stmt = (
            update(Portfolio)
            .where(and_(Portfolio.id == portfolio_id, Portfolio.user_id == user_id))
            .values(is_default=True, updated_at=datetime.now(timezone.utc))
        )

        await self.session.execute(stmt)


class HoldingRepository:
    """Repository for portfolio holding operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(
        self, holding_id: UUID, user_id: UUID
    ) -> Optional[PortfolioHolding]:
        """Get holding by ID for a specific user"""
        stmt = (
            select(PortfolioHolding)
            .where(
                and_(
                    PortfolioHolding.id == holding_id,
                    PortfolioHolding.user_id == user_id,
                    PortfolioHolding.is_active == True,
                )
            )
        )

        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_portfolio_symbol(
        self, portfolio_id: UUID, symbol: str, user_id: UUID
    ) -> Optional[PortfolioHolding]:
        """Get holding by portfolio and symbol (returns most recent lot)"""
        stmt = (
            select(PortfolioHolding)
            .where(
                and_(
                    PortfolioHolding.portfolio_id == portfolio_id,
                    PortfolioHolding.symbol == symbol.upper(),
                    PortfolioHolding.user_id == user_id,
                    PortfolioHolding.is_active == True,
                )
            )
            .order_by(desc(PortfolioHolding.purchase_date))
            .limit(1)  # Only get the first (most recent) lot
        )

        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_all_lots_by_symbol(
        self, portfolio_id: UUID, symbol: str, user_id: UUID
    ) -> List[PortfolioHolding]:
        """Get all lots for a specific symbol in a portfolio"""
        stmt = (
            select(PortfolioHolding)
            .where(
                and_(
                    PortfolioHolding.portfolio_id == portfolio_id,
                    PortfolioHolding.symbol == symbol.upper(),
                    PortfolioHolding.user_id == user_id,
                    PortfolioHolding.is_active == True,
                )
            )
            .order_by(desc(PortfolioHolding.purchase_date))
        )

        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def get_sellable_lots(
        self,
        portfolio_id: UUID,
        symbol: str,
        user_id: UUID,
        wallet_type: Optional[Any] = None,
    ) -> List[PortfolioHolding]:
        """Active lots for a symbol, oldest purchase first (FIFO order).

        Used by the sell flow to draw down lots oldest-first. Optionally scoped
        to a single wallet so positions held under different wallets are not
        mixed. Cash holdings are not lots and are never returned here.
        """
        conditions = [
            PortfolioHolding.portfolio_id == portfolio_id,
            PortfolioHolding.symbol == symbol.upper(),
            PortfolioHolding.user_id == user_id,
            PortfolioHolding.is_active == True,
            PortfolioHolding.quantity > 0,
        ]
        if wallet_type is not None:
            conditions.append(PortfolioHolding.wallet_type == wallet_type)

        stmt = (
            select(PortfolioHolding)
            .where(and_(*conditions))
            # created_at breaks ties. purchase_date is often date-precision (CSV
            # imports, manual entry), so two lots bought the same day would
            # otherwise come back in arbitrary order — and FIFO would consume a
            # different lot run to run, changing the cost basis of the sale.
            .order_by(
                PortfolioHolding.purchase_date.asc(),
                PortfolioHolding.created_at.asc(),
            )
            # Locked until the sale commits. Without it two sells of the same
            # shares (a second tab, a retried request) both pass the quantity
            # check and the Life Wallet is credited twice; with it the second
            # waits, then sees what the first left. populate_existing makes "sees"
            # true: the sell route has already loaded one of these lots, and
            # without it the session hands back that copy, read before the wait.
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def get_portfolio_holdings(
        self,
        portfolio_id: UUID,
        user_id: UUID,
        skip: int = 0,
        limit: int = 50,
        asset_type: Optional[str] = None,
        exchange: Optional[str] = None,
        sector: Optional[str] = None,
    ) -> Tuple[List[PortfolioHolding], int]:
        """Get paginated holdings for a portfolio"""
        conditions = [
            PortfolioHolding.portfolio_id == portfolio_id,
            PortfolioHolding.user_id == user_id,
            PortfolioHolding.is_active == True,
        ]

        if asset_type:
            conditions.append(PortfolioHolding.type == asset_type)

        if exchange:
            conditions.append(PortfolioHolding.exchange == exchange.upper())

        if sector:
            conditions.append(PortfolioHolding.sector == sector)

        # Count query
        count_stmt = select(func.count(PortfolioHolding.id)).where(and_(*conditions))
        count_result = await self.session.execute(count_stmt)
        total_count = count_result.scalar()

        stmt = (
            select(PortfolioHolding)
            .where(and_(*conditions))
            .order_by(desc(PortfolioHolding.total_value))
            .offset(skip)
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        holdings = result.scalars().all()

        return holdings, total_count

    async def get_all_lots(self, portfolio_id: UUID, user_id: UUID) -> List[PortfolioHolding]:
        """Every lot in a portfolio, sold-out ones included — history needs both."""
        stmt = select(PortfolioHolding).where(
            and_(
                PortfolioHolding.portfolio_id == portfolio_id,
                PortfolioHolding.user_id == user_id,
            )
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create_or_aggregate_holding(
        self,
        portfolio_id: UUID,
        user_id: UUID,
        holding_data: Dict[str, Any],
        aggregate: bool = True,
    ) -> PortfolioHolding:
        """
        Create new holding or aggregate with existing one

        When aggregate=True and holding exists:
        - Sums up quantities
        - Calculates weighted average cost
        - Example:
          Existing: 100 shares @ $50 = $5,000
          New: 50 shares @ $60 = $3,000
          Result: 150 shares @ $53.33 avg = $8,000 total
        """
        try:
            # Validate required fields
            if "symbol" not in holding_data or not holding_data["symbol"]:
                raise ValueError("Symbol is required for holding creation/update")

            symbol = holding_data["symbol"].upper()

            # Get new purchase details
            new_quantity = holding_data.get("quantity", Decimal("0"))
            new_cost = holding_data.get("average_cost", Decimal("0"))
            new_total_cost = new_quantity * new_cost

            # Check if holding exists with SAME purchase date (for lot tracking)
            # If purchase_date differs, create a new lot instead of aggregating
            purchase_date = holding_data.get("purchase_date")

            # ⚡ LOT TRACKING FIX: Check ALL lots for this symbol, not just the most recent
            # This ensures we don't accidentally aggregate lots with different purchase dates
            existing = None
            if aggregate and purchase_date:
                # Check if a lot with the EXACT same purchase date already exists
                all_lots = await self.get_all_lots_by_symbol(
                    portfolio_id, symbol, user_id
                )
                # Compare as UTC: a driver may hand back a naive datetime for a
                # timezone-aware column, and naive != aware even at the same instant.
                existing = next(
                    (lot for lot in all_lots if to_utc(lot.purchase_date) == to_utc(purchase_date)),
                    None,
                )

                if existing:
                    logger.info(
                        f"Found existing lot for {symbol} with matching purchase date {purchase_date}, will aggregate"
                    )
                else:
                    # No lot with matching date found - create new lot
                    logger.info(
                        f"No existing lot found for {symbol} with purchase date {purchase_date}, creating new lot"
                    )
            elif aggregate:
                # No purchase date specified - check most recent lot
                existing = await self.get_by_portfolio_symbol(
                    portfolio_id, symbol, user_id
                )

            # ⚡ LOT TRACKING: Only aggregate if we found a matching lot
            should_aggregate = aggregate and existing is not None

            if not aggregate:
                logger.info(
                    f"Creating new lot for {symbol}: aggregate=False (CSV import mode)"
                )
                existing = None  # Force creation of new lot

            if existing and should_aggregate:
                # AGGREGATE: Sum quantities and calculate weighted average cost
                old_quantity = existing.quantity
                old_total_cost = existing.quantity * existing.average_cost

                # Calculate new aggregated values
                total_quantity = old_quantity + new_quantity
                total_cost_sum = old_total_cost + new_total_cost

                # Weighted average cost = total cost / total quantity
                weighted_avg_cost = (
                    total_cost_sum / total_quantity
                    if total_quantity > 0
                    else Decimal("0")
                )

                # Update existing holding with aggregated values
                existing.quantity = total_quantity
                existing.average_cost = weighted_avg_cost
                existing.total_cost = total_cost_sum

                # Update current price if provided, otherwise keep existing
                if "current_price" in holding_data:
                    existing.current_price = holding_data["current_price"]

                # Recalculate derived fields
                existing.total_value = existing.quantity * existing.current_price
                existing.gain_loss = existing.total_value - existing.total_cost
                if existing.total_cost > 0:
                    existing.gain_loss_percentage = (
                        existing.gain_loss / existing.total_cost
                    ) * Decimal("100")
                else:
                    existing.gain_loss_percentage = Decimal("0")

                existing.updated_at = datetime.now(timezone.utc)
                holding = existing

                logger.info(
                    f"Aggregated holding {symbol}: "
                    f"{old_quantity} + {new_quantity} = {total_quantity} shares @ "
                    f"${weighted_avg_cost:.2f} avg (was ${existing.average_cost:.2f})"
                )

            elif existing and not aggregate:
                # REPLACE: Update existing holding (old behavior)
                for key, value in holding_data.items():
                    if key != "symbol":  # Don't update symbol
                        setattr(existing, key, value)

                # Recalculate derived fields
                if "quantity" in holding_data or "average_cost" in holding_data:
                    existing.total_cost = existing.quantity * existing.average_cost
                    existing.total_value = existing.quantity * existing.current_price
                    existing.gain_loss = existing.total_value - existing.total_cost
                    if existing.total_cost > 0:
                        existing.gain_loss_percentage = (
                            existing.gain_loss / existing.total_cost
                        ) * Decimal("100")

                existing.updated_at = datetime.now(timezone.utc)
                holding = existing
                logger.info(
                    f"Replaced existing holding {existing.symbol} for portfolio {portfolio_id}"
                )

            else:
                # CREATE: New holding
                quantity = holding_data.get("quantity", Decimal("0"))
                average_cost = holding_data.get("average_cost", Decimal("0"))
                current_price = holding_data.get("current_price", average_cost)

                holding_data["total_cost"] = quantity * average_cost
                holding_data["total_value"] = quantity * current_price
                holding_data["gain_loss"] = (
                    holding_data["total_value"] - holding_data["total_cost"]
                )
                holding_data["gain_loss_percentage"] = (
                    Decimal("0")
                    if holding_data["total_cost"] == 0
                    else (
                        (holding_data["gain_loss"] / holding_data["total_cost"])
                        * Decimal("100")
                    )
                )

                # Set purchase_date to now if not provided
                if (
                    "purchase_date" not in holding_data
                    or holding_data["purchase_date"] is None
                ):
                    holding_data["purchase_date"] = datetime.now(timezone.utc)

                # Create new holding - remove portfolio_id and user_id from holding_data to avoid conflicts
                clean_holding_data = {
                    k: v
                    for k, v in holding_data.items()
                    if k not in ["portfolio_id", "user_id"]
                }
                holding = PortfolioHolding(
                    portfolio_id=portfolio_id, user_id=user_id, **clean_holding_data
                )
                self.session.add(holding)
                logger.info(
                    f"Created new holding {holding.symbol} for portfolio {portfolio_id}"
                )

            await self.session.flush()
            await self.session.refresh(holding)
            return holding

        except Exception as e:
            logger.error(
                "Error creating/aggregating holding: %s: %s",
                type(e).__name__,
                e,
                exc_info=True,
            )
            await self.session.rollback()
            raise

    async def update_holding_prices(
        self,
        holding_id: UUID,
        current_price: Decimal,
        market_data: Optional[Dict[str, Any]] = None,
    ) -> PortfolioHolding:
        """Update holding with new price data"""
        holding = await self.session.get(PortfolioHolding, holding_id)
        if not holding:
            raise NotFoundException("Holding", str(holding_id))

        # Update price and calculated fields
        holding.current_price = current_price
        holding.total_value = holding.quantity * current_price
        holding.gain_loss = holding.total_value - holding.total_cost

        if holding.total_cost > 0:
            holding.gain_loss_percentage = (
                holding.gain_loss / holding.total_cost
            ) * Decimal("100")

        # Update additional market data if provided
        if market_data:
            if "dividend_yield" in market_data:
                holding.dividend_yield = market_data["dividend_yield"]
            if "annual_dividend" in market_data:
                holding.annual_dividend = market_data["annual_dividend"]

        holding.last_price_update_at = datetime.now(timezone.utc)
        holding.updated_at = datetime.now(timezone.utc)

        await self.session.flush()
        return holding

    async def update_holding(
        self, holding_id: UUID, user_id: UUID, updates: Dict[str, Any]
    ) -> Optional[PortfolioHolding]:
        """Update holding attributes with recalculation of derived fields"""
        try:
            holding = await self.get_by_id(holding_id, user_id)
            if not holding:
                return None

            # Update attributes
            for key, value in updates.items():
                if hasattr(holding, key) and key not in [
                    "id",
                    "user_id",
                    "portfolio_id",
                    "created_at",
                ]:
                    setattr(holding, key, value)

            # Recalculate derived fields if quantity, cost or price changed
            if (
                "quantity" in updates
                or "average_cost" in updates
                or "averageCost" in updates
                or "current_price" in updates
            ):
                if "averageCost" in updates:
                    holding.average_cost = updates["averageCost"]

                holding.total_cost = holding.quantity * holding.average_cost
                holding.total_value = holding.quantity * holding.current_price
                holding.gain_loss = holding.total_value - holding.total_cost
                if holding.total_cost > 0:
                    holding.gain_loss_percentage = (
                        holding.gain_loss / holding.total_cost
                    ) * Decimal("100")
                else:
                    holding.gain_loss_percentage = Decimal("0")

            holding.updated_at = datetime.now(timezone.utc)

            await self.session.flush()
            await self.session.refresh(holding)
            return holding
        except Exception as e:
            logger.error(
                "Error updating holding %s: %s: %s",
                holding_id,
                type(e).__name__,
                e,
                exc_info=True,
            )
            await self.session.rollback()
            raise

    async def delete_holding(self, holding_id: UUID, user_id: UUID) -> bool:
        """Soft delete holding (mark as inactive)"""
        stmt = (
            update(PortfolioHolding)
            .where(
                and_(
                    PortfolioHolding.id == holding_id,
                    PortfolioHolding.user_id == user_id,
                )
            )
            .values(is_active=False, updated_at=datetime.now(timezone.utc))
        )

        result = await self.session.execute(stmt)
        return result.rowcount > 0

class TransactionRepository:
    """Repository for portfolio transaction operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, transaction_data: Dict[str, Any]) -> PortfolioTransaction:
        """Create a new transaction"""
        transaction = PortfolioTransaction(**transaction_data)
        self.session.add(transaction)
        await self.session.flush()
        await self.session.refresh(transaction)

        logger.info(
            f"Created transaction {transaction.id} for portfolio {transaction.portfolio_id}"
        )
        return transaction

    async def sum_realized_pnl(
        self, user_id: UUID, portfolio_id: Optional[UUID] = None
    ) -> Tuple[Decimal, int]:
        """Total realized P&L across the user's completed sells.

        Sums ``capital_gain`` over ``type == 'sell'`` transactions (set by the
        FIFO sell flow) and counts them. Returns ``(realized_gain_loss, count)``.
        Sums are taken as-is across currencies — mirroring how the rest of the
        portfolio reports a single gain/loss figure.
        """
        conditions = [
            PortfolioTransaction.user_id == user_id,
            PortfolioTransaction.type == "sell",
            PortfolioTransaction.capital_gain.isnot(None),
        ]
        if portfolio_id is not None:
            conditions.append(PortfolioTransaction.portfolio_id == portfolio_id)

        stmt = select(
            func.coalesce(func.sum(PortfolioTransaction.capital_gain), 0),
            func.count(PortfolioTransaction.id),
        ).where(and_(*conditions))
        result = await self.session.execute(stmt)
        total, count = result.one()
        return Decimal(str(total)), int(count)

    async def get_by_id(
        self, transaction_id: UUID, user_id: UUID
    ) -> Optional[PortfolioTransaction]:
        """Get transaction by ID for a specific user"""
        stmt = select(PortfolioTransaction).where(
            and_(
                PortfolioTransaction.id == transaction_id,
                PortfolioTransaction.user_id == user_id,
            )
        )

        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_trades(self, portfolio_id: UUID, user_id: UUID) -> List[PortfolioTransaction]:
        """All buys and sells of a portfolio, oldest first, unpaginated."""
        stmt = (
            select(PortfolioTransaction)
            .where(
                and_(
                    PortfolioTransaction.portfolio_id == portfolio_id,
                    PortfolioTransaction.user_id == user_id,
                    PortfolioTransaction.type.in_(("buy", "sell")),
                )
            )
            .order_by(PortfolioTransaction.transaction_date)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_portfolio_transactions(
        self,
        portfolio_id: UUID,
        user_id: UUID,
        skip: int = 0,
        limit: int = 50,
        transaction_type: Optional[str] = None,
        symbol: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> Tuple[List[PortfolioTransaction], int]:
        """Get paginated transactions for a portfolio"""
        conditions = [
            PortfolioTransaction.portfolio_id == portfolio_id,
            PortfolioTransaction.user_id == user_id,
        ]

        if transaction_type:
            conditions.append(PortfolioTransaction.type == transaction_type)

        if symbol:
            conditions.append(PortfolioTransaction.symbol == symbol.upper())

        if start_date:
            conditions.append(PortfolioTransaction.transaction_date >= start_date)

        if end_date:
            conditions.append(PortfolioTransaction.transaction_date <= end_date)

        # Count query
        count_stmt = select(func.count(PortfolioTransaction.id)).where(
            and_(*conditions)
        )
        count_result = await self.session.execute(count_stmt)
        total_count = count_result.scalar()

        # Data query
        stmt = (
            select(PortfolioTransaction)
            .where(and_(*conditions))
            .order_by(
                desc(PortfolioTransaction.transaction_date),
                desc(PortfolioTransaction.created_at),
            )
            .offset(skip)
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        transactions = result.scalars().all()

        return transactions, total_count

    async def update(
        self, transaction_id: UUID, user_id: UUID, update_data: Dict[str, Any]
    ) -> Optional[PortfolioTransaction]:
        """Update transaction"""
        stmt = (
            update(PortfolioTransaction)
            .where(
                and_(
                    PortfolioTransaction.id == transaction_id,
                    PortfolioTransaction.user_id == user_id,
                )
            )
            .values(**update_data, updated_at=datetime.now(timezone.utc))
        )

        await self.session.execute(stmt)
        return await self.get_by_id(transaction_id, user_id)

    async def delete(self, transaction_id: UUID, user_id: UUID) -> bool:
        """Delete transaction (hard delete as it affects calculations)"""
        stmt = select(PortfolioTransaction).where(
            and_(
                PortfolioTransaction.id == transaction_id,
                PortfolioTransaction.user_id == user_id,
            )
        )

        result = await self.session.execute(stmt)
        transaction = result.scalar_one_or_none()

        if transaction:
            await self.session.delete(transaction)
            logger.info(f"Deleted transaction {transaction_id}")
            return True

        return False


class MarketDataRepository:
    """Repository for market data operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_latest_price(
        self, symbol: str, exchange: str
    ) -> Optional[MarketData]:
        """Get latest market data for a symbol"""
        stmt = (
            select(MarketData)
            .where(
                and_(
                    MarketData.symbol == symbol.upper(),
                    MarketData.exchange == exchange.upper(),
                )
            )
            .order_by(desc(MarketData.data_timestamp))
            .limit(1)
        )

        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_historical_prices(
        self, symbol: str, exchange: str, start_date: datetime, end_date: datetime
    ) -> List[MarketData]:
        """Get historical price data for a symbol"""
        stmt = (
            select(MarketData)
            .where(
                and_(
                    MarketData.symbol == symbol.upper(),
                    MarketData.exchange == exchange.upper(),
                    MarketData.data_timestamp >= start_date,
                    MarketData.data_timestamp <= end_date,
                )
            )
            .order_by(MarketData.data_timestamp)
        )

        result = await self.session.execute(stmt)
        return result.scalars().all()


class CurrencyRepository:
    """Repository for currency rate operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_latest_rate(
        self, from_currency: str, to_currency: str
    ) -> Optional[CurrencyRate]:
        """The latest recorded rate between two currencies.

        A table estimate the old code saved as live is passed over (see
        not_a_saved_estimate): this is what values a foreign holding, and a
        stale 31.5 there would misprice it.
        """
        from app.utils.exchange_rate_service import not_a_saved_estimate

        conditions = [
            CurrencyRate.from_currency == from_currency.upper(),
            CurrencyRate.to_currency == to_currency.upper(),
        ]
        trusted = not_a_saved_estimate(CurrencyRate, from_currency, to_currency)
        if trusted is not None:
            conditions.append(trusted)
        stmt = (
            select(CurrencyRate)
            .where(and_(*conditions))
            .order_by(desc(CurrencyRate.rate_timestamp))
            .limit(1)
        )

        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_or_update_rate(self, rate_data: Dict[str, Any]) -> CurrencyRate:
        """Atomically upsert currency rate using PostgreSQL INSERT ... ON CONFLICT DO UPDATE"""
        stmt = (
            pg_insert(CurrencyRate)
            .values(**rate_data)
            .on_conflict_do_update(
                constraint="uq_currency_rates_pair_time",
                set_={
                    k: rate_data[k]
                    for k in rate_data
                    if k not in ("id", "from_currency", "to_currency", "rate_timestamp", "created_at")
                },
            )
            .returning(CurrencyRate)
        )

        result = await self.session.execute(stmt)
        await self.session.flush()
        return result.scalar_one()


# Repository factory functions for dependency injection
def get_portfolio_repository(session: AsyncSession) -> PortfolioRepository:
    """Get Portfolio repository instance"""
    return PortfolioRepository(session)


def get_holding_repository(session: AsyncSession) -> HoldingRepository:
    """Get Holding repository instance"""
    return HoldingRepository(session)


def get_transaction_repository(session: AsyncSession) -> TransactionRepository:
    """Get Transaction repository instance"""
    return TransactionRepository(session)


