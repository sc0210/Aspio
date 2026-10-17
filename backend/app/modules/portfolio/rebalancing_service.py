"""
Portfolio Rebalancing Service for Aspiro FastAPI backend.

This module provides business logic for portfolio rebalancing, asset allocation tracking,
FX accumulation management, and generating rebalancing recommendations based on user targets.
"""

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional, Tuple, Dict
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from ...core.exceptions import NotFoundException, BusinessLogicException
from .models import PortfolioHolding, Portfolio
from .repositories import PortfolioRepository, HoldingRepository
from .rebalancing_schemas import (
    AssetAllocationTarget, AssetAllocationSummary, CurrentAssetAllocation,
    RebalancingPlan, RebalancingTransaction, FXAccumulation,
    RebalancingAlert, AlertType, ActionType, DashboardMetricsEnhanced,
    DashboardRebalancingData
)

logger = logging.getLogger(__name__)


def safe_decimal(value: any, default: Decimal = Decimal("0")) -> Decimal:
    """
    Safely convert a value to Decimal, filtering out NaN and Infinity.
    Returns default value if the input is None, NaN, Infinity, or invalid.
    """
    if value is None:
        return default

    try:
        dec_value = Decimal(str(value)) if not isinstance(value, Decimal) else value
        if not dec_value.is_finite():
            logger.warning(f"Non-finite Decimal value detected: {value}, using default: {default}")
            return default
        return dec_value
    except (ValueError, TypeError, Exception) as e:
        logger.warning(f"Invalid Decimal conversion for value {value}: {e}, using default: {default}")
        return default


def safe_decimal_division(numerator: Decimal, denominator: Decimal, default: Decimal = Decimal("0")) -> Decimal:
    """
    Safely divide decimals with NaN/Infinity checks.
    Returns default value if either operand is invalid or denominator is zero.
    """
    numerator = safe_decimal(numerator)
    denominator = safe_decimal(denominator)

    if denominator == Decimal("0"):
        return default

    try:
        result = numerator / denominator
        if not result.is_finite():
            logger.warning(f"Division resulted in non-finite value: {numerator}/{denominator}, using default: {default}")
            return default
        return result
    except Exception as e:
        logger.warning(f"Division error {numerator}/{denominator}: {e}, using default: {default}")
        return default


