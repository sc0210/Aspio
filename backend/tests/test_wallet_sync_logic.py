"""
Unit tests for PortfolioService._sync_wallet_transaction and the sync_amount
calculation in add_holding.

Wallet bridge rules (current behaviour):
─────────────────────────────────────────────────────────────────────────────
 Asset type   │ wallet_type              │ Fires? │ Wallet  │ Direction
─────────────────────────────────────────────────────────────────────────────
 cash         │ emergency                │ YES    │ LIFE    │ deposit→EXPENSE
              │                          │        │         │ withdraw→INCOME
 cash         │ portfolio                │ NO     │ —       │ —
 cash         │ None (defaults to port.) │ NO     │ —       │ —
 stock/etf/   │ portfolio                │ YES    │ LIFE    │ EXPENSE
 crypto/bond  │                          │        │         │ (Investment Purchase)
 stock/etf/…  │ emergency                │ NO     │ —       │ —
 unknown type │ any                      │ NO     │ —       │ —
─────────────────────────────────────────────────────────────────────────────

sync_amount passed to _sync_wallet_transaction:
  cash     → abs(quantity)
  non-cash → abs(quantity × average_cost)
"""

import pytest
import pytest_asyncio
from datetime import datetime, timezone, date, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


# Suppress background price-fetch tasks that would try to call the real
# MarketDataService.get_current_price during unit tests.
@pytest.fixture(autouse=True)
def _mock_run_in_background():
    with patch("app.core.background_tasks.run_in_background", new_callable=AsyncMock):
        yield


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_service():
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    with (
        patch("app.modules.portfolio.services.PortfolioRepository"),
        patch("app.modules.portfolio.services.HoldingRepository"),
        patch("app.modules.portfolio.services.TransactionRepository"),
        patch("app.modules.portfolio.services.MarketDataRepository"),
        patch("app.modules.portfolio.services.CurrencyRepository"),
    ):
        from app.modules.portfolio.services import PortfolioService
        svc = PortfolioService(session)

    svc.portfolio_repo   = MagicMock()
    svc.holding_repo     = MagicMock()
    svc.transaction_repo = MagicMock()
    svc.market_data_repo = MagicMock()
    svc.currency_repo    = MagicMock()
    svc.session = session
    return svc


def _holding(
    asset_type="stock",
    wallet_type="portfolio",
    quantity=Decimal("10"),
    average_cost=Decimal("150.00"),
    symbol="AAPL",
    name="Apple Inc",
    currency="TWD",
    notes=None,
    purchase_date=None,
):
    h = MagicMock()
    h.type         = asset_type
    h.wallet_type  = wallet_type
    h.quantity     = quantity
    h.average_cost = average_cost
    h.symbol       = symbol
    h.name         = name
    h.currency     = currency
    h.notes        = notes
    h.purchase_date = purchase_date or datetime.now(timezone.utc)
    return h


def _repos(category_name="Transfer", category_exists=True):
    """Return (tx_repo_cls, cat_repo_cls, tx_repo, cat_repo, category)."""
    cat = MagicMock()
    cat.id   = uuid4()
    cat.name = category_name

    tx_repo  = MagicMock()
    tx_repo.create_flush = AsyncMock(return_value=MagicMock(id=uuid4()))

    cat_repo = MagicMock()
    cat_repo.get_by_name = AsyncMock(return_value=cat if category_exists else None)
    cat_repo.create_flush      = AsyncMock(return_value=cat)

    return MagicMock(return_value=tx_repo), MagicMock(return_value=cat_repo), tx_repo, cat_repo, cat


