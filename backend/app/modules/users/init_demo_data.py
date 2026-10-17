"""
Demo user initial data seeder.

Creates a realistic portfolio and 4-month transaction history for the demo
account (demo@aspiro.dev) so authenticated demo sessions have meaningful data.

Idempotent — skips all seeding if a portfolio named "Demo Portfolio" already
exists for the demo user.
"""

import logging
import uuid
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.init_demo_user import DEMO_EMAIL

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _d(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 0, 0, 0, tzinfo=timezone.utc)


def _date(year: int, month: int, day: int) -> date:
    return date(year, month, day)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def init_demo_data(session: AsyncSession) -> None:
    """Seed portfolio + transactions for the demo user. Safe to call every startup."""
    from app.modules.users.models import User
    from app.modules.portfolio.models import Portfolio

    # Resolve demo user ID
    result = await session.execute(select(User).where(User.email == DEMO_EMAIL))
    user: User | None = result.scalar_one_or_none()
    if user is None:
        logger.warning("Demo user not found; skipping demo data seed")
        return

    # Guard: skip entirely if portfolio already exists
    existing = await session.execute(
        select(Portfolio).where(
            and_(Portfolio.user_id == user.id, Portfolio.name == "Demo Portfolio")
        )
    )
    if existing.scalar_one_or_none() is not None:
        logger.info("Demo data already seeded; skipping")
        return

    await _seed_portfolio(session, user.id)
    await _seed_transactions(session, user.id)
    logger.info("Demo data seeded for %s", DEMO_EMAIL)


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------