class RebalancingService:
    """Service for portfolio rebalancing operations"""

    # Default allocation targets based on the investment plan
    DEFAULT_TARGETS = [
        {
            "asset_symbol": "0050",
            "asset_name": "台股ETF 0050",
            "asset_type": "etf",
            "target_percentage": Decimal("45.0"),
            "deviation_threshold": Decimal("5.0")
        },
        {
            "asset_symbol": "VT",
            "asset_name": "美股ETF VT",
            "asset_type": "etf",
            "target_percentage": Decimal("20.0"),
            "deviation_threshold": Decimal("5.0")
        },
        {
            "asset_symbol": "CRYPTO",
            "asset_name": "加密貨幣",
            "asset_type": "crypto",
            "target_percentage": Decimal("10.0"),
            "deviation_threshold": Decimal("5.0")
        },
        {
            "asset_symbol": "CASH",
            "asset_name": "現金與活存",
            "asset_type": "cash",
            "target_percentage": Decimal("10.0"),
            "deviation_threshold": Decimal("5.0")
        },
        {
            "asset_symbol": "SAVINGS",
            "asset_name": "緊急備用金",
            "asset_type": "cash",
            "target_percentage": Decimal("10.0"),
            "deviation_threshold": Decimal("5.0")
        },
        {
            "asset_symbol": "STOCK_LOCKED",
            "asset_name": "台股未實現(已鎖定)",
            "asset_type": "stock",
            "target_percentage": Decimal("5.0"),
            "deviation_threshold": Decimal("5.0")
        }
    ]

    # FX conversion threshold
    FX_CONVERSION_THRESHOLD_TWD = Decimal("80000")  # NT$80,000

    # Transaction fee rates
    TW_STOCK_FEE_RATE = Decimal("0.001425")  # 0.1425%
    US_STOCK_FEE_RATE = Decimal("0.00")  # Assuming no fee for simplicity
    CRYPTO_FEE_RATE = Decimal("0.001")  # 0.1%

    def __init__(self, session: AsyncSession):
        self.session = session
        self.portfolio_repo = PortfolioRepository(session)
        self.holding_repo = HoldingRepository(session)
        # Request-scoped: the service is built per request in the routers, so
        # this dies with the response and can never answer for another user.
        self._allocation_cache: Dict[tuple, AssetAllocationSummary] = {}

    async def get_current_allocation(
        self,
        user_id: UUID,
        portfolio_id: Optional[UUID] = None
    ) -> AssetAllocationSummary:
        """
        Calculate current asset allocation and compare with targets.

        Returns comprehensive allocation summary with deviations and recommended actions.

        Memoised for the life of this service instance: the rebalancing
        dashboard reaches this from three directions (directly, via
        calculate_rebalancing_plan and via get_rebalancing_alerts), and each
        route used to re-fetch the portfolio and reload every holding. Callers
        only read the summary, never mutate it.
        """
        key = (str(user_id), str(portfolio_id) if portfolio_id else None)
        if key not in self._allocation_cache:
            self._allocation_cache[key] = await self._compute_current_allocation(
                user_id, portfolio_id
            )
        return self._allocation_cache[key]

    async def _compute_current_allocation(
        self,
        user_id: UUID,
        portfolio_id: Optional[UUID] = None
    ) -> AssetAllocationSummary:
        """Do the actual allocation work — see :meth:`get_current_allocation`."""
        # Get portfolio
        if portfolio_id:
            portfolio = await self.portfolio_repo.get_by_id(portfolio_id, user_id)
        else:
            portfolio = await self.portfolio_repo.get_default_portfolio(user_id)

        if not portfolio:
            raise NotFoundException("Portfolio", "default")

        # Get all holdings
        holdings, _ = await self.holding_repo.get_portfolio_holdings(
            portfolio.id, user_id, limit=1000
        )

        # Calculate total portfolio value
        total_value = Decimal("0")
        holdings_by_type: Dict[str, Decimal] = {}

        # total_value is in the holding's own currency; the buckets and the
        # target percentages are TWD, so convert before summing.
        fx_rates: Dict[str, Decimal] = {}

        for holding in holdings:
            if not holding.is_active:
                continue

            # Safely get holding value, handle NaN/Infinity
            value = safe_decimal(holding.total_value, Decimal("0"))
            currency = (getattr(holding, "currency", None) or "TWD").upper()
            if currency != "TWD":
                if currency not in fx_rates:
                    fx_rates[currency] = await self._twd_rate(currency)
                value = value * fx_rates[currency]
            total_value += value

            # Group by asset category
            category = self._categorize_holding(holding)
            holdings_by_type[category] = holdings_by_type.get(category, Decimal("0")) + value

        # Ensure total_value is valid
        total_value = safe_decimal(total_value, Decimal("0"))

        logger.info(f"Total portfolio value: {total_value}, Holdings by type: {holdings_by_type}")

        # Get target allocations (user-customized or defaults)
        target_allocations = self._get_target_allocations(portfolio)

        # Calculate current allocations and deviations
        allocations: List[CurrentAssetAllocation] = []
        max_deviation = Decimal("0")
        requires_rebalancing = False

        for target in target_allocations:
            asset_symbol = target["asset_symbol"]
            current_value = safe_decimal(holdings_by_type.get(asset_symbol, Decimal("0")), Decimal("0"))

            # Use safe division to calculate percentage
            current_pct = safe_decimal_division(
                current_value * Decimal("100"),
                total_value,
                Decimal("0")
            )

            target_pct = safe_decimal(target["target_percentage"], Decimal("0"))
            deviation = current_pct - target_pct

            # Calculate target value and delta amount safely
            target_value = safe_decimal_division(
                total_value * target_pct,
                Decimal("100"),
                Decimal("0")
            )
            delta_amount = target_value - current_value

            # Determine action
            if abs(deviation) <= target["deviation_threshold"]:
                action = ActionType.HOLD
                color_code = "#10B981"  # Green - in balance
            elif deviation > 0:
                action = ActionType.SELL
                color_code = "#EF4444"  # Red - overweight
                requires_rebalancing = True
            else:
                action = ActionType.BUY
                color_code = "#3B82F6"  # Blue - underweight
                requires_rebalancing = True

            # Track max deviation
            max_deviation = max(max_deviation, abs(deviation))

            allocations.append(CurrentAssetAllocation(
                asset_symbol=asset_symbol,
                asset_name=target["asset_name"],
                asset_type=target["asset_type"],
                current_value=current_value.quantize(Decimal("0.01")),
                current_percentage=current_pct.quantize(Decimal("0.01")),
                target_percentage=target_pct,
                deviation=deviation.quantize(Decimal("0.01")),
                delta_amount=delta_amount.quantize(Decimal("0.01")),
                action=action,
                color_code=color_code
            ))

        # Get last rebalance date from portfolio metadata
        last_rebalance = portfolio.last_rebalance_at

        return AssetAllocationSummary(
            total_portfolio_value=total_value.quantize(Decimal("0.01")),
            total_target_value=total_value.quantize(Decimal("0.01")),
            allocations=allocations,
            in_balance=not requires_rebalancing,
            requires_rebalancing=requires_rebalancing,
            largest_deviation=max_deviation.quantize(Decimal("0.01")),
            last_rebalance_date=last_rebalance,
            currency="TWD",
            last_updated=datetime.now(timezone.utc)
        )

    async def _twd_rate(self, currency: str) -> Decimal:
        """Rate to TWD; 1 when unavailable, so a failed lookup degrades to the old behaviour."""
        from app.utils.exchange_rate_service import get_exchange_rate_service

        try:
            rate = await get_exchange_rate_service(self.session).get_exchange_rate(currency, "TWD")
        except Exception as e:
            logger.warning(f"FX lookup {currency}->TWD failed: {e}")
            return Decimal("1")
        return safe_decimal(rate, Decimal("1")) or Decimal("1")

    async def calculate_rebalancing_plan(
        self,
        user_id: UUID,
        portfolio_id: Optional[UUID] = None
    ) -> RebalancingPlan:
        """
        Generate a detailed rebalancing plan with recommended transactions.
        """
        # Get current allocation
        allocation_summary = await self.get_current_allocation(user_id, portfolio_id)

        if allocation_summary.in_balance:
            # No rebalancing needed
            return RebalancingPlan(
                total_portfolio_value=allocation_summary.total_portfolio_value,
                available_funds=Decimal("0"),
                transactions=[],
                total_buy_amount=Decimal("0"),
                total_sell_amount=Decimal("0"),
                total_fees=Decimal("0"),
                net_cash_after=Decimal("0"),
                target_cash_after=Decimal("0"),
                currency="TWD"
            )

        # Separate buy and sell transactions
        transactions: List[RebalancingTransaction] = []
        total_buy = Decimal("0")
        total_sell = Decimal("0")
        total_fees = Decimal("0")

        # Calculate available funds from overweight assets
        available_funds = Decimal("0")

        # First pass: Calculate sells (generate funds)
        for alloc in allocation_summary.allocations:
            if alloc.action == ActionType.SELL and alloc.asset_type != "cash":
                # Amount to sell (negative delta means we have too much)
                sell_amount = abs(alloc.delta_amount)
                fee_rate = self._get_fee_rate(alloc.asset_type)
                estimated_fee = sell_amount * fee_rate

                transactions.append(RebalancingTransaction(
                    asset_symbol=alloc.asset_symbol,
                    asset_name=alloc.asset_name,
                    action=ActionType.SELL,
                    amount=sell_amount.quantize(Decimal("0.01")),
                    estimated_fees=estimated_fee.quantize(Decimal("0.01")),
                    priority=1,
                    notes=f"Reduce from {alloc.current_percentage}% to {alloc.target_percentage}%"
                ))

                total_sell += sell_amount
                total_fees += estimated_fee
                available_funds += (sell_amount - estimated_fee)

        # Second pass: Calculate buys (use funds)
        for alloc in allocation_summary.allocations:
            if alloc.action == ActionType.BUY:
                # Amount to buy (positive delta means we need more)
                buy_amount = alloc.delta_amount
                fee_rate = self._get_fee_rate(alloc.asset_type)
                estimated_fee = buy_amount * fee_rate

                transactions.append(RebalancingTransaction(
                    asset_symbol=alloc.asset_symbol,
                    asset_name=alloc.asset_name,
                    action=ActionType.BUY,
                    amount=buy_amount.quantize(Decimal("0.01")),
                    estimated_fees=estimated_fee.quantize(Decimal("0.01")),
                    priority=2,
                    notes=f"Increase from {alloc.current_percentage}% to {alloc.target_percentage}%"
                ))

                total_buy += buy_amount
                total_fees += estimated_fee

        # Calculate cash position after rebalancing
        cash_alloc = next((a for a in allocation_summary.allocations if a.asset_symbol == "CASH"), None)
        current_cash = cash_alloc.current_value if cash_alloc else Decimal("0")
        net_cash_after = current_cash + available_funds - total_buy
        target_cash = allocation_summary.total_portfolio_value * Decimal("0.10")  # 10% target

        return RebalancingPlan(
            total_portfolio_value=allocation_summary.total_portfolio_value,
            available_funds=available_funds.quantize(Decimal("0.01")),
            transactions=transactions,
            total_buy_amount=total_buy.quantize(Decimal("0.01")),
            total_sell_amount=total_sell.quantize(Decimal("0.01")),
            total_fees=total_fees.quantize(Decimal("0.01")),
            net_cash_after=net_cash_after.quantize(Decimal("0.01")),
            target_cash_after=target_cash.quantize(Decimal("0.01")),
            currency="TWD"
        )

    async def calculate_fx_accumulation(
        self,
        user_id: UUID,
        portfolio_id: Optional[UUID] = None
    ) -> List[FXAccumulation]:
        """
        Calculate FX (foreign exchange) accumulation for currency conversion tracking.
        Monitors accumulated foreign currency and alerts when conversion threshold is met.
        """
        # For MVP, we'll track USD accumulation
        # In production, this would query actual cash balances or income in foreign currency

        # Mock FX accumulation calculation
        # In real implementation: sum all USD income/cash holdings
        usd_accumulated = Decimal("2500.00")  # Example: $2,500 USD accumulated

        # Try to fetch real-time USD to TWD exchange rate with timeout
        # If it takes too long, use cached/fallback rate to avoid slow dashboard loads
        try:
            from app.utils.exchange_rate_service import get_exchange_rate_service
            exchange_service = get_exchange_rate_service()

            # Set a short timeout for dashboard requests to avoid slow page loads
            import asyncio
            current_usd_twd_rate = await asyncio.wait_for(
                exchange_service.get_usd_to_twd_rate(),
                timeout=3.0  # 3 second timeout
            )
        except asyncio.TimeoutError:
            logger.warning("Exchange rate API timeout, using fallback rate")
            current_usd_twd_rate = Decimal("32.50")
        except Exception as e:
            logger.warning(f"Exchange rate fetch error: {e}, using fallback rate")
            current_usd_twd_rate = Decimal("32.50")

        # Fallback to approximate rate if API fails
        if current_usd_twd_rate is None:
            current_usd_twd_rate = Decimal("32.50")
            logger.warning("Using fallback USD/TWD rate")

        accumulated_twd = usd_accumulated * current_usd_twd_rate

        ready_to_convert = accumulated_twd >= self.FX_CONVERSION_THRESHOLD_TWD
        estimated_fee = accumulated_twd * Decimal("0.001") if ready_to_convert else Decimal("0")  # 0.1% fee

        fx_accumulation = FXAccumulation(
            currency="USD",
            accumulated_amount=usd_accumulated.quantize(Decimal("0.01")),
            accumulated_twd=accumulated_twd.quantize(Decimal("0.01")),
            conversion_threshold=self.FX_CONVERSION_THRESHOLD_TWD,
            current_fx_rate=current_usd_twd_rate,
            ready_to_convert=ready_to_convert,
            estimated_conversion_fee=estimated_fee.quantize(Decimal("0.01")),
            last_conversion_date=None,
            next_conversion_target=self.FX_CONVERSION_THRESHOLD_TWD
        )

        return [fx_accumulation]

    async def get_rebalancing_alerts(
        self,
        user_id: UUID,
        portfolio_id: Optional[UUID] = None
    ) -> List[RebalancingAlert]:
        """
        Generate rebalancing alerts based on current portfolio status.
        """
        allocation_summary = await self.get_current_allocation(user_id, portfolio_id)
        fx_accumulations = await self.calculate_fx_accumulation(user_id, portfolio_id)

        alerts: List[RebalancingAlert] = []

        # Check for rebalancing requirements
        if allocation_summary.requires_rebalancing:
            out_of_balance_assets = [
                alloc.asset_name for alloc in allocation_summary.allocations
                if alloc.action != ActionType.HOLD
            ]

            alerts.append(RebalancingAlert(
                alert_type=AlertType.REBALANCE_REQUIRED,
                severity="warning",
                title="Portfolio Rebalancing Required",
                message=f"Your portfolio has deviated {allocation_summary.largest_deviation:.1f}% from targets",
                affected_assets=out_of_balance_assets,
                deviation_percentage=allocation_summary.largest_deviation,
                suggested_action="Review the rebalancing plan and execute recommended transactions"
            ))

        # Check for FX conversion readiness
        for fx in fx_accumulations:
            if fx.ready_to_convert:
                alerts.append(RebalancingAlert(
                    alert_type=AlertType.FX_CONVERT_READY,
                    severity="info",
                    title=f"FX Conversion Ready: {fx.currency}",
                    message=f"You have accumulated NT${fx.accumulated_twd:,.0f} worth of {fx.currency} (≥ NT${fx.conversion_threshold:,.0f} threshold)",
                    affected_assets=[fx.currency],
                    suggested_action=f"Consider converting {fx.accumulated_amount:.2f} {fx.currency} to TWD for rebalancing"
                ))

        # Check for low cash warning
        cash_alloc = next((a for a in allocation_summary.allocations if a.asset_symbol == "CASH"), None)
        if cash_alloc and cash_alloc.current_percentage < Decimal("5.0"):
            alerts.append(RebalancingAlert(
                alert_type=AlertType.LOW_CASH,
                severity="warning",
                title="Low Cash Balance",
                message=f"Cash allocation is only {cash_alloc.current_percentage:.1f}% (target: {cash_alloc.target_percentage:.1f}%)",
                affected_assets=["CASH"],
                suggested_action="Consider selling overweight assets to increase cash reserves"
            ))

        return alerts

    async def get_dashboard_rebalancing_data(
        self,
        user_id: UUID,
        portfolio_id: Optional[UUID] = None
    ) -> DashboardRebalancingData:
        """
        Get complete rebalancing data for dashboard display.
        Combines metrics, allocation, plan, FX, and alerts into one response.
        """
        # Get portfolio for basic metrics
        if portfolio_id:
            portfolio = await self.portfolio_repo.get_by_id(portfolio_id, user_id)
        else:
            portfolio = await self.portfolio_repo.get_default_portfolio(user_id)

        if not portfolio:
            raise NotFoundException("Portfolio", "default")

        # Calculate all rebalancing components
        allocation_summary = await self.get_current_allocation(user_id, portfolio_id)
        rebalancing_plan = await self.calculate_rebalancing_plan(user_id, portfolio_id)
        fx_accumulation = await self.calculate_fx_accumulation(user_id, portfolio_id)
        alerts = await self.get_rebalancing_alerts(user_id, portfolio_id)

        # Calculate days since last rebalance
        days_since_rebalance = None
        if portfolio.last_rebalance_at:
            days_since_rebalance = (datetime.now(timezone.utc) - portfolio.last_rebalance_at).days

        # Sum FX accumulation
        total_fx_twd = sum(fx.accumulated_twd for fx in fx_accumulation)
        fx_ready = any(fx.ready_to_convert for fx in fx_accumulation)

        # Build enhanced metrics with safe decimal handling
        portfolio_total_value = safe_decimal(portfolio.total_value, Decimal("0"))
        portfolio_growth = safe_decimal(portfolio.total_gain_loss_percentage, Decimal("0"))

        metrics = DashboardMetricsEnhanced(
            total_balance=portfolio_total_value,
            monthly_income=Decimal("0"),  # Would calculate from transactions
            monthly_expenses=Decimal("0"),  # Would calculate from transactions
            net_worth=portfolio_total_value,
            savings_rate=Decimal("0"),
            portfolio_value=portfolio_total_value,
            portfolio_growth=portfolio_growth,
            available_funds=safe_decimal(rebalancing_plan.available_funds, Decimal("0")),
            fx_accumulation_twd=safe_decimal(total_fx_twd, Decimal("0")),
            fx_ready_to_convert=fx_ready,
            next_rebalance_date=None,  # Could calculate based on schedule
            days_since_rebalance=days_since_rebalance,
            rebalancing_required=allocation_summary.requires_rebalancing,
            largest_deviation=safe_decimal(allocation_summary.largest_deviation, Decimal("0")),
            currency="TWD",
            last_updated=datetime.now(timezone.utc)
        )

        return DashboardRebalancingData(
            metrics=metrics,
            allocation_summary=allocation_summary,
            rebalancing_plan=rebalancing_plan if allocation_summary.requires_rebalancing else None,
            fx_accumulation=fx_accumulation,
            alerts=alerts
        )

    def _get_target_allocations(self, portfolio: Portfolio) -> List[Dict]:
        """
        Get target allocations for a portfolio.
        Uses user-saved targets from metadata if available, otherwise returns defaults.
        Supports custom assets added by user.
        """
        # Check if user has customized target allocations in portfolio metadata
        meta = portfolio.item_metadata
        if meta and "target_allocations" in meta:
            saved_targets = meta["target_allocations"]
            logger.info(f"Using user-customized target allocations from portfolio {portfolio.id}")

            # Convert saved targets back to the format expected by the rest of the code
            target_list = []

            # Handle both old format (just percentage) and new format (with metadata)
            for asset_symbol, target_data in saved_targets.items():
                if isinstance(target_data, dict):
                    # New format with asset metadata
                    target_pct = Decimal(str(target_data["targetPct"])) * Decimal("100")  # 0.45 -> 45.0
                    asset_name = target_data.get("assetName", asset_symbol)
                    asset_type = target_data.get("assetType", "unknown")
                else:
                    # Old format (just percentage number)
                    target_pct = Decimal(str(target_data)) * Decimal("100")
                    # Try to find name/type from defaults
                    default_target = next((t for t in self.DEFAULT_TARGETS if t["asset_symbol"] == asset_symbol), None)
                    asset_name = default_target["asset_name"] if default_target else asset_symbol
                    asset_type = default_target["asset_type"] if default_target else "unknown"

                target_list.append({
                    "asset_symbol": asset_symbol,
                    "asset_name": asset_name,
                    "asset_type": asset_type,
                    "target_percentage": target_pct,
                    "deviation_threshold": Decimal("5.0")  # Default threshold
                })

            return target_list
        else:
            logger.info("Using default target allocations")
            return self.DEFAULT_TARGETS

    def _categorize_holding(self, holding: PortfolioHolding) -> str:
        """Categorize holding into asset allocation buckets"""
        symbol = holding.symbol.upper()
        asset_type = holding.type.lower()

        # Match to predefined categories
        if "0050" in symbol:
            return "0050"
        elif "VT" in symbol or "VTI" in symbol:
            return "VT"
        elif asset_type in ["crypto", "cryptocurrency"]:
            return "CRYPTO"
        elif asset_type == "cash" or "CASH" in symbol:
            # Distinguish between regular cash and emergency fund
            if "EMERGENCY" in symbol or "SAVINGS" in symbol:
                return "SAVINGS"
            return "CASH"
        elif "LOCKED" in symbol or holding.item_metadata.get("locked"):
            return "STOCK_LOCKED"
        else:
            # Default to closest match
            return "0050"  # Treat other Taiwan stocks as part of 0050 allocation

    def _get_fee_rate(self, asset_type: str) -> Decimal:
        """Get transaction fee rate based on asset type"""
        if asset_type == "etf" or asset_type == "stock":
            return self.TW_STOCK_FEE_RATE
        elif asset_type == "crypto":
            return self.CRYPTO_FEE_RATE
        else:
            return Decimal("0")


# Service factory function
def get_rebalancing_service(session: AsyncSession) -> RebalancingService:
    """Get Rebalancing service instance"""
    return RebalancingService(session)