def _patch_repos(tx_cls, cat_cls):
    return (
        patch("app.modules.transactions.repositories.TransactionRepository", tx_cls),
        patch("app.modules.transactions.repositories.TransactionCategoryRepository", cat_cls),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. Non-cash in portfolio → EXPENSE in Life Wallet
# ─────────────────────────────────────────────────────────────────────────────

class TestNonCashAssetBuyCreatesLifeWalletExpense:
    """
    Buying stock / ETF / crypto / bond via the Portfolio page should record
    an EXPENSE in the Life Wallet (cash leaving daily funds to buy assets).
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("asset_type", ["stock", "etf", "crypto", "bond"])
    async def test_buy_creates_expense_in_life_wallet(self, asset_type):
        from app.modules.transactions.models import TransactionType, TransactionWalletType

        svc = _make_service()
        h   = _holding(asset_type=asset_type, wallet_type="portfolio",
                       quantity=Decimal("100"), average_cost=Decimal("208.95"),
                       symbol="006208", currency="TWD")

        tx_cls, cat_cls, tx_repo, cat_repo, _ = _repos("Investment Purchase")

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("20895.00"),
                transaction_date=datetime.now(timezone.utc),
            )

        tx_repo.create_flush.assert_awaited_once()
        data = tx_repo.create_flush.call_args[0][0]
        assert data["type"]        == TransactionType.EXPENSE
        assert data["wallet_type"] == TransactionWalletType.LIFE
        assert data["amount"]      == Decimal("20895.00")
        assert data["currency"]    == "TWD"

    @pytest.fixture(autouse=True)
    def _pin_the_business_timezone(self, monkeypatch):
        """APP_TIMEZONE is env-settable, and these expectations are Taipei's.

        get_settings is lru_cached, so the env alone would not take effect.
        """
        from app.core.config import get_settings

        monkeypatch.setenv("APP_TIMEZONE", "Asia/Taipei")
        get_settings.cache_clear()
        yield
        get_settings.cache_clear()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "stamp,expected_day",
        [
            # 20:00 UTC on the 31st is 04:00 on the 1st in Taipei. Booking the Life
            # Wallet expense on the 31st puts it in the PREVIOUS month's spending.
            (datetime(2026, 8, 31, 20, 0, tzinfo=timezone.utc), date(2026, 9, 1)),
            # Just before the line, both agree.
            (datetime(2026, 8, 31, 15, 0, tzinfo=timezone.utc), date(2026, 8, 31)),
            # An offset other than UTC, chosen so face value and the business day
            # DISAGREE — 23:00 on the 31st at UTC-5 is 12:00 on the 1st in Taipei.
            # The previous version used 03:00-05:00 on the 1st, where both answers
            # are the 1st, so it discriminated nothing.
            (
                datetime(2026, 8, 31, 23, 0, tzinfo=timezone(timedelta(hours=-5))),
                date(2026, 9, 1),
            ),
        ],
    )
    async def test_the_wallet_leg_is_dated_by_the_business_day(
        self, stamp, expected_day
    ):
        """`.date()` on an aware value reads the day in whatever offset it carries."""
        svc = _make_service()
        h = _holding(wallet_type="portfolio", quantity=Decimal("1"),
                     average_cost=Decimal("100"), symbol="0050", currency="TWD")

        tx_cls, cat_cls, tx_repo, cat_repo, _ = _repos("Investment Purchase")
        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("100.00"),
                transaction_date=stamp,
            )

        data = tx_repo.create_flush.call_args[0][0]
        assert data["transaction_date"] == expected_day

    @pytest.mark.asyncio
    async def test_a_naive_stamp_is_left_alone(self):
        """It was never in another timezone, so there is nothing to convert."""
        svc = _make_service()
        h = _holding(wallet_type="portfolio", quantity=Decimal("1"),
                     average_cost=Decimal("100"), symbol="0050", currency="TWD")

        tx_cls, cat_cls, tx_repo, cat_repo, _ = _repos("Investment Purchase")
        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("100.00"),
                transaction_date=datetime(2026, 8, 31, 20, 0),
            )

        assert tx_repo.create_flush.call_args[0][0]["transaction_date"] == date(2026, 8, 31)

    @pytest.mark.asyncio
    async def test_description_contains_symbol_qty_and_price(self):
        svc = _make_service()
        h   = _holding(asset_type="etf", wallet_type="portfolio",
                       quantity=Decimal("100"), average_cost=Decimal("208.95"),
                       symbol="006208")

        tx_cls, cat_cls, tx_repo, *_ = _repos("Investment Purchase")

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("20895.00"),
                transaction_date=datetime.now(timezone.utc),
            )

        desc = tx_repo.create_flush.call_args[0][0]["description"]
        assert "006208" in desc
        assert "100"    in desc
        assert "208.95" in desc

    @pytest.mark.asyncio
    async def test_uses_investment_purchase_category(self):
        svc = _make_service()
        h   = _holding(asset_type="stock", wallet_type="portfolio")

        tx_cls, cat_cls, tx_repo, cat_repo, _ = _repos("Investment Purchase")

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("1500.00"),
                transaction_date=datetime.now(timezone.utc),
            )

        # Category was looked up by name only (no user_id prefix)
        cat_repo.get_by_name.assert_awaited_once()
        assert cat_repo.get_by_name.call_args[0][0] == "Investment Purchase"

    @pytest.mark.asyncio
    async def test_creates_investment_purchase_category_when_missing(self):
        svc = _make_service()
        h   = _holding(asset_type="stock", wallet_type="portfolio")

        tx_cls, cat_cls, tx_repo, cat_repo, _ = _repos(category_exists=False)

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("500.00"),
                transaction_date=datetime.now(timezone.utc),
            )

        cat_repo.create_flush.assert_awaited_once()
        created = cat_repo.create_flush.call_args[0][0]
        assert created["name"] == "Investment Purchase"
        tx_repo.create_flush.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_transaction_date_matches_purchase_date(self):
        svc = _make_service()
        purchase_date = datetime(2025, 3, 15, tzinfo=timezone.utc)
        h   = _holding(asset_type="stock", wallet_type="portfolio",
                       purchase_date=purchase_date)

        tx_cls, cat_cls, tx_repo, *_ = _repos("Investment Purchase")

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("1500.00"),
                transaction_date=purchase_date,
            )

        data = tx_repo.create_flush.call_args[0][0]
        assert data["transaction_date"] == date(2025, 3, 15)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Non-cash in non-portfolio wallet → SKIP
# ─────────────────────────────────────────────────────────────────────────────

class TestNonCashInOtherWalletsSkipsSync:
    """
    A stock/ETF placed in the emergency wallet (unusual edge-case)
    should not fire the sync — there is no clear cash source to debit.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("wallet_type", ["emergency"])
    async def test_non_cash_in_non_portfolio_wallet_skips(self, wallet_type):
        svc = _make_service()
        h   = _holding(asset_type="stock", wallet_type=wallet_type)

        tx_cls, cat_cls, tx_repo, *_ = _repos()

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("500.00"),
                transaction_date=datetime.now(timezone.utc),
            )

        tx_repo.create_flush.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 3. Cash in investment / urgent wallet → EXPENSE / INCOME in Life Wallet
