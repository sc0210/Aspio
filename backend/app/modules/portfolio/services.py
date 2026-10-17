"""
Portfolio service layer for Aspiro FastAPI backend.

This module contains business logic for portfolio operations,
including transaction processing, performance calculations, and analytics.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import get_settings
from ...core.exceptions import (
    BusinessLogicException,
    NotFoundException,
)
from ...common.constants import (
    PerformanceMetrics,
    PortfolioSettings,
)
from .repositories import (
    PortfolioRepository,
    HoldingRepository,
    TransactionRepository,
    MarketDataRepository,
    CurrencyRepository,
)
from .schemas import (
    PortfolioCreate,
    PortfolioResponse,
    HoldingResponse,
    TransactionResponse,
    PerformanceMetrics,
)
from .market_data_service import get_market_data_service
from .manual_pricing import is_manually_priced
from .return_calculator import lot_irr
from .symbols import canonical_symbol, looks_like_stripped_tw_code
from app.utils.datetime_helpers import (
    business_day_of,
    business_now,
    business_today,
    utc_now,
)




logger = logging.getLogger(__name__)

# Share of TWR valuations that must rest on real stored closes before it is shown.
TWR_MIN_REAL_PRICE_SHARE = 0.9
# A diversified equity portfolio sits near 1; outside this the inputs are broken.
MAX_PLAUSIBLE_BETA = 3.0
# SPY is only as good as its last close: beta against a stale benchmark is noise.
BENCHMARK_MAX_AGE_DAYS = 5


# The blended benchmark's legs (stored in historical_prices, refreshed daily).
BENCHMARK_TW = "^TWII"   # TAIEX
BENCHMARK_US = "VT"      # global equity, priced in USD
FX_USD_TWD = "TWD=X"


def _closes(rows) -> list:
    """(date, close) pairs from price rows whose date is a date, datetime or ISO string."""
    out = []
    for row in rows or []:
        d = row.get("date")
        try:
            d = d.date() if isinstance(d, datetime) else d if isinstance(d, date) else date.fromisoformat(str(d)[:10])
        except (TypeError, ValueError):
            continue
        if row.get("close") is not None:
            out.append((d, float(row["close"])))
    return sorted(out)


def annual_return_from_twr(twr: Optional[dict]) -> Optional[float]:
    """The annual return to show, or None: TWR since inception, only when it is
    annualised (a year of history) and rests on real closes."""
    if not twr or twr.get("annualized_return") is None:
        return None
    share = (twr.get("data_quality") or {}).get("real_price_share", 0) or 0
    return float(twr["annualized_return"]) if share >= TWR_MIN_REAL_PRICE_SHARE else None


def plausible_beta(beta: Optional[float], benchmark_last: Optional[date], today: date) -> Optional[float]:
    """Beta, or None when the benchmark is stale or the value is implausible."""
    if beta is None or benchmark_last is None:
        return None
    if (today - benchmark_last).days > BENCHMARK_MAX_AGE_DAYS:
        return None
    return beta if abs(beta) <= MAX_PLAUSIBLE_BETA else None

settings = get_settings()


class PortfolioService:
    """Service for portfolio management operations"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.portfolio_repo = PortfolioRepository(session)
        self.holding_repo = HoldingRepository(session)
        self.transaction_repo = TransactionRepository(session)
        self.market_data_repo = MarketDataRepository(session)
        self.currency_repo = CurrencyRepository(session)

    async def create_portfolio(
        self, portfolio_data: PortfolioCreate, user_id: UUID
    ) -> PortfolioResponse:
        """
        Create a new portfolio for a user.

        Args:
            portfolio_data: Portfolio creation data
            user_id: Owner user ID

        Returns:
            PortfolioResponse: Created portfolio
        """
        # Check portfolio limits
        current_count = await self.portfolio_repo.get_user_portfolios_count(user_id)
        if current_count >= settings.MAX_PORTFOLIOS_PER_USER:
            raise BusinessLogicException(
                f"Maximum portfolios limit reached ({settings.MAX_PORTFOLIOS_PER_USER})"
            )

        # Validate currency
        if portfolio_data.currency not in settings.SUPPORTED_CURRENCIES:
            raise BusinessLogicException(
                f"Unsupported currency: {portfolio_data.currency}. "
                f"Supported: {', '.join(settings.SUPPORTED_CURRENCIES)}"
            )

        portfolio = await self.portfolio_repo.create(portfolio_data.model_dump(), user_id)

        await self.session.commit()

        logger.info(f"Created portfolio {portfolio.id} for user {user_id}")
        return PortfolioResponse.model_validate(portfolio)

    async def get_portfolio(
        self, portfolio_id: UUID, user_id: UUID
    ) -> PortfolioResponse:
        """Get portfolio by ID"""
        portfolio = await self.portfolio_repo.get_by_id(portfolio_id, user_id)
        if not portfolio:
            raise NotFoundException("Portfolio", str(portfolio_id))

        return PortfolioResponse.model_validate(portfolio)

    async def get_user_portfolios(
        self,
        user_id: UUID,
        skip: int = 0,
        limit: int = 20,
        is_active: Optional[bool] = None,
        currency: Optional[str] = None,
    ) -> Tuple[List[PortfolioResponse], int]:
        """Get paginated portfolios for a user"""
        portfolios, total = await self.portfolio_repo.get_user_portfolios(
            user_id=user_id,
            skip=skip,
            limit=limit,
            is_active=is_active,
            currency=currency,
        )

        portfolio_responses = [PortfolioResponse.model_validate(p) for p in portfolios]
        return portfolio_responses, total

    async def get_default_portfolio(self, user_id: UUID) -> Optional[PortfolioResponse]:
        """Get user's default portfolio"""
        portfolio = await self.portfolio_repo.get_default_portfolio(user_id)

        if portfolio:
            # Holdings are already eager-loaded by the repository via
            # selectinload(Portfolio.holdings), and the session uses
            # expire_on_commit=False, so the relationship is populated and fresh.
            # A session.refresh(portfolio, ["holdings"]) here would issue a second,
            # redundant portfolio_holdings query for data we already have.
            return PortfolioResponse.model_validate(portfolio)

        return None

    async def add_holding(
        self, user_id: UUID, holding_data, aggregate: bool = False
    ) -> HoldingResponse:
        """
        Add a new holding to the user's default portfolio

        Args:
            user_id: User ID
            holding_data: Holding data to add
            aggregate: If True, aggregate with existing holdings of same symbol.
                      If False, always create a new lot (useful for CSV imports)
        """

        # Get or create default portfolio
        portfolio = await self.get_default_portfolio(user_id)
        if not portfolio:
            # Create default portfolio if none exists
            portfolio_create = PortfolioCreate(
                name="My Portfolio",
                description="Default investment portfolio",
                currency="USD",
                is_default=True,
            )
            portfolio = await self.create_portfolio(portfolio_create, user_id)

        # Create holding data
        holding_create_data = {
            "portfolio_id": portfolio.id,
            "user_id": user_id,
            "symbol": holding_data.symbol,
            "name": holding_data.name,
            "type": holding_data.type,
            "wallet_type": holding_data.wallet_type
            or "portfolio",  # Default to portfolio
            "quantity": holding_data.quantity,
            "average_cost": holding_data.average_cost,
            "current_price": holding_data.average_cost,  # Start with average cost as current price
            "currency": holding_data.currency,
            "exchange": holding_data.exchange,
            "market": holding_data.market or "US",
            "sector": holding_data.sector,
            "region": holding_data.region,
            "purchase_date": holding_data.purchase_date,  # ⚡ LOT TRACKING: Preserve purchase date
            "total_cost": holding_data.quantity * holding_data.average_cost,
            "total_value": holding_data.quantity * holding_data.average_cost,
            "gain_loss": Decimal("0"),
            "gain_loss_percentage": Decimal("0"),
            "is_active": True,
            "last_price_update_at": utc_now(),
            "item_metadata": {},
        }

        # Create the holding directly, with aggregation control
        holding = await self.holding_repo.create_or_aggregate_holding(
            portfolio_id=portfolio.id,
            user_id=user_id,
            holding_data=holding_create_data,
            aggregate=aggregate,  # ⚡ CSV FIX: Don't aggregate for CSV imports
        )

        # Create a buy transaction record for audit trail
        transaction_data = {
            "portfolio_id": portfolio.id,
            "holding_id": holding.id,
            "user_id": user_id,
            "type": "buy",
            "symbol": holding_data.symbol,
            "exchange": holding_data.exchange,
            "quantity": holding_data.quantity,
            "price": holding_data.average_cost,
            "total_amount": holding_data.quantity * holding_data.average_cost,
            "fees": Decimal("0"),
            "taxes": Decimal("0"),
            "currency": holding_data.currency,
            # business_now(), not utc_now(): a lot's transaction_date is read back as
            # a calendar day, so a purchase entered at 01:00 Taipei must not record
            # as the previous day — and at a month boundary, the previous month.
            "transaction_date": holding_data.purchase_date
            or business_now(),  # ⚡ LOT TRACKING: Use actual purchase date
            "notes": f"Initial purchase: {holding_data.name} ({holding_data.symbol})",
            "item_metadata": {},
        }

        # Create transaction record
        await self.transaction_repo.create(transaction_data)

        # ========================================
        # 🔄 WALLET SYNC: Create corresponding transaction for wallet bridge
        # Cash holdings: amount = quantity (it is the cash value)
        # Non-cash (stock/ETF/crypto/bond): amount = quantity × avg_cost (total spend)
        # ========================================
        if holding_data.type == "cash":
            sync_amount = abs(Decimal(str(holding_data.quantity)))
        else:
            sync_amount = abs(
                Decimal(str(holding_data.quantity)) * Decimal(str(holding_data.average_cost))
            )
        await self._sync_wallet_transaction(
            user_id=user_id,
            holding_data=holding_data,
            amount=sync_amount,
            transaction_date=holding_data.purchase_date or business_now(),
            holding_id=holding.id,
        )

        # Update portfolio totals
        await self._update_portfolio_totals(portfolio.id, user_id)

        # Commit the transaction to ensure data is persisted
        await self.session.commit()
        logger.info(
            f"Committed holding {holding_data.symbol} to database",
            extra={"user_id": str(user_id), "symbol": holding_data.symbol},
        )

        # Fetch real current price from market data service in background
        # Skip for crypto and cash - these are manually updated
        if holding_data.type.lower() not in PortfolioSettings.SKIP_PRICE_FETCH_TYPES:
            # Use background task for external API call to avoid blocking the request
            from app.core.background_tasks import run_in_background

            async def fetch_and_update_price():
                """Background task to fetch and update holding price"""
                try:
                    from app.core.config import get_settings
                    from app.modules.portfolio.market_data_service import (
                        get_market_data_service as get_mds,
                    )
                    from app.database.session import AsyncSessionLocal

                    settings = get_settings()
                    market_data_service = get_mds(
                        finlab_token=settings.FINLAB_API_TOKEN,
                        tradingview_key=settings.TRADINGVIEW_API_KEY,
                    )

                    # Fetch current price with timeout
                    current_price = await asyncio.wait_for(
                        market_data_service.get_current_price(
                            symbol=holding_data.symbol,
                            market=holding_create_data["market"],
                        ),
                        timeout=PortfolioSettings.PRICE_UPDATE_TIMEOUT_SECONDS,
                    )

                    if current_price and current_price > 0:
                        # Update in a new database session
                        async with AsyncSessionLocal() as bg_session:
                            from app.modules.portfolio.repositories import (
                                HoldingRepository,
                            )

                            holding_repo = HoldingRepository(bg_session)

                            # Refresh holding from database
                            bg_holding = await holding_repo.get_by_id(
                                holding.id, user_id
                            )
                            if bg_holding:
                                bg_holding.current_price = current_price
                                bg_holding.total_value = (
                                    bg_holding.quantity * current_price
                                )
                                bg_holding.gain_loss = (
                                    bg_holding.total_value - bg_holding.total_cost
                                )
                                if bg_holding.total_cost > 0:
                                    bg_holding.gain_loss_percentage = (
                                        bg_holding.gain_loss / bg_holding.total_cost
                                    ) * 100
                                bg_holding.last_price_update_at = utc_now()

                                # The lot's own annualised return (see lot_irr: an XIRR
                                # over the symbol's whole ledger mis-stated every lot).
                                bg_holding.irr = lot_irr(
                                    bg_holding.total_cost,
                                    bg_holding.total_value,
                                    bg_holding.purchase_date,
                                )

                                await bg_session.commit()
                                logger.info(
                                    f"Background: Updated {holding_data.symbol} with price: {current_price}"
                                )
                                return {
                                    "symbol": holding_data.symbol,
                                    "price": float(current_price),
                                    "status": "success",
                                }
                    else:
                        logger.warning(
                            f"Background: Could not fetch price for {holding_data.symbol}"
                        )
                        return {"symbol": holding_data.symbol, "status": "no_price"}

                except asyncio.TimeoutError:
                    logger.warning(
                        f"Background: Timeout fetching price for {holding_data.symbol}"
                    )
                    return {"symbol": holding_data.symbol, "status": "timeout"}
                except Exception as e:
                    logger.error(
                        f"Background: Failed to fetch price for {holding_data.symbol}: {str(e)}"
                    )
                    return {
                        "symbol": holding_data.symbol,
                        "status": "error",
                        "error": str(e),
                    }

            # Submit background task (non-blocking)
            await run_in_background(
                fetch_and_update_price, task_name=f"fetch_price_{holding_data.symbol}"
            )
            logger.info(
                f"Submitted background task to fetch price for {holding_data.symbol}"
            )
        else:
            logger.info(
                f"Skipping price fetch for {holding_data.type} asset: {holding_data.symbol}"
            )

        return HoldingResponse.model_validate(holding)

    async def get_user_holdings(
        self,
        user_id: UUID,
        portfolio_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[List[HoldingResponse], int]:
        """Get holdings for a user, optionally filtered by portfolio"""

        if portfolio_id:
            # Get holdings for specific portfolio
            holdings, total_count = await self.holding_repo.get_portfolio_holdings(
                portfolio_id=portfolio_id, user_id=user_id, skip=skip, limit=limit
            )
        else:
            # Get holdings from user's default portfolio
            portfolio = await self.get_default_portfolio(user_id)
            if not portfolio:
                return [], 0

            holdings, total_count = await self.holding_repo.get_portfolio_holdings(
                portfolio_id=portfolio.id, user_id=user_id, skip=skip, limit=limit
            )

        # Convert to response objects
        holding_responses = [HoldingResponse.model_validate(holding) for holding in holdings]
        return holding_responses, total_count

    async def _sync_wallet_transaction(
        self,
        user_id: UUID,
        holding_data,
        amount: Decimal,
        transaction_date: datetime,
        holding_id: Optional[UUID] = None,
    ) -> None:
        """
        🔄 Bridge portfolio actions to the Transactions ledger.

        CASH holdings in emergency wallet:
          deposit  → EXPENSE in Life Wallet   (cash leaving daily funds)
          withdraw → INCOME  in Life Wallet   (cash returning to daily funds)

        Non-cash holdings (stock, ETF, crypto, bond) in portfolio wallet:
          buy → EXPENSE in Life Wallet  (capital deployed to buy an asset)

        Skipped:
          - cash in portfolio (no corresponding cash flow)
          - non-cash not in portfolio (edge case, no clear wallet source)
        """
        wallet_type = holding_data.wallet_type or "portfolio"
        asset_type = (holding_data.type or "").lower()
        is_cash = asset_type == "cash"
        is_investable = asset_type in ("stock", "etf", "crypto", "bond")

        # Cash holdings only sync from emergency wallet
        if is_cash and wallet_type == "portfolio":
            logger.debug(f"Skipping wallet sync for cash in portfolio: {holding_data.symbol}")
            return

        # Non-cash holdings only sync when placed in portfolio
        if is_investable and wallet_type != "portfolio":
            logger.debug(f"Skipping wallet sync for {asset_type} in {wallet_type}: {holding_data.symbol}")
            return

        # Skip unrecognised asset types
        if not is_cash and not is_investable:
            logger.debug(f"Skipping wallet sync for unknown asset type: {asset_type}")
            return

        is_deposit = holding_data.quantity > 0

        try:
            from app.modules.transactions.repositories import (
                TransactionRepository,
                TransactionCategoryRepository,
            )
            from app.modules.transactions.models import (
                CategoryType,
                TransactionType,
                TransactionWalletType,
            )

            transaction_repo = TransactionRepository(self.session)
            category_repo = TransactionCategoryRepository(self.session)

            if is_cash:
                # ── CASH path: transfer between Life Wallet and portfolio/emergency ──
                category = await category_repo.get_by_name("Transfer")
                if not category:
                    category = await category_repo.create_flush({
                        "name": "Transfer",
                        "type": CategoryType.EXPENSE,
                        "color": "#6B7280",
                        "icon": "🔄",
                        "description": "Money transfers between wallets",
                    })
                    logger.info(f"Created 'Transfer' category for user {user_id}")

                if is_deposit:
                    transaction_type = TransactionType.EXPENSE
                    description = f"Transfer to {wallet_type.replace('_', ' ').title()} Wallet - {holding_data.currency}"
                    notes = (holding_data.notes if hasattr(holding_data, "notes") and holding_data.notes
                             else f"Deposit: {holding_data.name}")
                else:
                    transaction_type = TransactionType.INCOME
                    description = f"Transfer from {wallet_type.replace('_', ' ').title()} Wallet - {holding_data.currency}"
                    notes = (holding_data.notes if hasattr(holding_data, "notes") and holding_data.notes
                             else f"Withdrawal: {holding_data.name}")

                transaction_data = {
                    "user_id": user_id,
                    "type": transaction_type,
                    "wallet_type": TransactionWalletType.LIFE,
                    "category_id": category.id,
                    "amount": amount,
                    "currency": holding_data.currency or "TWD",
                    "description": description,
                    "notes": notes,
                    "transaction_date": business_day_of(transaction_date),
                    "payment_method": "bank_transfer",
                    # Links this ledger entry to the holding it paid for, so a later
                    # edit or delete of that holding can find and correct it.
                    "holding_id": holding_id,
                }

            else:
                # ── Non-cash path: stock/ETF/crypto/bond purchase ──────────────
                # Flow: Life Wallet (expense) → Portfolio Wallet (asset acquired).
                # Dividends are recorded against the holding for reporting only;
                # nothing here credits a wallet for them.
                category = await category_repo.get_by_name("Investment Purchase")
                if not category:
                    category = await category_repo.create_flush({
                        "name": "Investment Purchase",
                        "type": CategoryType.EXPENSE,
                        "color": "#8B5CF6",
                        "icon": "📈",
                        "description": "Asset purchases — cash leaves Life Wallet to Portfolio",
                    })
                    logger.info(f"Created 'Investment Purchase' category for user {user_id}")

                qty = abs(holding_data.quantity)
                price = holding_data.average_cost
                asset_currency = (holding_data.currency or "TWD").upper()

                # Convert to TWD so all wallet transactions share a single currency
                # and summary totals (which SUM amount directly) remain accurate.
                twd_amount = amount
                display_currency = asset_currency
                if asset_currency != "TWD":
                    try:
                        from app.modules.transactions.models import Currency as CurrencyModel
                        stmt_fc = select(CurrencyModel).where(
                            and_(CurrencyModel.code == asset_currency, CurrencyModel.is_active == True)
                        )
                        stmt_twd = select(CurrencyModel).where(
                            and_(CurrencyModel.code == "TWD", CurrencyModel.is_active == True)
                        )
                        res_fc = await self.session.execute(stmt_fc)
                        res_twd = await self.session.execute(stmt_twd)
                        fc_row = res_fc.scalar_one_or_none()
                        twd_row = res_twd.scalar_one_or_none()
                        if fc_row and twd_row and twd_row.exchange_rate_usd > 0:
                            # exchange_rate_usd = how much 1 unit is worth in USD
                            twd_amount = amount * fc_row.exchange_rate_usd / twd_row.exchange_rate_usd
                            display_currency = "TWD"
                        else:
                            # Static fallback rates (USD→TWD, etc.)
                            _FALLBACK_TO_TWD = {
                                "USD": Decimal("31.5"),
                                "EUR": Decimal("34.0"),
                                "JPY": Decimal("0.21"),
                                "HKD": Decimal("4.05"),
                                "SGD": Decimal("23.5"),
                                "CNY": Decimal("4.4"),
                            }
                            if asset_currency in _FALLBACK_TO_TWD:
                                twd_amount = amount * _FALLBACK_TO_TWD[asset_currency]
                                display_currency = "TWD"
                    except Exception as conv_err:
                        logger.warning(f"Currency conversion to TWD failed for {asset_currency}: {conv_err}")
                        # Keep original currency if conversion fails

                description = (
                    f"Buy {holding_data.symbol} ×{qty:g} @ "
                    f"{price:,.2f} {asset_currency}"
                )
                notes = (holding_data.notes if hasattr(holding_data, "notes") and holding_data.notes
                         else f"{holding_data.name} ({asset_type.upper()})")

                transaction_data = {
                    "user_id": user_id,
                    "type": TransactionType.EXPENSE,
                    "wallet_type": TransactionWalletType.LIFE,  # cash leaves Life Wallet
                    "category_id": category.id,
                    "amount": twd_amount,
                    "currency": display_currency,
                    "description": description,
                    "notes": notes,
                    "transaction_date": business_day_of(transaction_date),
                    "payment_method": "bank_transfer",
                    # Links this ledger entry to the holding it paid for, so a later
                    # edit or delete of that holding can find and correct it.
                    "holding_id": holding_id,
                }

            transaction = await transaction_repo.create_flush(transaction_data, str(user_id))
            logger.info(
                f"✅ Wallet sync transaction created: "
                f"{transaction_data['type'].value} {amount} {holding_data.currency} "
                f"wallet={transaction_data['wallet_type'].value} (id={transaction.id})"
            )

        except Exception as e:
            logger.error(
                f"❌ Failed to create synchronized wallet transaction: {str(e)}",
                exc_info=True,
            )
            # Must propagate — the mirror image of the sell-side case in
            # credit_sale_proceeds_to_life. A buy debits the Life Wallet; if that
            # debit is swallowed the holding is still created, so the asset is
            # counted with no cash ever leaving Life and net worth is inflated by
            # the purchase amount.
            #
            # add_holding has no rollback of its own, so atomicity here rests on
            # get_db() rolling the session back on any exception. Called outside a
            # FastAPI request, the caller must handle that itself.
            raise

    async def _to_twd(self, amount: Decimal, currency: str):
        """Convert ``amount`` in ``currency`` to TWD → (twd_amount, "TWD").

        Tries the live Currency table, falls back to static rates, and only
        returns the original (amount, currency) if the currency is unknown.
        """
        amount = Decimal(str(amount))
        cur = (currency or "TWD").upper()
        if cur == "TWD":
            return amount, "TWD"
        try:
            from app.modules.transactions.models import Currency as CurrencyModel

            fc_row = (await self.session.execute(
                select(CurrencyModel).where(
                    and_(CurrencyModel.code == cur, CurrencyModel.is_active == True)
                )
            )).scalar_one_or_none()
            twd_row = (await self.session.execute(
                select(CurrencyModel).where(
                    and_(CurrencyModel.code == "TWD", CurrencyModel.is_active == True)
                )
            )).scalar_one_or_none()
            if fc_row and twd_row and twd_row.exchange_rate_usd > 0:
                return amount * fc_row.exchange_rate_usd / twd_row.exchange_rate_usd, "TWD"
        except Exception as conv_err:
            logger.warning(f"Currency conversion to TWD failed for {cur}: {conv_err}")

        _FALLBACK_TO_TWD = {
            "USD": Decimal("31.5"), "EUR": Decimal("34.0"), "JPY": Decimal("0.21"),
            "HKD": Decimal("4.05"), "SGD": Decimal("23.5"), "CNY": Decimal("4.4"),
        }
        if cur in _FALLBACK_TO_TWD:
            return amount * _FALLBACK_TO_TWD[cur], "TWD"
        return amount, cur

    async def credit_sale_proceeds_to_life(
        self,
        user_id: UUID,
        net_proceeds: Decimal,
        currency: str,
        symbol: str,
        transaction_date: datetime,
    ) -> None:
        """Return asset-sale proceeds to the Life Wallet as INCOME.

        The Portfolio wallet holds assets only — never cash. This mirrors the
        Life-Wallet EXPENSE a buy creates (``_sync_wallet_transaction``): a buy
        moves cash Life → Portfolio (asset acquired); a sell moves it back
        Portfolio → Life (asset liquidated). ``net_proceeds`` is already net of
        fees/taxes and is converted to TWD so wallet totals share one currency.
        """
        if net_proceeds is None or Decimal(str(net_proceeds)) <= 0:
            return
        try:
            from app.modules.transactions.repositories import (
                TransactionRepository,
                TransactionCategoryRepository,
            )
            from app.modules.transactions.models import (
                CategoryType,
                TransactionType,
                TransactionWalletType,
            )

            transaction_repo = TransactionRepository(self.session)
            category_repo = TransactionCategoryRepository(self.session)

            category = await category_repo.get_by_name("Investment Sale")
            if not category:
                category = await category_repo.create_flush({
                    "name": "Investment Sale",
                    "type": CategoryType.INCOME,
                    "color": "#10B981",
                    "icon": "💰",
                    "description": "Asset sale proceeds — cash returns to Life Wallet",
                })
                logger.info(f"Created 'Investment Sale' category for user {user_id}")

            twd_amount, display_currency = await self._to_twd(net_proceeds, currency)

            transaction_data = {
                "user_id": user_id,
                "type": TransactionType.INCOME,
                "wallet_type": TransactionWalletType.LIFE,  # proceeds land in Life Wallet
                "category_id": category.id,
                "amount": twd_amount,
                "currency": display_currency,
                "description": f"Sell {symbol} — proceeds to Life Wallet",
                "notes": f"Net proceeds from selling {symbol}",
                "transaction_date": business_day_of(transaction_date),
                "payment_method": "bank_transfer",
            }
            transaction = await transaction_repo.create_flush(transaction_data, str(user_id))
            logger.info(
                f"✅ Sale proceeds synced to Life Wallet: INCOME {twd_amount} "
                f"{display_currency} from {symbol} (id={transaction.id})"
            )
        except Exception as e:
            logger.error(
                f"❌ Failed to credit sale proceeds to Life Wallet: {str(e)}",
                exc_info=True,
            )
            # Must propagate. This used to swallow, on the theory that a failed
            # wallet sync shouldn't fail the sale — but that trade-off was never
            # on offer: the credit shares the caller's session and the sale's lot
            # drawdown is still uncommitted, so swallowing returned HTTP 200 for a
            # sale that recorded no income. The asset left the portfolio and the
            # cash never arrived, dropping net worth by the sale value.
            #
            # Nothing here rolls back on its own — create_flush only flushes. The
            # rollback comes from the caller: the sell router calls
            # session.rollback() explicitly, and get_db() rolls back on any
            # exception. A caller *outside* a FastAPI request (a script, a
            # background job) gets neither and must own the rollback itself.
            raise

    async def _update_portfolio_totals(
        self, portfolio_id: UUID, user_id: UUID = None
    ) -> None:
        """Update portfolio total values based on current holdings with currency conversion"""
        try:
            logger.info(
                "Updating portfolio totals with currency conversion",
                extra={"portfolio_id": str(portfolio_id), "operation": "update_totals"},
            )
            # Get portfolio using repository directly (not the service method)
            portfolio = await self.portfolio_repo.get_by_id(portfolio_id, user_id)

            if not portfolio:
                logger.warning(f"Portfolio {portfolio_id} not found")
                return

            # Get user_id from portfolio if not provided
            if not user_id:
                user_id = portfolio.user_id

            portfolio_currency = portfolio.currency
            holdings, _ = await self.holding_repo.get_portfolio_holdings(
                portfolio_id, user_id, limit=PortfolioSettings.MAX_HOLDINGS_PER_QUERY
            )
            logger.debug(
                f"Processing portfolio holdings",
                extra={
                    "portfolio_id": str(portfolio_id),
                    "currency": portfolio_currency,
                    "holdings_count": len(holdings),
                },
            )

            # Convert all holdings to portfolio currency and sum
            total_value = Decimal("0")
            total_cost = Decimal("0")

            # Get exchange rate service for real-time rates
            from app.utils.exchange_rate_service import get_exchange_rate_service

            exchange_service = get_exchange_rate_service(self.session)

            for holding in holdings:
                # Convert holding values to portfolio currency
                if holding.currency != portfolio_currency:
                    # Try to get exchange rate from database first
                    rate_record = await self.currency_repo.get_latest_rate(
                        holding.currency, portfolio_currency
                    )

                    if rate_record:
                        conversion_rate = rate_record.rate
                        logger.debug(
                            f"Converting holding currency (from DB cache)",
                            extra={
                                "symbol": holding.symbol,
                                "from_currency": holding.currency,
                                "to_currency": portfolio_currency,
                                "rate": float(conversion_rate),
                            },
                        )
                    else:
                        # Fetch from exchange rate service (which uses API + caching)
                        conversion_rate = await exchange_service.get_exchange_rate(
                            holding.currency, portfolio_currency
                        )

                        if conversion_rate:
                            logger.debug(
                                f"Converting holding currency (from API)",
                                extra={
                                    "symbol": holding.symbol,
                                    "from_currency": holding.currency,
                                    "to_currency": portfolio_currency,
                                    "rate": float(conversion_rate),
                                },
                            )
                        else:
                            # Last resort fallback
                            logger.warning(
                                f"No exchange rate available, using 1.0",
                                extra={
                                    "from_currency": holding.currency,
                                    "to_currency": portfolio_currency,
                                    "symbol": holding.symbol,
                                },
                            )
                            conversion_rate = Decimal("1.0")

                    converted_value = holding.total_value * conversion_rate
                    converted_cost = holding.total_cost * conversion_rate
                    total_value += converted_value
                    total_cost += converted_cost
                else:
                    total_value += holding.total_value
                    total_cost += holding.total_cost

            total_gain_loss = total_value - total_cost
            total_gain_loss_percentage = (
                (total_gain_loss / total_cost * 100) if total_cost > 0 else Decimal("0")
            )

            logger.info(
                "Portfolio totals calculated",
                extra={
                    "portfolio_id": str(portfolio_id),
                    "total_value": float(total_value),
                    "total_cost": float(total_cost),
                    "gain_loss": float(total_gain_loss),
                    "gain_loss_pct": float(total_gain_loss_percentage),
                },
            )

            await self.portfolio_repo.update(
                portfolio_id=portfolio_id,
                user_id=user_id,
                update_data={
                    "total_value": total_value,
                    "total_cost": total_cost,
                    "total_gain_loss": total_gain_loss,
                    "total_gain_loss_percentage": total_gain_loss_percentage,
                },
            )

        except Exception as e:
            logger.error(
                "Failed to update portfolio totals",
                extra={
                    "portfolio_id": str(portfolio_id),
                    "error_type": type(e).__name__,
                },
                exc_info=True,
            )

    async def _fetch_holdings_for_export(
        self,
        user_id: UUID,
        date_from: Optional[datetime],
        date_to: Optional[datetime],
    ):
        from sqlalchemy import select, and_
        from .models import Portfolio, PortfolioHolding

        stmt = (
            select(PortfolioHolding)
            .join(Portfolio, Portfolio.id == PortfolioHolding.portfolio_id)
            .where(
                and_(
                    PortfolioHolding.user_id == user_id,
                    PortfolioHolding.is_active == True,
                )
            )
            .order_by(PortfolioHolding.purchase_date.asc())
        )
        if date_from:
            stmt = stmt.where(PortfolioHolding.purchase_date >= date_from)
        if date_to:
            stmt = stmt.where(PortfolioHolding.purchase_date <= date_to)

        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def export_portfolio_xlsx(
        self,
        user_id: UUID,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> bytes:
        """Export portfolio holdings as XLSX with explicit cell formatting.

        Using XLSX instead of CSV ensures:
        - StockID column is always text (no leading-zero loss: 0050 stays 0050)
        - Numeric columns (Shares, Price, Net income) are right-aligned numbers
        - All columns have appropriate alignment regardless of spreadsheet app
        """
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
        from io import BytesIO

        holdings = await self._fetch_holdings_for_export(user_id, date_from, date_to)

        wb = Workbook()
        ws = wb.active
        ws.title = "Portfolio"

        headers = ["Date", "Type", "StockID", "Currency", "Shares", "Price per shares", "Net income"]
        header_fill = PatternFill(start_color="1E3A5F", end_color="1E3A5F", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF")

        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")

        # Number format for prices / net income
        num_fmt_2dp = '#,##0.000000'
        num_fmt_net = '#,##0.00'

        for row_idx, h in enumerate(holdings, 2):
            date_str = h.purchase_date.strftime("%Y/%m/%d") if h.purchase_date else ""
            price = float(h.average_cost) if h.average_cost else 0.0
            shares = float(h.quantity) if h.quantity else 0.0
            net = -(shares * price)

            row_data = [
                (date_str,         "left",   "@"),           # Date as text
                ("買入",            "center", "@"),           # Type as text
                (str(h.symbol),    "center", "@"),           # StockID forced text (@)
                (str(h.currency),  "center", "@"),           # Currency as text
                (shares,           "right",  num_fmt_2dp),   # Shares as number
                (round(price, 6),  "right",  num_fmt_2dp),   # Price as number
                (round(net, 2),    "right",  num_fmt_net),   # Net income as number
            ]

            for col_idx, (value, align, fmt) in enumerate(row_data, 1):
                cell = ws.cell(row=row_idx, column=col_idx, value=value)
                cell.alignment = Alignment(horizontal=align, vertical="center")
                cell.number_format = fmt

            # Alternate row shading
            if row_idx % 2 == 0:
                row_fill = PatternFill(start_color="F0F4F8", end_color="F0F4F8", fill_type="solid")
                for col_idx in range(1, len(headers) + 1):
                    ws.cell(row=row_idx, column=col_idx).fill = row_fill

        # Auto-fit column widths
        col_widths = [12, 8, 12, 10, 14, 18, 16]
        for col_idx, width in enumerate(col_widths, 1):
            ws.column_dimensions[get_column_letter(col_idx)].width = width

        # Freeze header row
        ws.freeze_panes = "A2"

        buf = BytesIO()
        wb.save(buf)
        return buf.getvalue()

    async def export_portfolio_csv(
        self,
        user_id: UUID,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> str:
        """Export portfolio holdings to CSV (plain text, for programmatic use)."""
        import csv
        from io import StringIO

        holdings = await self._fetch_holdings_for_export(user_id, date_from, date_to)

        output = StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_NONNUMERIC)
        writer.writerow(["Date", "Type", "StockID", "Currency", "Shares",
                         "Price per shares", "Net income"])
        for h in holdings:
            date_str = h.purchase_date.strftime("%Y/%m/%d") if h.purchase_date else ""
            price = float(h.average_cost) if h.average_cost else 0.0
            shares = float(h.quantity) if h.quantity else 0.0
            writer.writerow([
                date_str, "買入", str(h.symbol), str(h.currency),
                shares, round(price, 6), round(-(shares * price), 2),
            ])
        return output.getvalue()


class TransactionService:
    """Service for portfolio transaction operations"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.portfolio_repo = PortfolioRepository(session)
        self.holding_repo = HoldingRepository(session)
        self.transaction_repo = TransactionRepository(session)
        self.market_data_repo = MarketDataRepository(session)
        self.currency_repo = CurrencyRepository(session)

    async def get_transaction(
        self, transaction_id: UUID, user_id: UUID
    ) -> TransactionResponse:
        """Get transaction by ID"""
        transaction = await self.transaction_repo.get_by_id(transaction_id, user_id)
        if not transaction:
            raise NotFoundException("Transaction", str(transaction_id))

        return TransactionResponse.model_validate(transaction)

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
    ) -> Tuple[List[TransactionResponse], int]:
        """Get paginated transactions for a portfolio"""
        # Verify portfolio ownership
        portfolio = await self.portfolio_repo.get_by_id(portfolio_id, user_id)
        if not portfolio:
            raise NotFoundException("Portfolio", str(portfolio_id))

        transactions, total = await self.transaction_repo.get_portfolio_transactions(
            portfolio_id=portfolio_id,
            user_id=user_id,
            skip=skip,
            limit=limit,
            transaction_type=transaction_type,
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
        )

        transaction_responses = [TransactionResponse.model_validate(t) for t in transactions]
        return transaction_responses, total

class MarketDataService:
    """Service for market data operations"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.market_data_repo = MarketDataRepository(session)
        self.currency_repo = CurrencyRepository(session)
        self.holding_repo = HoldingRepository(session)
        self.portfolio_repo = PortfolioRepository(session)

    async def update_portfolio_prices(
        self, portfolio_id: UUID, user_id: UUID
    ) -> Dict[str, Any]:
        """Update all prices for a portfolio"""
        # Verify portfolio ownership
        portfolio = await self.portfolio_repo.get_by_id(portfolio_id, user_id)
        if not portfolio:
            raise NotFoundException("Portfolio", str(portfolio_id))

        holdings, _ = await self.holding_repo.get_portfolio_holdings(
            portfolio_id, user_id, limit=100
        )

        update_results = {"updated_holdings": 0, "failed_holdings": 0, "errors": []}

        for holding in holdings:
            try:
                # Get latest market data (in real implementation, this would call external APIs)
                market_data = await self.market_data_repo.get_latest_price(
                    holding.symbol, holding.exchange
                )

                if market_data:
                    await self.holding_repo.update_holding_prices(
                        holding.id, market_data.price
                    )
                    update_results["updated_holdings"] += 1
                else:
                    # In real implementation, fetch from external API
                    update_results["failed_holdings"] += 1
                    update_results["errors"].append(
                        f"No market data available for {holding.symbol}"
                    )

            except Exception as e:
                logger.error(f"Failed to update prices for {holding.symbol}: {e}")
                update_results["failed_holdings"] += 1
                update_results["errors"].append(
                    f"Failed to update {holding.symbol}: {str(e)}"
                )

        # Update portfolio totals
        await self.portfolio_repo.update_portfolio_values(portfolio_id)

        # Update last price update timestamp
        portfolio.last_price_update_at = datetime.now(timezone.utc)

        await self.session.commit()

        logger.info(
            f"Updated prices for portfolio {portfolio_id}: "
            f"{update_results['updated_holdings']} success, "
            f"{update_results['failed_holdings']} failed"
        )

        return update_results

class AnalyticsService:
    """Service for portfolio analytics and performance calculations"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.portfolio_repo = PortfolioRepository(session)
        self.holding_repo = HoldingRepository(session)
        self.transaction_repo = TransactionRepository(session)

    async def calculate_portfolio_performance(
        self, portfolio_id: UUID, user_id: UUID
    ) -> PerformanceMetrics:
        """Calculate comprehensive portfolio performance metrics"""
        from .historical_price_repository import HistoricalPriceRepository
        from . import metrics_calculator as mc

        # Verify portfolio ownership
        portfolio = await self.portfolio_repo.get_by_id(portfolio_id, user_id)
        if not portfolio:
            raise NotFoundException("Portfolio", str(portfolio_id))

        total_return = portfolio.total_gain_loss
        total_return_percentage = portfolio.total_gain_loss_percentage

        # Fetch active holdings
        holdings, _ = await self.holding_repo.get_portfolio_holdings(
            portfolio_id, user_id, limit=100
        )

        # --- Annual return: the time-weighted return since inception ---
        # Not (value / cost)^(1 / years since the first lot): that treats every
        # dollar as invested since the first purchase, so money added last month
        # "compounds" for years and the rate reads far too low. TWR takes the
        # timing of your own deposits out (see twr.py). Shown only when it is
        # annualised (a year of history) and rests on real closes; otherwise
        # nothing, rather than a number that looks authoritative and isn't.
        cagr: Optional[float] = None
        annualized_return: Optional[Decimal] = None
        twr: Optional[dict] = None
        if holdings:
            try:
                from .performance_tracker import PerformanceTracker

                # A savepoint: a database error inside the TWR rolls back to
                # here instead of aborting the transaction the rest of this
                # method still reads from.
                async with self.session.begin_nested():
                    twr = await PerformanceTracker(self.session).calculate_time_weighted_return(
                        portfolio_id, user_id
                    )
                cagr = annual_return_from_twr(twr)
                if cagr is not None:
                    annualized_return = Decimal(str(round(cagr * 100, 4)))
            except Exception as e:  # a failed TWR must not take the other metrics with it
                logger.warning(f"Annual return (TWR) unavailable: {e}")

        # --- Volatility, drawdown, Sharpe, beta, alpha: the trailing year ---
        # All from the TWR's daily returns (units from lots + sells, valued in
        # TWD, deposits taken out). The previous inputs — a value series rebuilt
        # from today's quantities in mixed currencies — made a plain ETF
        # portfolio's beta 30 and its alpha +250%.
        volatility: Optional[float] = None
        max_drawdown_f: Optional[float] = None
        sharpe: Optional[float] = None
        best_day_f: Optional[float] = None
        worst_day_f: Optional[float] = None
        up_days = 0
        down_days = 0
        win_rate_f: Optional[float] = None
        beta_val: Optional[float] = None
        alpha_val: Optional[float] = None
        benchmark_label: Optional[str] = None

        if twr and twr.get("period_returns"):
            try:
                today = business_today()
                daily = [
                    (date.fromisoformat(p["date"][:10]), float(p["return"]))
                    for p in twr["period_returns"]
                ]
                window_start = today - timedelta(days=mc.RISK_WINDOW_DAYS + 30)
                async with self.session.begin_nested():  # a failed query must not abort the session
                    rows = await HistoricalPriceRepository(self.session).get_batch_price_history(
                        [BENCHMARK_TW, BENCHMARK_US, FX_USD_TWD, "SPY"], window_start
                    )
                series = {sym: _closes(rows.get(sym, [])) for sym in (BENCHMARK_TW, BENCHMARK_US, FX_USD_TWD, "SPY")}

                # The benchmark mirrors the book: Taiwan-listed holdings against the
                # TAIEX, everything priced in another currency against VT in TWD
                # (with the day's USD/TWD rate, since the returns are measured in
                # TWD). Weights are today's split. SPY alone measured mostly how
                # much Taiwan beat the US. Falls back to SPY if a leg is missing
                # or stale, and says so in the label.
                usd_twd = series[FX_USD_TWD][-1][1] if series[FX_USD_TWD] else None
                tw_value = other_value = 0.0
                usd_unpriced = False
                for h in holdings:
                    wallet = getattr(h.wallet_type, "value", h.wallet_type)
                    if str(wallet).lower() != "portfolio" or is_manually_priced(h.symbol, h.type):
                        continue
                    v = float(h.total_value or 0)
                    currency = (h.currency or "TWD").upper()
                    if currency == "TWD":
                        tw_value += v
                    elif currency == "USD":
                        if not usd_twd:
                            usd_unpriced = True
                        else:
                            other_value += v * usd_twd
                    # Other currencies have no leg here and are left out of the weights.
                def usable(closes) -> bool:
                    # Reaches back to the window's start and is fresh: a leg
                    # synced for a week, or one that stopped updating, can't
                    # carry a year's beta.
                    return bool(closes) and (closes[0][0] - window_start).days <= 30 and (
                        today - closes[-1][0]
                    ).days <= BENCHMARK_MAX_AGE_DAYS

                legs, label_parts, leg_lasts = [], [], []
                total_value = tw_value + other_value
                if total_value > 0 and not usd_unpriced:
                    if tw_value > 0 and usable(series[BENCHMARK_TW]):
                        legs.append((tw_value / total_value, series[BENCHMARK_TW]))
                        label_parts.append(("TAIEX", tw_value / total_value))
                        leg_lasts.append(series[BENCHMARK_TW][-1][0])
                    if other_value > 0 and usable(series[BENCHMARK_US]) and usable(series[FX_USD_TWD]):
                        legs.append((other_value / total_value, mc.usd_leg_in_twd(series[BENCHMARK_US], series[FX_USD_TWD])))
                        label_parts.append(("VT", other_value / total_value))
                        leg_lasts.append(min(series[BENCHMARK_US][-1][0], series[FX_USD_TWD][-1][0]))
                needs_both = (tw_value > 0) + (other_value > 0)
                if legs and len(legs) == needs_both:
                    bench = mc.blended_benchmark_closes(legs, window_start, today)
                    bench_last = min(leg_lasts)
                    # Compact, it titles a stat card: "TAIEX/VT 62/38", or "TAIEX".
                    benchmark_label = (
                        "/".join(n for n, _ in label_parts)
                        + ("" if len(label_parts) == 1 else " " + "/".join(f"{w * 100:.0f}" for _, w in label_parts))
                    )
                else:
                    bench = series["SPY"]
                    bench_last = series["SPY"][-1][0] if series["SPY"] else None
                    benchmark_label = "SPY"

                risk = mc.risk_from_twr_returns(daily, bench, today)
                volatility = risk["volatility"]
                max_drawdown_f = risk["max_drawdown"]
                sharpe = risk["sharpe"]
                best_day_f = risk["best_day"] * 100 if risk["best_day"] is not None else None
                worst_day_f = risk["worst_day"] * 100 if risk["worst_day"] is not None else None
                up_days = risk["up_days"]
                down_days = risk["down_days"]
                win_rate_f = risk["win_rate"] * 100 if risk["win_rate"] is not None else None

                beta_val = plausible_beta(risk["beta"], bench_last, today)
                if risk["beta"] is not None and beta_val is None:
                    logger.warning(f"beta {risk['beta']:.2f} not reported ({benchmark_label} last {bench_last}, limit ±{MAX_PLAUSIBLE_BETA})")
                # Alpha stands only on a beta that does.
                alpha_val = risk["alpha"] if beta_val is not None else None
            except Exception as e:  # the stats strip must survive a bad row or a failed query
                logger.warning(f"risk metrics unavailable: {e}")

        metrics = PerformanceMetrics(
            total_return=total_return,
            total_return_percentage=total_return_percentage,
            annualized_return=annualized_return,
            volatility=Decimal(str(round(volatility * 100, 4))) if volatility is not None else None,
            sharpe_ratio=Decimal(str(round(sharpe, 4))) if sharpe is not None else None,
            max_drawdown=Decimal(str(round(max_drawdown_f * 100, 4))) if max_drawdown_f is not None else None,
            best_day=Decimal(str(round(best_day_f, 4))) if best_day_f is not None else None,
            worst_day=Decimal(str(round(worst_day_f, 4))) if worst_day_f is not None else None,
            up_days=up_days,
            down_days=down_days,
            win_rate=Decimal(str(round(win_rate_f, 4))) if win_rate_f is not None else None,
            beta=round(beta_val, 3) if beta_val is not None else None,
            alpha=round(alpha_val, 4) if alpha_val is not None else None,
            benchmark=benchmark_label,
        )

        return metrics

    async def get_asset_allocation(self, user_id: UUID) -> dict:
        """Get portfolio asset allocation breakdown by type, sector, and region with currency conversion"""
        # Get default portfolio
        _portfolio_orm = await self.portfolio_repo.get_default_portfolio(user_id)
        portfolio = PortfolioResponse.model_validate(_portfolio_orm) if _portfolio_orm else None
        if not portfolio:
            return {
                "by_type": [],
                "by_sector": [],
                "by_region": [],
                "base_currency": "TWD",
                "exchange_rate": None,
            }

        # Get holdings
        holdings, _ = await self.holding_repo.get_portfolio_holdings(
            portfolio.id, user_id, limit=100
        )

        # Use TWD as base currency for proper comparison
        base_currency = "TWD"

        # Get exchange rate service for currency conversion
        from app.utils.exchange_rate_service import get_exchange_rate_service

        exchange_service = get_exchange_rate_service(self.session)

        # Get USD to TWD exchange rate for conversion
        usd_to_twd_rate = await exchange_service.get_exchange_rate("USD", "TWD")
        logger.info(f"USD to TWD exchange rate: {usd_to_twd_rate}")

        # Calculate allocations with currency conversion
        total_value_in_base = Decimal("0.00")
        type_dict = {}
        sector_dict = {}
        region_dict = {}

        for holding in holdings:
            if holding.is_active and holding.total_value > 0:
                # Convert holding value to base currency (TWD)
                holding_value = holding.total_value
                if holding.currency == "USD" and usd_to_twd_rate:
                    holding_value = holding.total_value * usd_to_twd_rate
                    logger.debug(
                        f"Converted {holding.symbol} from USD to TWD: {holding.total_value} * {usd_to_twd_rate} = {holding_value}"
                    )
                elif holding.currency != "TWD":
                    # For other currencies, try to get exchange rate
                    exchange_rate = await exchange_service.get_exchange_rate(
                        holding.currency, base_currency
                    )
                    if exchange_rate:
                        holding_value = holding.total_value * exchange_rate
                        logger.debug(
                            f"Converted {holding.symbol} from {holding.currency} to {base_currency}: {holding.total_value} * {exchange_rate} = {holding_value}"
                        )

                total_value_in_base += holding_value

                # By type
                asset_type = holding.type or "Unknown"
                if asset_type not in type_dict:
                    type_dict[asset_type] = Decimal("0.00")
                type_dict[asset_type] += holding_value

                # By sector
                sector = holding.sector or "Unknown"
                if sector not in sector_dict:
                    sector_dict[sector] = Decimal("0.00")
                sector_dict[sector] += holding_value

                # By region
                region = holding.region or "Unknown"
                if region not in region_dict:
                    region_dict[region] = Decimal("0.00")
                region_dict[region] += holding_value

        # Use total_value_in_base for percentage calculations
        total_value = (
            total_value_in_base if total_value_in_base > 0 else Decimal("0.01")
        )

        colors = ["#3B82F6", "#EF4444", "#F59E0B", "#10B981", "#8B5CF6", "#F97316"]

        # Convert to response format
        by_type = []
        for i, (asset_type, value) in enumerate(type_dict.items()):
            percentage = (value / total_value) * Decimal("100")
            by_type.append(
                {
                    "type": asset_type.replace("_", " ").title(),
                    "percentage": float(percentage),
                    "value": float(value),
                    "color": colors[i % len(colors)],
                }
            )

        by_sector = []
        for i, (sector, value) in enumerate(sector_dict.items()):
            percentage = (value / total_value) * Decimal("100")
            by_sector.append(
                {
                    "type": sector,  # Using "type" field for consistency with frontend
                    "percentage": float(percentage),
                    "value": float(value),
                    "color": colors[i % len(colors)],
                }
            )

        by_region = []
        for i, (region, value) in enumerate(region_dict.items()):
            percentage = (value / total_value) * Decimal("100")
            by_region.append(
                {
                    "type": region,  # Using "type" field for consistency with frontend
                    "percentage": float(percentage),
                    "value": float(value),
                    "color": colors[i % len(colors)],
                }
            )

        return {
            "by_type": by_type,
            "by_sector": by_sector,
            "by_region": by_region,
            "base_currency": base_currency,
            "exchange_rate": float(usd_to_twd_rate) if usd_to_twd_rate else None,
        }

    async def get_portfolio_performance(
        self, user_id: UUID, period: str = "1y"
    ) -> dict:
        """
        Calculate real portfolio performance based on current holdings
        Since we don't have historical price data, we derive performance from current gain/loss
        """
        # Get default portfolio
        _portfolio_orm = await self.portfolio_repo.get_default_portfolio(user_id)
        portfolio = PortfolioResponse.model_validate(_portfolio_orm) if _portfolio_orm else None
        if not portfolio:
            return {
                "day_change_percentage": 0,
                "week_change_percentage": 0,
                "month_change_percentage": 0,
                "three_month_change_percentage": 0,
                "six_month_change_percentage": 0,
                "total_gain_loss_percentage": 0,
                "top_holdings": [],
                "worst_holdings": [],
            }

        # Get holdings
        holdings, _ = await self.holding_repo.get_portfolio_holdings(
            portfolio.id, user_id, limit=100
        )

        # Calculate current total gain/loss percentage
        total_gain_loss_pct = (
            float(portfolio.total_gain_loss_percentage)
            if portfolio.total_gain_loss_percentage
            else 0
        )

        # Estimate time-based performance by distributing total gains across time periods
        # This is a simplification - assumes linear growth over the year
        # More accurate: would require historical price data
        estimated_performance = {
            "day_change_percentage": total_gain_loss_pct
            * float(PerformanceMetrics.DAILY_PERFORMANCE_RATIO),
            "week_change_percentage": total_gain_loss_pct
            * float(PerformanceMetrics.WEEKLY_PERFORMANCE_RATIO),
            "month_change_percentage": total_gain_loss_pct
            * float(PerformanceMetrics.MONTHLY_PERFORMANCE_RATIO),
            "three_month_change_percentage": total_gain_loss_pct
            * float(PerformanceMetrics.THREE_MONTH_RATIO),
            "six_month_change_percentage": total_gain_loss_pct
            * float(PerformanceMetrics.SIX_MONTH_RATIO),
            "total_gain_loss_percentage": total_gain_loss_pct,
        }

        # Sort holdings by performance
        active_holdings = [h for h in holdings if h.is_active and h.total_value > 0]
        sorted_by_performance = sorted(
            active_holdings,
            key=lambda h: (
                float(h.gain_loss_percentage) if h.gain_loss_percentage else 0
            ),
            reverse=True,
        )

        # Get top and worst performers
        top_holdings = sorted_by_performance[: PerformanceMetrics.TOP_PERFORMERS_LIMIT]
        worst_holdings = (
            sorted_by_performance[-PerformanceMetrics.WORST_PERFORMERS_LIMIT :]
            if len(sorted_by_performance) >= PerformanceMetrics.WORST_PERFORMERS_LIMIT
            else []
        )

        # Format holdings for response
        def format_holding(h):
            return {
                "id": str(h.id),
                "symbol": h.symbol,
                "name": h.name,
                "gain_loss_percentage": (
                    float(h.gain_loss_percentage) if h.gain_loss_percentage else 0
                ),
                "total_value": float(h.total_value),
                "gain_loss": float(h.gain_loss) if h.gain_loss else 0,
            }

        estimated_performance["top_holdings"] = [
            format_holding(h) for h in top_holdings
        ]
        estimated_performance["worst_holdings"] = [
            format_holding(h) for h in worst_holdings
        ]

        return estimated_performance

    async def get_dividend_data(self, user_id: UUID, period: str = "1y") -> dict:
        """
        Compute dividend income metrics for the user's default portfolio.

        Returns:
        - total_dividends: actual dividends received in the requested period
        - projected_annual: projected annual income (from holdings' annual_dividend field,
          or annualised from actual 12-month payments as fallback)
        - yield_on_cost: projected_annual / total_cost
        - yield_on_value: projected_annual / total_value
        - dividend_yield: same as yield_on_value (portfolio-level %)
        - payments: list of recent individual dividend payment records
        """
        from .models import Dividend
        from sqlalchemy import and_

        _portfolio_orm = await self.portfolio_repo.get_default_portfolio(user_id)
        portfolio = PortfolioResponse.model_validate(_portfolio_orm) if _portfolio_orm else None
        if not portfolio:
            return {
                "total_dividends": None,
                "dividend_yield": None,
                "projected_annual": None,
                "yield_on_cost": None,
                "yield_on_value": None,
                "payments": [],
            }

        # --- Determine date range ---
        period_map = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "all": 3650}
        days = period_map.get(period, 365)
        period_start = business_today() - timedelta(days=days)
        twelve_months_ago = business_today() - timedelta(days=365)

        # --- Fetch actual dividend records ---
        stmt = (
            select(Dividend)
            .where(
                and_(
                    Dividend.user_id == user_id,
                    Dividend.payment_date >= period_start,
                )
            )
            .order_by(Dividend.payment_date.desc())
        )
        result = await self.session.execute(stmt)
        dividend_records = result.scalars().all()

        total_dividends = sum(
            float(d.net_amount or d.total_amount or 0) for d in dividend_records
        )

        # For annualised fallback: sum last 12 months of actual payments
        ttm_stmt = (
            select(Dividend)
            .where(
                and_(
                    Dividend.user_id == user_id,
                    Dividend.payment_date >= twelve_months_ago,
                )
            )
        )
        ttm_result = await self.session.execute(ttm_stmt)
        ttm_records = ttm_result.scalars().all()
        ttm_income = sum(float(d.net_amount or d.total_amount or 0) for d in ttm_records)

        # --- Projected annual income from holdings ---
        holdings, _ = await self.holding_repo.get_portfolio_holdings(
            portfolio.id, user_id, limit=100
        )
        active = [h for h in holdings if h.is_active]

        projected_from_holdings: Optional[float] = None
        if active:
            income_parts = [
                float(h.annual_dividend) * float(h.quantity)
                for h in active
                if h.annual_dividend is not None and float(h.annual_dividend) > 0
            ]
            if income_parts:
                projected_from_holdings = sum(income_parts)

        projected_annual = projected_from_holdings if projected_from_holdings is not None else (
            ttm_income if ttm_income > 0 else None
        )

        # --- Portfolio totals for yield calculations ---
        total_cost = float(portfolio.total_cost or 0)
        total_value = float(portfolio.total_value or 0)

        yield_on_cost: Optional[float] = None
        yield_on_value: Optional[float] = None
        dividend_yield: Optional[float] = None

        if projected_annual is not None:
            if total_cost > 0:
                yield_on_cost = (projected_annual / total_cost) * 100
            if total_value > 0:
                yield_on_value = (projected_annual / total_value) * 100
                dividend_yield = yield_on_value

        # --- Format recent payment records ---
        payments = [
            {
                "date": d.payment_date.isoformat(),
                "symbol": d.symbol,
                "amount": float(d.net_amount or d.total_amount or 0),
                "currency": d.currency,
                "shares": float(d.shares_owned),
                "per_share": float(d.amount_per_share),
            }
            for d in dividend_records[:20]
        ]

        return {
            "total_dividends": round(total_dividends, 2) if total_dividends else None,
            "dividend_yield": round(dividend_yield, 4) if dividend_yield is not None else None,
            "projected_annual": round(projected_annual, 2) if projected_annual is not None else None,
            "yield_on_cost": round(yield_on_cost, 4) if yield_on_cost is not None else None,
            "yield_on_value": round(yield_on_value, 4) if yield_on_value is not None else None,
            "payments": payments,
        }


def _stripped_code_error(idx: int, symbol: str) -> str:
    """The message for a ticker Excel has already eaten the leading zeros off.

    Worth spelling out rather than silently importing: the file looks fine to
    the user — the corruption happened when Excel *opened* the CSV, before they
    touched it — and a holding stored under "50" can never be priced, because no
    such ticker exists.
    """
    return (
        f"Row {idx}: '{symbol}' is not a valid ticker. Taiwan codes are at least "
        f"4 digits (0050, 00713), and Excel drops the leading zeros when it opens "
        f"a CSV. Re-enter it with the column formatted as text, or start from the "
        f"XLSX template."
    )


async def parse_import_file(content: bytes, filename: str) -> dict:
    """
    Parse a portfolio import file (CSV or XLSX) and return structured holding data.

    Supports two CSV/XLSX formats:
      - Trade-log format: Date, Type, StockID, Currency, Shares, Price per shares, Net income
      - Legacy format:    Symbol, Name, Type, Quantity, Average Cost, Currency, Exchange, Purchase Date

    Sell rows (Type == '賣出' or 'sell', case-insensitive) are skipped.
    Returns {"holdings": [...], "errors": [...]}.
    """
    import csv
    import io

    def _parse_date(raw: str) -> Optional[str]:
        """Try YYYY/MM/DD then YYYY-MM-DD. Return ISO string or None."""
        for fmt in ("%Y/%m/%d", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw.strip(), fmt).date().isoformat()
            except ValueError:
                continue
        return None

    def _parse_rows(rows: list[dict]) -> dict:
        """
        rows: list of dicts keyed by header name (already stripped of whitespace).
        Returns {"holdings": [...], "errors": [...]}.
        """
        holdings: list[dict] = []
        errors: list[str] = []

        # Detect format from header keys present in first row
        if not rows:
            return {"holdings": [], "errors": []}

        sample_keys = {k.strip() for k in rows[0].keys()}
        is_trade_log = "StockID" in sample_keys or "Shares" in sample_keys

        for idx, raw_row in enumerate(rows, start=2):  # row 1 = header
            row = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in raw_row.items()}

            if is_trade_log:
                # ── Trade-log format ──────────────────────────────────────────
                row_type = str(row.get("Type") or "").strip()
                if row_type.lower() in ("賣出", "sell"):
                    continue

                symbol = str(row.get("StockID") or "").strip()
                if not symbol:
                    errors.append(f"Row {idx}: StockID is required")
                    continue
                if looks_like_stripped_tw_code(symbol):
                    errors.append(_stripped_code_error(idx, symbol))
                    continue

                currency = str(row.get("Currency") or "").strip()
                if not currency:
                    errors.append(f"Row {idx}: Currency is required")
                    continue

                try:
                    quantity = float(row.get("Shares") or 0)
                except (ValueError, TypeError):
                    errors.append(f"Row {idx}: Shares must be a number")
                    continue
                if quantity <= 0:
                    errors.append(f"Row {idx}: Shares must be positive")
                    continue

                try:
                    avg_cost = float(row.get("Price per shares") or 0)
                except (ValueError, TypeError):
                    errors.append(f"Row {idx}: Price per shares must be a number")
                    continue
                if avg_cost <= 0:
                    errors.append(f"Row {idx}: Price per shares must be positive")
                    continue

                date_raw = str(row.get("Date") or "").strip()
                purchase_date: Optional[str] = None
                if date_raw:
                    purchase_date = _parse_date(date_raw)
                    if purchase_date is None:
                        errors.append(f"Row {idx}: Invalid date '{date_raw}' (expected YYYY/MM/DD or YYYY-MM-DD)")

                exchange = "TWSE" if currency.upper() == "TWD" else "US"

                holdings.append({
                    "symbol": canonical_symbol(symbol),
                    "name": symbol.upper(),
                    "type": "stock",
                    "currency": currency.upper(),
                    "exchange": exchange,
                    "quantity": quantity,
                    "averageCost": avg_cost,
                    "purchaseDate": purchase_date,
                })

            else:
                # ── Legacy format ─────────────────────────────────────────────
                row_type = str(row.get("Type") or "").strip()
                if row_type.lower() in ("賣出", "sell"):
                    continue

                symbol = str(row.get("Symbol") or "").strip()
                if not symbol:
                    errors.append(f"Row {idx}: Symbol is required")
                    continue
                if looks_like_stripped_tw_code(symbol):
                    errors.append(_stripped_code_error(idx, symbol))
                    continue

                currency = str(row.get("Currency") or "").strip()
                if not currency:
                    errors.append(f"Row {idx}: Currency is required")
                    continue

                try:
                    quantity = float(row.get("Quantity") or 0)
                except (ValueError, TypeError):
                    errors.append(f"Row {idx}: Quantity must be a number")
                    continue
                if quantity <= 0:
                    errors.append(f"Row {idx}: Quantity must be positive")
                    continue

                try:
                    avg_cost = float(row.get("Average Cost") or 0)
                except (ValueError, TypeError):
                    errors.append(f"Row {idx}: Average Cost must be a number")
                    continue
                if avg_cost <= 0:
                    errors.append(f"Row {idx}: Average Cost must be positive")
                    continue

                name = str(row.get("Name") or symbol).strip() or symbol
                exchange = str(row.get("Exchange") or "").strip()
                if not exchange:
                    exchange = "TWSE" if currency.upper() == "TWD" else "US"
                asset_type = str(row.get("Type") or "stock").strip().lower() or "stock"

                date_raw = str(row.get("Purchase Date") or "").strip()
                purchase_date = None
                if date_raw:
                    purchase_date = _parse_date(date_raw)
                    if purchase_date is None:
                        errors.append(f"Row {idx}: Invalid date '{date_raw}' (expected YYYY/MM/DD or YYYY-MM-DD)")

                holdings.append({
                    "symbol": canonical_symbol(symbol),
                    "name": name,
                    "type": asset_type,
                    "currency": currency.upper(),
                    "exchange": exchange,
                    "quantity": quantity,
                    "averageCost": avg_cost,
                    "purchaseDate": purchase_date,
                })

        return {"holdings": holdings, "errors": errors}

    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()

    def _run_csv() -> dict:
        text = content.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        return _parse_rows(rows)

    def _cell_to_str(value) -> str:
        if value is None:
            return ""
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)

    def _run_xlsx() -> dict:
        from openpyxl import load_workbook
        from io import BytesIO

        wb = load_workbook(BytesIO(content), data_only=True, read_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        wb.close()

        if not all_rows:
            return {"holdings": [], "errors": []}

        headers = [str(c).strip() if c is not None else "" for c in all_rows[0]]
        dicts = []
        for row_vals in all_rows[1:]:
            row_dict = {headers[i]: (row_vals[i] if i < len(row_vals) else None)
                        for i in range(len(headers))}
            # Skip completely empty rows
            if all(v is None or str(v).strip() == "" for v in row_dict.values()):
                continue
            # Coerce non-string cells to string for uniform handling. Integral
            # floats print as "50.0" — on a ticker column that is a second layer
            # of the same corruption the leading-zero check reports, so drop the
            # empty decimal part before anything reads the value.
            str_row = {k: _cell_to_str(v) for k, v in row_dict.items()}
            dicts.append(str_row)
        return _parse_rows(dicts)

    try:
        if ext == "csv":
            result = await asyncio.to_thread(_run_csv)
        elif ext in ("xlsx", "xls"):
            result = await asyncio.to_thread(_run_xlsx)
        else:
            return {"holdings": [], "errors": [f"Unsupported file type: .{ext}"]}
    except Exception as exc:
        logger.error(f"parse_import_file failed: {exc}", exc_info=True)
        return {"holdings": [], "errors": [f"Failed to parse file: {exc}"]}

    return result


def build_import_template_xlsx() -> bytes:
    """Build the blank import template as XLSX (not CSV).

    Why XLSX and not CSV: Excel coerces the ``StockID`` column of a CSV to a
    number on *open*, silently dropping leading zeros (``0050`` → ``50``,
    ``006208`` → ``6208``). Taiwan ETF tickers all start with leading zeros, so a
    CSV template is corrupted before the user even edits it. Forcing the column
    to text format (``@``) here makes Excel keep tickers as-typed, matching
    :meth:`PortfolioService.export_portfolio_xlsx` so a re-imported file round-trips.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from io import BytesIO

    wb = Workbook()
    ws = wb.active
    ws.title = "Portfolio"

    headers = ["Date", "Type", "StockID", "Currency", "Shares", "Price per shares", "Net income"]
    header_fill = PatternFill(start_color="1E3A5F", end_color="1E3A5F", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")

    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    num_fmt_2dp = '#,##0.000000'
    num_fmt_net = '#,##0.00'

    # Sample rows — deliberately lead with leading-zero TW tickers to prove they survive.
    sample_rows = [
        ("2025/01/15", "買入", "0050", "TWD", 1000.0, 61.5),
        ("2025/02/20", "買入", "006208", "TWD", 500.0, 95.2),
        ("2025/03/10", "買入", "VT", "USD", 100.0, 114.25),
        ("2025/03/10", "買入", "BTC-USD", "USD", 0.5, 45000.0),
    ]

    for row_idx, (date_str, row_type, symbol, currency, shares, price) in enumerate(sample_rows, 2):
        net = -(shares * price)
        row_data = [
            (date_str,         "left",   "@"),           # Date as text
            (row_type,         "center", "@"),           # Type as text
            (symbol,           "center", "@"),           # StockID forced text (@) — preserves 0050
            (currency,         "center", "@"),           # Currency as text
            (shares,           "right",  num_fmt_2dp),   # Shares as number
            (round(price, 6),  "right",  num_fmt_2dp),   # Price as number
            (round(net, 2),    "right",  num_fmt_net),   # Net income as number
        ]
        for col_idx, (value, align, fmt) in enumerate(row_data, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.alignment = Alignment(horizontal=align, vertical="center")
            cell.number_format = fmt

    # Keep the StockID column text-formatted for the blank rows users add below,
    # so newly typed tickers (e.g. 0056) are not coerced to numbers either.
    stockid_col = get_column_letter(3)
    for blank_row in range(len(sample_rows) + 2, len(sample_rows) + 52):
        ws.cell(row=blank_row, column=3).number_format = "@"
    ws.column_dimensions[stockid_col].width = 12

    col_widths = [12, 8, 12, 10, 14, 18, 16]
    for col_idx, width in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.freeze_panes = "A2"

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


# Service factory functions for dependency injection
def get_portfolio_service(session: AsyncSession) -> PortfolioService:
    """Get Portfolio service instance"""
    return PortfolioService(session)


def get_transaction_service(session: AsyncSession) -> TransactionService:
    """Get Transaction service instance"""
    return TransactionService(session)


def get_market_data_service(session: AsyncSession) -> MarketDataService:
    """Get MarketData service instance"""
    return MarketDataService(session)