async def _seed_portfolio(session: AsyncSession, user_id: uuid.UUID) -> None:
    from app.modules.portfolio.models import Portfolio, PortfolioHolding, HoldingWalletType

    portfolio_id = uuid.uuid4()
    portfolio = Portfolio(
        id=portfolio_id,
        user_id=user_id,
        name="Demo Portfolio",
        description="Sample investment portfolio",
        currency="USD",
        is_default=True,
        is_active=True,
        auto_update=True,
        total_value=Decimal("98540.00"),
        total_cost=Decimal("82000.00"),
        total_gain_loss=Decimal("16540.00"),
        total_gain_loss_percentage=Decimal("20.1707"),
        item_metadata={},
    )
    session.add(portfolio)
    await session.flush()

    holdings = [
        # US stocks
        PortfolioHolding(
            id=uuid.uuid4(),
            portfolio_id=portfolio_id,
            user_id=user_id,
            wallet_type=HoldingWalletType.PORTFOLIO,
            symbol="AAPL",
            name="Apple Inc.",
            type="stock",
            exchange="NASDAQ",
            currency="USD",
            market="US",
            sector="Technology",
            quantity=Decimal("10"),
            average_cost=Decimal("165.00"),
            current_price=Decimal("189.50"),
            total_cost=Decimal("1650.00"),
            total_value=Decimal("1895.00"),
            gain_loss=Decimal("245.00"),
            gain_loss_percentage=Decimal("14.8485"),
            dividend_yield=Decimal("0.55"),
            annual_dividend=Decimal("10.42"),
            is_active=True,
            purchase_date=_d(2025, 8, 15),
            item_metadata={},
        ),
        PortfolioHolding(
            id=uuid.uuid4(),
            portfolio_id=portfolio_id,
            user_id=user_id,
            wallet_type=HoldingWalletType.PORTFOLIO,
            symbol="VOO",
            name="Vanguard S&P 500 ETF",
            type="etf",
            exchange="NYSE",
            currency="USD",
            market="US",
            sector="Diversified",
            quantity=Decimal("5"),
            average_cost=Decimal("440.00"),
            current_price=Decimal("510.00"),
            total_cost=Decimal("2200.00"),
            total_value=Decimal("2550.00"),
            gain_loss=Decimal("350.00"),
            gain_loss_percentage=Decimal("15.9091"),
            dividend_yield=Decimal("1.30"),
            annual_dividend=Decimal("26.78"),
            is_active=True,
            purchase_date=_d(2025, 3, 10),
            item_metadata={},
        ),
        # Taiwan stock (TSMC)
        PortfolioHolding(
            id=uuid.uuid4(),
            portfolio_id=portfolio_id,
            user_id=user_id,
            wallet_type=HoldingWalletType.PORTFOLIO,
            symbol="2330",
            name="台積電 (TSMC)",
            type="stock",
            exchange="TWSE",
            currency="TWD",
            market="TW",
            sector="Semiconductors",
            quantity=Decimal("100"),
            average_cost=Decimal("680.00"),
            current_price=Decimal("920.00"),
            total_cost=Decimal("68000.00"),
            total_value=Decimal("92000.00"),
            gain_loss=Decimal("24000.00"),
            gain_loss_percentage=Decimal("35.2941"),
            dividend_yield=Decimal("1.80"),
            annual_dividend=Decimal("1656.00"),
            is_active=True,
            purchase_date=_d(2024, 11, 20),
            item_metadata={},
        ),
        # Crypto
        PortfolioHolding(
            id=uuid.uuid4(),
            portfolio_id=portfolio_id,
            user_id=user_id,
            wallet_type=HoldingWalletType.PORTFOLIO,
            # "BTC" alone is a US-listed ETF ticker (Grayscale Bitcoin Mini
            # Trust, ~$28) — seeding it here priced the demo's Bitcoin off that
            # security's history. The pair form is what the quote feed knows.
            symbol="BTC-USD",
            name="Bitcoin",
            type="crypto",
            exchange="CRYPTO",
            currency="USD",
            market="CRYPTO",
            sector="Cryptocurrency",
            quantity=Decimal("0.05"),
            average_cost=Decimal("52000.00"),
            current_price=Decimal("68000.00"),
            total_cost=Decimal("2600.00"),
            total_value=Decimal("3400.00"),
            gain_loss=Decimal("800.00"),
            gain_loss_percentage=Decimal("30.7692"),
            is_active=True,
            purchase_date=_d(2025, 1, 8),
            item_metadata={},
        ),
        # Emergency fund (cash-like)
        PortfolioHolding(
            id=uuid.uuid4(),
            portfolio_id=portfolio_id,
            user_id=user_id,
            wallet_type=HoldingWalletType.EMERGENCY,
            symbol="CASH-TWD",
            name="Emergency Fund (TWD)",
            type="cash",
            exchange="N/A",
            currency="TWD",
            market="TW",
            sector="Cash",
            quantity=Decimal("180000"),
            average_cost=Decimal("1.00"),
            current_price=Decimal("1.00"),
            total_cost=Decimal("180000.00"),
            total_value=Decimal("180000.00"),
            gain_loss=Decimal("0.00"),
            gain_loss_percentage=Decimal("0.00"),
            is_active=True,
            purchase_date=_d(2024, 6, 1),
            item_metadata={},
        ),
    ]

    for h in holdings:
        session.add(h)

    await session.commit()
    logger.info("Demo portfolio seeded: %d holdings", len(holdings))


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------