# ─────────────────────────────────────────────────────────────────────────────

class TestCashTransferSyncsToLifeWallet:
    """
    Depositing cash to the emergency wallet records an EXPENSE in the
    Life Wallet so the same money is not counted twice.
    Withdrawing records an INCOME.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("wallet_type", ["emergency"])
    async def test_cash_deposit_creates_expense(self, wallet_type):
        from app.modules.transactions.models import TransactionType, TransactionWalletType

        svc = _make_service()
        h   = _holding(asset_type="cash", wallet_type=wallet_type,
                       quantity=Decimal("5000"), currency="TWD")

        tx_cls, cat_cls, tx_repo, *_ = _repos()

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("5000"),
                transaction_date=datetime.now(timezone.utc),
            )

        data = tx_repo.create_flush.call_args[0][0]
        assert data["type"]        == TransactionType.EXPENSE
        assert data["wallet_type"] == TransactionWalletType.LIFE
        assert data["amount"]      == Decimal("5000")
        assert data["currency"]    == "TWD"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("wallet_type", ["emergency"])
    async def test_cash_withdrawal_creates_income(self, wallet_type):
        from app.modules.transactions.models import TransactionType, TransactionWalletType

        svc = _make_service()
        h   = _holding(asset_type="cash", wallet_type=wallet_type,
                       quantity=Decimal("-1000"), currency="TWD")

        tx_cls, cat_cls, tx_repo, *_ = _repos()

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("1000"),
                transaction_date=datetime.now(timezone.utc),
            )

        data = tx_repo.create_flush.call_args[0][0]
        assert data["type"]        == TransactionType.INCOME
        assert data["wallet_type"] == TransactionWalletType.LIFE

    @pytest.mark.asyncio
    async def test_reuses_existing_transfer_category(self):
        svc = _make_service()
        h   = _holding(asset_type="cash", wallet_type="emergency", quantity=Decimal("200"))

        tx_cls, cat_cls, tx_repo, cat_repo, _ = _repos(category_exists=True)

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("200"),
                transaction_date=datetime.now(timezone.utc),
            )

        assert cat_repo.get_by_name.await_count == 1
        assert cat_repo.get_by_name.call_args[0][0] == "Transfer"
        cat_repo.create_flush.assert_not_called()

    @pytest.mark.asyncio
    async def test_creates_transfer_category_when_missing(self):
        svc = _make_service()
        h   = _holding(asset_type="cash", wallet_type="emergency", quantity=Decimal("300"))

        tx_cls, cat_cls, tx_repo, cat_repo, _ = _repos(category_exists=False)

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("300"),
                transaction_date=datetime.now(timezone.utc),
            )

        cat_repo.create_flush.assert_awaited_once()
        tx_repo.create_flush.assert_awaited_once()


# ─────────────────────────────────────────────────────────────────────────────
# 4. Cash in portfolio → SKIP
# ─────────────────────────────────────────────────────────────────────────────

class TestCashInPortfolioPerformanceSkipsSync:

    @pytest.mark.asyncio
    async def test_cash_in_portfolio_skips(self):
        svc = _make_service()
        h   = _holding(asset_type="cash", wallet_type="portfolio")

        tx_cls, cat_cls, tx_repo, *_ = _repos()

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("1000.00"),
                transaction_date=datetime.now(timezone.utc),
            )

        tx_repo.create_flush.assert_not_called()

    @pytest.mark.asyncio
    async def test_cash_with_none_wallet_defaults_to_portfolio_and_skips(self):
        svc = _make_service()
        h   = _holding(asset_type="cash", wallet_type=None)

        tx_cls, cat_cls, tx_repo, *_ = _repos()

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("1000.00"),
                transaction_date=datetime.now(timezone.utc),
            )

        tx_repo.create_flush.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 5. Unknown asset type → SKIP
# ─────────────────────────────────────────────────────────────────────────────

class TestUnknownAssetTypeSkipsSync:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("asset_type", ["reit", "commodity", "option", ""])
    async def test_unknown_type_skips(self, asset_type):
        svc = _make_service()
        h   = _holding(asset_type=asset_type, wallet_type="portfolio")

        tx_cls, cat_cls, tx_repo, *_ = _repos()

        p1, p2 = _patch_repos(tx_cls, cat_cls)
        with p1, p2:
            await svc._sync_wallet_transaction(
                user_id=uuid4(),
                holding_data=h,
                amount=Decimal("500.00"),
                transaction_date=datetime.now(timezone.utc),
            )

        tx_repo.create_flush.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 6. sync_amount calculation in add_holding
# ─────────────────────────────────────────────────────────────────────────────

class TestSyncAmountCalculation:
    """
    The amount passed to _sync_wallet_transaction differs by asset type:
      cash     → abs(quantity)           (quantity IS the cash value)
      non-cash → abs(quantity × avg_cost) (total purchase cost)
    """

    @pytest.mark.asyncio
    async def test_cash_sync_amount_equals_quantity(self):
        svc = _make_service()
        captured: list[Decimal] = []

        original = svc._sync_wallet_transaction

        async def capture(*args, **kwargs):
            captured.append(kwargs.get("amount", args[3] if len(args) > 3 else None))

        svc._sync_wallet_transaction = capture

        portfolio    = MagicMock(); portfolio.id = uuid4()
        mock_holding = MagicMock(); mock_holding.id = uuid4()

        svc.portfolio_repo.get_default_portfolio   = AsyncMock(return_value=portfolio)
        svc.holding_repo.create_or_aggregate_holding = AsyncMock(return_value=mock_holding)
        svc.transaction_repo.create                = AsyncMock(return_value=MagicMock(id=uuid4()))
        svc._update_portfolio_totals               = AsyncMock()

        cash_data = _holding(
            asset_type="cash", wallet_type="emergency",
            quantity=Decimal("5000"), average_cost=Decimal("1"),
            symbol="CASH", name="Cash Deposit",
        )

        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate", return_value=portfolio),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), cash_data)

        assert len(captured) == 1
        assert captured[0] == Decimal("5000")

    @pytest.mark.asyncio
    async def test_non_cash_sync_amount_is_total_cost(self):
        svc = _make_service()
        captured: list[Decimal] = []

        async def capture(*args, **kwargs):
            captured.append(kwargs.get("amount", args[3] if len(args) > 3 else None))

        svc._sync_wallet_transaction = capture

        portfolio    = MagicMock(); portfolio.id = uuid4()
        mock_holding = MagicMock(); mock_holding.id = uuid4()

        svc.portfolio_repo.get_default_portfolio   = AsyncMock(return_value=portfolio)
        svc.holding_repo.create_or_aggregate_holding = AsyncMock(return_value=mock_holding)
        svc.transaction_repo.create                = AsyncMock(return_value=MagicMock(id=uuid4()))
        svc._update_portfolio_totals               = AsyncMock()

        # 100 shares × NT$208.95 = NT$20,895
        etf_data = _holding(
            asset_type="etf", wallet_type="portfolio",
            quantity=Decimal("100"), average_cost=Decimal("208.95"),
            symbol="006208", name="富邦台灣50",
        )

        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate", return_value=portfolio),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), etf_data)

        assert len(captured) == 1
        assert captured[0] == Decimal("20895.00")

    @pytest.mark.asyncio
    async def test_non_cash_sync_amount_is_always_positive(self):
        """Even if quantity is negative (rare edge case), amount is abs."""
        svc = _make_service()
        captured: list[Decimal] = []

        async def capture(*args, **kwargs):
            captured.append(kwargs.get("amount", args[3] if len(args) > 3 else None))

        svc._sync_wallet_transaction = capture

        portfolio    = MagicMock(); portfolio.id = uuid4()
        mock_holding = MagicMock(); mock_holding.id = uuid4()

        svc.portfolio_repo.get_default_portfolio   = AsyncMock(return_value=portfolio)
        svc.holding_repo.create_or_aggregate_holding = AsyncMock(return_value=mock_holding)
        svc.transaction_repo.create                = AsyncMock(return_value=MagicMock(id=uuid4()))
        svc._update_portfolio_totals               = AsyncMock()

        stock_data = _holding(
            asset_type="stock", wallet_type="portfolio",
            quantity=Decimal("-50"), average_cost=Decimal("100.00"),
        )

        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate", return_value=portfolio),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), stock_data)

        assert len(captured) == 1
        assert captured[0] == Decimal("5000.00"), "Amount must be positive (abs)"


# ─────────────────────────────────────────────────────────────────────────────
# 7. Sync failure is isolated — holding creation still succeeds
# ─────────────────────────────────────────────────────────────────────────────

class TestSyncFailurePropagates:
    """A failed wallet sync must fail the buy, not be isolated from it.

    This class previously asserted the opposite — that a sync error "does not
    propagate" — and that expectation was wrong. The bridge is what keeps the
    books balanced: a buy debits the Life Wallet as the counterpart to the asset
    appearing in Portfolio. Swallow the debit and the cash stays in Life *and*
    the asset is counted, which is precisely the double-count the bridge exists
    to prevent (see CLAUDE.md, three-wallet invariants). Net worth is then
    inflated by the purchase amount with nothing but a log line to show it.

    The isolation was illusory besides: the sync shares the caller's session and
    the holding is still uncommitted when it runs, so "keep the holding, drop the
    sync" was never actually on offer — the request either fails or leaves the
    books unbalanced.

    Note these are mock-based, so they only pin control flow (that the error
    reaches the caller). They cannot see the session semantics that made the
    isolation impossible, which is why the DB-level counterpart exists in
    tests/test_wallet_bridge_atomicity.py.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("asset_type,wallet_type", [
        ("stock", "portfolio"),
        ("cash",  "emergency"),
    ])
    async def test_db_error_during_sync_propagates(self, asset_type, wallet_type):
        svc = _make_service()
        h   = _holding(asset_type=asset_type, wallet_type=wallet_type, quantity=Decimal("100"))

        cat_repo     = MagicMock()
        cat_repo.get_by_name = AsyncMock(side_effect=RuntimeError("DB connection lost"))
        cat_repo_cls = MagicMock(return_value=cat_repo)

        tx_repo     = MagicMock()
        tx_repo_cls = MagicMock(return_value=tx_repo)

        p1, p2 = _patch_repos(tx_repo_cls, cat_repo_cls)
        with p1, p2:
            with pytest.raises(RuntimeError, match="DB connection lost"):
                await svc._sync_wallet_transaction(
                    user_id=uuid4(),
                    holding_data=h,
                    amount=Decimal("100"),
                    transaction_date=datetime.now(timezone.utc),
                )

        # It failed before writing anything, which is the point.
        tx_repo.create_flush.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 8. Full add_holding integration assertions
# ─────────────────────────────────────────────────────────────────────────────

class TestAddHoldingWalletBridge:
    """
    End-to-end verification that the correct life-wallet transaction is (or is not)
    created for each holding type when going through the full add_holding path.
    """

    @pytest.mark.asyncio
    async def test_buying_stock_creates_life_wallet_expense(self):
        """
        add_holding(stock, portfolio)
          → 1 portfolio audit transaction (svc.transaction_repo)
          → 1 life-wallet EXPENSE transaction (inner tx repo)
        """
        from app.modules.transactions.models import TransactionType, TransactionWalletType

        svc = _make_service()

        portfolio    = MagicMock(); portfolio.id = uuid4()
        mock_holding = MagicMock(); mock_holding.id = uuid4()

        svc.portfolio_repo.get_default_portfolio   = AsyncMock(return_value=portfolio)
        svc.holding_repo.create_or_aggregate_holding = AsyncMock(return_value=mock_holding)
        svc.transaction_repo.create                = AsyncMock(return_value=MagicMock(id=uuid4()))
        svc._update_portfolio_totals               = AsyncMock()

        stock = _holding(
            asset_type="stock", wallet_type="portfolio",
            quantity=Decimal("100"), average_cost=Decimal("208.95"),
            symbol="006208", name="富邦台灣50", currency="TWD",
        )

        life_tx_repo     = MagicMock()
        life_tx_repo.create_flush = AsyncMock(return_value=MagicMock(id=uuid4()))
        life_tx_repo_cls = MagicMock(return_value=life_tx_repo)

        invest_cat     = MagicMock(); invest_cat.id = uuid4()
        cat_repo     = MagicMock()
        cat_repo.get_by_name = AsyncMock(return_value=invest_cat)
        cat_repo_cls = MagicMock(return_value=cat_repo)

        pr1, pr2 = _patch_repos(life_tx_repo_cls, cat_repo_cls)
        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate", return_value=portfolio),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
            pr1,
            pr2,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), stock)

        # 1 portfolio audit record
        svc.transaction_repo.create.assert_awaited_once()

        # 1 life-wallet EXPENSE record
        life_tx_repo.create_flush.assert_awaited_once()
        data = life_tx_repo.create_flush.call_args[0][0]
        assert data["type"]        == TransactionType.EXPENSE
        assert data["wallet_type"] == TransactionWalletType.LIFE
        assert data["amount"]      == Decimal("20895.00")   # 100 × 208.95
        assert data["currency"]    == "TWD"

    @pytest.mark.asyncio
    async def test_depositing_cash_to_investment_creates_life_wallet_expense(self):
        from app.modules.transactions.models import TransactionType, TransactionWalletType

        svc = _make_service()

        portfolio    = MagicMock(); portfolio.id = uuid4()
        mock_holding = MagicMock(); mock_holding.id = uuid4()

        svc.portfolio_repo.get_default_portfolio   = AsyncMock(return_value=portfolio)
        svc.holding_repo.create_or_aggregate_holding = AsyncMock(return_value=mock_holding)
        svc.transaction_repo.create                = AsyncMock(return_value=MagicMock(id=uuid4()))
        svc._update_portfolio_totals               = AsyncMock()

        cash = _holding(
            asset_type="cash", wallet_type="emergency",
            quantity=Decimal("5000"), average_cost=Decimal("1"),
            symbol="CASH", name="Cash Deposit", currency="TWD",
        )

        life_tx_repo     = MagicMock()
        life_tx_repo.create_flush = AsyncMock(return_value=MagicMock(id=uuid4()))
        life_tx_repo_cls = MagicMock(return_value=life_tx_repo)

        xfer_cat     = MagicMock(); xfer_cat.id = uuid4()
        cat_repo     = MagicMock()
        cat_repo.get_by_name = AsyncMock(return_value=xfer_cat)
        cat_repo_cls = MagicMock(return_value=cat_repo)

        pr1, pr2 = _patch_repos(life_tx_repo_cls, cat_repo_cls)
        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate", return_value=portfolio),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
            pr1,
            pr2,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), cash)

        life_tx_repo.create_flush.assert_awaited_once()
        data = life_tx_repo.create_flush.call_args[0][0]
        assert data["type"]        == TransactionType.EXPENSE
        assert data["wallet_type"] == TransactionWalletType.LIFE
        assert data["amount"]      == Decimal("5000")
        assert data["currency"]    == "TWD"