async def _seed_transactions(session: AsyncSession, user_id: uuid.UUID) -> None:
    from app.modules.transactions.models import (
        Transaction, TransactionType, TransactionWalletType,
        TransactionStatus, PaymentMethod, TransactionCategory,
    )

    # Resolve category IDs by name (categories are seeded at startup)
    cat_result = await session.execute(select(TransactionCategory))
    all_cats = cat_result.scalars().all()
    cat_map: dict[str, uuid.UUID] = {c.name: c.id for c in all_cats}

    def cat(name: str) -> uuid.UUID:
        """Return category ID, falling back to first available if not found."""
        if name in cat_map:
            return cat_map[name]
        # Fallback: find any category of matching type
        for c in all_cats:
            if name.lower() in c.name.lower():
                return c.id
        return next(iter(cat_map.values()))

    EXPENSE = TransactionType.EXPENSE
    INCOME = TransactionType.INCOME
    LIFE = TransactionWalletType.LIFE
    DONE = TransactionStatus.COMPLETED
    CARD = PaymentMethod.CREDIT_CARD
    CASH = PaymentMethod.CASH
    LINE = PaymentMethod.LINE_PAY

    rows: list[tuple] = [
        # (type, wallet, amount, currency, description, date, category_name, payment_method, merchant)
        # --- February 2026 ---
        (INCOME, LIFE, "85000", "TWD", "February salary", _date(2026, 2, 5),  "Salary",           None,  None),
        (EXPENSE, LIFE, "320",   "TWD", "MRT monthly pass",_date(2026, 2, 6),  "Public Transport", CARD,  "台北捷運"),
        (EXPENSE, LIFE, "1850",  "TWD", "Grocery run",      _date(2026, 2, 7),  "Groceries",        CARD,  "全聯福利中心"),
        (EXPENSE, LIFE, "480",   "TWD", "Lunch with team",  _date(2026, 2, 10), "Restaurants",      LINE,  "鼎泰豐"),
        (EXPENSE, LIFE, "2200",  "TWD", "Electricity bill", _date(2026, 2, 12), "Utilities",        CARD,  "台灣電力"),
        (EXPENSE, LIFE, "980",   "TWD", "Mobile plan",      _date(2026, 2, 12), "Utilities",        CARD,  "遠傳電信"),
        (EXPENSE, LIFE, "3500",  "TWD", "Winter jacket",    _date(2026, 2, 14), "Clothing",         CARD,  "Uniqlo"),
        (EXPENSE, LIFE, "260",   "TWD", "Coffee x5",        _date(2026, 2, 18), "Coffee & Tea",     CASH,  "路易莎咖啡"),
        (EXPENSE, LIFE, "1200",  "TWD", "Movie & dinner",   _date(2026, 2, 20), "Entertainment",    CARD,  "Cinemark"),
        (EXPENSE, LIFE, "680",   "TWD", "Food delivery",    _date(2026, 2, 23), "Food Delivery",    LINE,  "Uber Eats"),
        (EXPENSE, LIFE, "18000", "TWD", "Rent",             _date(2026, 2, 25), "Housing",          CARD,  "房東"),
        (EXPENSE, LIFE, "560",   "TWD", "Parking fees",     _date(2026, 2, 28), "Parking",          CASH,  "停車場"),

        # --- March 2026 ---
        (INCOME, LIFE, "85000", "TWD", "March salary",     _date(2026, 3, 5),  "Salary",           None,  None),
        (INCOME, LIFE, "12000", "TWD", "Freelance project",_date(2026, 3, 8),  "Freelancing",      None,  None),
        (EXPENSE, LIFE, "320",   "TWD", "MRT monthly pass", _date(2026, 3, 6),  "Public Transport", CARD,  "台北捷運"),
        (EXPENSE, LIFE, "2100",  "TWD", "Grocery run",      _date(2026, 3, 9),  "Groceries",        CARD,  "家樂福"),
        (EXPENSE, LIFE, "880",   "TWD", "Doctor visit",     _date(2026, 3, 11), "Healthcare",       CARD,  "台大醫院"),
        (EXPENSE, LIFE, "1800",  "TWD", "Online course",    _date(2026, 3, 13), "Education",        CARD,  "Udemy"),
        (EXPENSE, LIFE, "420",   "TWD", "Restaurants",      _date(2026, 3, 15), "Restaurants",      LINE,  "牛角燒肉"),
        (EXPENSE, LIFE, "2200",  "TWD", "Electricity bill", _date(2026, 3, 16), "Utilities",        CARD,  "台灣電力"),
        (EXPENSE, LIFE, "980",   "TWD", "Mobile plan",      _date(2026, 3, 16), "Utilities",        CARD,  "遠傳電信"),
        (EXPENSE, LIFE, "4200",  "TWD", "New headphones",   _date(2026, 3, 18), "Electronics",      CARD,  "Apple Store"),
        (EXPENSE, LIFE, "560",   "TWD", "Coffee x10",       _date(2026, 3, 20), "Coffee & Tea",     CASH,  "星巴克"),
        (EXPENSE, LIFE, "720",   "TWD", "Food delivery",    _date(2026, 3, 22), "Food Delivery",    LINE,  "foodpanda"),
        (EXPENSE, LIFE, "18000", "TWD", "Rent",             _date(2026, 3, 25), "Housing",          CARD,  "房東"),
        (EXPENSE, LIFE, "3800",  "TWD", "Weekend trip fuel",_date(2026, 3, 29), "Fuel",             CASH,  "中油"),

        # --- April 2026 ---
        (INCOME, LIFE, "85000", "TWD", "April salary",     _date(2026, 4, 5),  "Salary",           None,  None),
        (EXPENSE, LIFE, "320",   "TWD", "MRT monthly pass", _date(2026, 4, 6),  "Public Transport", CARD,  "台北捷運"),
        (EXPENSE, LIFE, "1950",  "TWD", "Grocery run",      _date(2026, 4, 8),  "Groceries",        CARD,  "全聯福利中心"),
        (EXPENSE, LIFE, "580",   "TWD", "Lunch",            _date(2026, 4, 10), "Restaurants",      CASH,  "鬍鬚張"),
        (EXPENSE, LIFE, "2200",  "TWD", "Electricity bill", _date(2026, 4, 12), "Utilities",        CARD,  "台灣電力"),
        (EXPENSE, LIFE, "980",   "TWD", "Mobile plan",      _date(2026, 4, 12), "Utilities",        CARD,  "遠傳電信"),
        (EXPENSE, LIFE, "6500",  "TWD", "Japan trip deposit",_date(2026,4, 14), "Entertainment",    CARD,  "KKday"),
        (EXPENSE, LIFE, "1200",  "TWD", "Personal care",    _date(2026, 4, 16), "Personal Care",    CARD,  "屈臣氏"),
        (EXPENSE, LIFE, "340",   "TWD", "Coffee x6",        _date(2026, 4, 18), "Coffee & Tea",     CASH,  "路易莎咖啡"),
        (EXPENSE, LIFE, "800",   "TWD", "Food delivery",    _date(2026, 4, 21), "Food Delivery",    LINE,  "Uber Eats"),
        (EXPENSE, LIFE, "18000", "TWD", "Rent",             _date(2026, 4, 25), "Housing",          CARD,  "房東"),
        (INCOME, LIFE, "4500",   "TWD", "Dividend income",  _date(2026, 4, 28), "Investment Returns", None, None),

        # --- May 2026 ---
        (INCOME, LIFE, "85000", "TWD", "May salary",       _date(2026, 5, 5),  "Salary",           None,  None),
        (EXPENSE, LIFE, "320",   "TWD", "MRT monthly pass", _date(2026, 5, 6),  "Public Transport", CARD,  "台北捷運"),
        (EXPENSE, LIFE, "2050",  "TWD", "Grocery run",      _date(2026, 5, 7),  "Groceries",        CARD,  "家樂福"),
        (EXPENSE, LIFE, "750",   "TWD", "Hot pot dinner",   _date(2026, 5, 9),  "Restaurants",      LINE,  "海底撈"),
        (EXPENSE, LIFE, "2200",  "TWD", "Electricity bill", _date(2026, 5, 11), "Utilities",        CARD,  "台灣電力"),
        (EXPENSE, LIFE, "980",   "TWD", "Mobile plan",      _date(2026, 5, 11), "Utilities",        CARD,  "遠傳電信"),
        (EXPENSE, LIFE, "480",   "TWD", "Coffee x8",        _date(2026, 5, 13), "Coffee & Tea",     CASH,  "星巴克"),
        (EXPENSE, LIFE, "1100",  "TWD", "Skincare products",_date(2026, 5, 15), "Personal Care",    CARD,  "城市美集"),
        (EXPENSE, LIFE, "920",   "TWD", "Food delivery",    _date(2026, 5, 18), "Food Delivery",    LINE,  "foodpanda"),
        (EXPENSE, LIFE, "18000", "TWD", "Rent",             _date(2026, 5, 22), "Housing",          CARD,  "房東"),
        (EXPENSE, LIFE, "2800",  "TWD", "Clothing haul",    _date(2026, 5, 23), "Clothing",         CARD,  "ZARA"),
    ]

    txns = []
    for row in rows:
        typ, wallet, amount, currency, desc, txn_date, cat_name, pay_method, merchant = row
        txn = Transaction(
            id=uuid.uuid4(),
            user_id=user_id,
            type=typ,
            wallet_type=wallet,
            amount=Decimal(amount),
            currency=currency,
            description=desc,
            transaction_date=txn_date,
            category_id=cat(cat_name),
            payment_method=pay_method,
            merchant_name=merchant,
            status=DONE,
            is_deleted=False,
            auto_categorized=False,
            reviewed_by_user=True,
        )
        txns.append(txn)
        session.add(txn)

    await session.commit()
    logger.info("Demo transactions seeded: %d records", len(txns))