# ─────────────────────────────────────────────────────────────────────────────
# 9. Investment-form flow: all 4 asset types via add_holding(aggregate=True)
# ─────────────────────────────────────────────────────────────────────────────

def _add_holding_setup(asset_type, wallet_type, qty, price, symbol="TEST", currency="TWD"):
    """Build a ready-to-run service + holding + Life Wallet repo mocks."""
    svc = _make_service()
    portfolio    = MagicMock(); portfolio.id = uuid4()
    mock_holding = MagicMock(); mock_holding.id = uuid4()

    svc.portfolio_repo.get_default_portfolio       = AsyncMock(return_value=portfolio)
    svc.holding_repo.create_or_aggregate_holding   = AsyncMock(return_value=mock_holding)
    svc.transaction_repo.create                    = AsyncMock(return_value=MagicMock(id=uuid4()))
    svc._update_portfolio_totals                   = AsyncMock()

    holding = _holding(
        asset_type=asset_type,
        wallet_type=wallet_type,
        quantity=qty,
        average_cost=price,
        symbol=symbol,
        currency=currency,
    )

    life_tx_repo = MagicMock()
    life_tx_repo.create_flush = AsyncMock(return_value=MagicMock(id=uuid4()))
    life_tx_repo_cls = MagicMock(return_value=life_tx_repo)

    cat = MagicMock(); cat.id = uuid4()
    cat_repo = MagicMock()
    cat_repo.get_by_name = AsyncMock(return_value=cat)
    cat_repo_cls = MagicMock(return_value=cat_repo)

    return svc, holding, life_tx_repo, life_tx_repo_cls, cat_repo_cls


class TestInvestmentFormFlow:
    """
    Simulates the data path when a user submits a Buy transaction from the
    Transactions page investment form:

        portfolioService.addHolding({
            type: 'stock' | 'etf' | 'crypto' | 'bond',
            wallet_type: 'portfolio',
            quantity: qty,
            averageCost: price,
            purchaseDate: <ISO datetime string>,
        }, { aggregate: True })

    Expected: one portfolio holding (created/aggregated) + one Life Wallet
    EXPENSE transaction for qty × price.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("asset_type,symbol,qty,price,expected_total,currency", [
        ("stock",  "006208", Decimal("100"),  Decimal("208.95"),   Decimal("20895.00"), "TWD"),
        ("etf",    "0050",   Decimal("50"),   Decimal("155.00"),   Decimal("7750.00"),  "TWD"),
        ("crypto", "BTC",    Decimal("0.5"),  Decimal("90000.00"), Decimal("45000.00"), "USD"),
        ("bond",   "US10Y",  Decimal("10"),   Decimal("98.50"),    Decimal("985.00"),   "USD"),
    ])
    async def test_all_asset_types_create_life_wallet_expense(
        self, asset_type, symbol, qty, price, expected_total, currency
    ):
        """All 4 form-selectable asset types record a LIFE EXPENSE for qty × price."""
        from app.modules.transactions.models import TransactionType, TransactionWalletType

        svc, holding, life_tx_repo, life_tx_repo_cls, cat_repo_cls = _add_holding_setup(
            asset_type=asset_type, wallet_type="portfolio",
            qty=qty, price=price, symbol=symbol, currency=currency,
        )
        holding.currency = currency

        pr1, pr2 = _patch_repos(life_tx_repo_cls, cat_repo_cls)
        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                  return_value=svc.portfolio_repo.get_default_portfolio.return_value),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
            pr1, pr2,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), holding, aggregate=True)

        life_tx_repo.create_flush.assert_awaited_once()
        data = life_tx_repo.create_flush.call_args[0][0]
        assert data["type"]        == TransactionType.EXPENSE,   f"{asset_type}: expected EXPENSE"
        assert data["wallet_type"] == TransactionWalletType.LIFE, f"{asset_type}: expected LIFE wallet"
        assert data["amount"]      == expected_total,             f"{asset_type}: amount mismatch"
        assert data["currency"]    == currency

    @pytest.mark.asyncio
    async def test_aggregate_true_still_fires_wallet_sync(self):
        """aggregate=True (the form's default) must not suppress the wallet sync."""
        from app.modules.transactions.models import TransactionType

        svc, holding, life_tx_repo, life_tx_repo_cls, cat_repo_cls = _add_holding_setup(
            asset_type="stock", wallet_type="portfolio",
            qty=Decimal("200"), price=Decimal("50.00"), symbol="TSLA",
        )

        pr1, pr2 = _patch_repos(life_tx_repo_cls, cat_repo_cls)
        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                  return_value=svc.portfolio_repo.get_default_portfolio.return_value),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
            pr1, pr2,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), holding, aggregate=True)

        life_tx_repo.create_flush.assert_awaited_once()
        data = life_tx_repo.create_flush.call_args[0][0]
        assert data["type"]   == TransactionType.EXPENSE
        assert data["amount"] == Decimal("10000.00")  # 200 × 50

    @pytest.mark.asyncio
    async def test_aggregate_false_also_fires_wallet_sync(self):
        """aggregate=False (Portfolio page default) must also fire the sync."""
        from app.modules.transactions.models import TransactionType

        svc, holding, life_tx_repo, life_tx_repo_cls, cat_repo_cls = _add_holding_setup(
            asset_type="etf", wallet_type="portfolio",
            qty=Decimal("30"), price=Decimal("200.00"), symbol="QQQ",
        )

        pr1, pr2 = _patch_repos(life_tx_repo_cls, cat_repo_cls)
        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                  return_value=svc.portfolio_repo.get_default_portfolio.return_value),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
            pr1, pr2,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), holding, aggregate=False)

        life_tx_repo.create_flush.assert_awaited_once()
        assert life_tx_repo.create_flush.call_args[0][0]["amount"] == Decimal("6000.00")  # 30 × 200

    @pytest.mark.asyncio
    async def test_holding_created_with_portfolio_wallet_type(self):
        """The form always sends wallet_type='portfolio' for buys."""
        svc, holding, life_tx_repo, life_tx_repo_cls, cat_repo_cls = _add_holding_setup(
            asset_type="etf", wallet_type="portfolio",
            qty=Decimal("10"), price=Decimal("100.00"), symbol="SPY",
        )
        svc._sync_wallet_transaction = AsyncMock()  # isolate holding-repo assertion

        pr1, pr2 = _patch_repos(life_tx_repo_cls, cat_repo_cls)
        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                  return_value=svc.portfolio_repo.get_default_portfolio.return_value),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
            pr1, pr2,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), holding, aggregate=True)

        sent = svc.holding_repo.create_or_aggregate_holding.call_args[1]["holding_data"]
        assert sent["wallet_type"] == "portfolio"

    @pytest.mark.asyncio
    async def test_both_audit_and_life_wallet_transactions_created(self):
        """add_holding creates a portfolio audit tx AND a separate Life Wallet expense tx."""
        svc, holding, life_tx_repo, life_tx_repo_cls, cat_repo_cls = _add_holding_setup(
            asset_type="stock", wallet_type="portfolio",
            qty=Decimal("5"), price=Decimal("300.00"), symbol="NVDA",
        )

        pr1, pr2 = _patch_repos(life_tx_repo_cls, cat_repo_cls)
        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                  return_value=svc.portfolio_repo.get_default_portfolio.return_value),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
            pr1, pr2,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), holding, aggregate=True)

        # 1 portfolio audit record via service's own transaction_repo
        svc.transaction_repo.create.assert_awaited_once()
        # 1 Life Wallet expense via the bridged repo
        life_tx_repo.create_flush.assert_awaited_once()
        assert life_tx_repo.create_flush.call_args[0][0]["amount"] == Decimal("1500.00")  # 5 × 300

    @pytest.mark.asyncio
    @pytest.mark.parametrize("asset_type", ["stock", "etf", "crypto", "bond"])
    async def test_description_includes_symbol_for_all_asset_types(self, asset_type):
        """The Life Wallet expense description should mention the asset symbol."""
        svc, holding, life_tx_repo, life_tx_repo_cls, cat_repo_cls = _add_holding_setup(
            asset_type=asset_type, wallet_type="portfolio",
            qty=Decimal("1"), price=Decimal("100.00"), symbol="XTEST",
        )

        pr1, pr2 = _patch_repos(life_tx_repo_cls, cat_repo_cls)
        with (
            patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                  return_value=svc.portfolio_repo.get_default_portfolio.return_value),
            patch("app.modules.portfolio.services.HoldingResponse.model_validate", return_value=MagicMock()),
            patch("app.modules.portfolio.services.asyncio") as mock_asyncio,
            pr1, pr2,
        ):
            mock_asyncio.get_event_loop = MagicMock(return_value=MagicMock())
            mock_asyncio.ensure_future = MagicMock()
            await svc.add_holding(uuid4(), holding, aggregate=True)

        desc = life_tx_repo.create_flush.call_args[0][0]["description"]
        assert "XTEST" in desc, f"Expected symbol in description, got: {desc!r}"
