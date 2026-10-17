"""
Unit tests for PortfolioService, TransactionService (portfolio module), and AnalyticsService.
All external dependencies (repos, cache, session) are mocked.
"""

import pytest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.core.exceptions import NotFoundException, BusinessLogicException


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_portfolio_service():
    mock_session = MagicMock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()

    with (
        patch("app.modules.portfolio.services.PortfolioRepository"),
        patch("app.modules.portfolio.services.HoldingRepository"),
        patch("app.modules.portfolio.services.TransactionRepository"),
        patch("app.modules.portfolio.services.MarketDataRepository"),
        patch("app.modules.portfolio.services.CurrencyRepository"),
    ):
        from app.modules.portfolio.services import PortfolioService
        svc = PortfolioService(mock_session)

    svc.portfolio_repo = MagicMock()
    svc.holding_repo = MagicMock()
    svc.transaction_repo = MagicMock()
    svc.market_data_repo = MagicMock()
    svc.currency_repo = MagicMock()
    svc.session = mock_session
    return svc


def make_tx_service():
    mock_session = MagicMock()
    mock_session.commit = AsyncMock()

    with (
        patch("app.modules.portfolio.services.PortfolioRepository"),
        patch("app.modules.portfolio.services.HoldingRepository"),
        patch("app.modules.portfolio.services.TransactionRepository"),
        patch("app.modules.portfolio.services.MarketDataRepository"),
        patch("app.modules.portfolio.services.CurrencyRepository"),
    ):
        from app.modules.portfolio.services import TransactionService
        svc = TransactionService(mock_session)

    svc.portfolio_repo = MagicMock()
    svc.holding_repo = MagicMock()
    svc.transaction_repo = MagicMock()
    svc.market_data_repo = MagicMock()
    svc.currency_repo = MagicMock()
    svc.session = mock_session
    return svc


def make_analytics_service():
    mock_session = MagicMock()

    with (
        patch("app.modules.portfolio.services.PortfolioRepository"),
        patch("app.modules.portfolio.services.HoldingRepository"),
        patch("app.modules.portfolio.services.TransactionRepository"),
        patch("app.modules.portfolio.services.MarketDataRepository"),
        patch("app.modules.portfolio.services.CurrencyRepository"),
    ):
        from app.modules.portfolio.services import AnalyticsService
        svc = AnalyticsService(mock_session)

    svc.portfolio_repo = MagicMock()
    svc.holding_repo = MagicMock()
    svc.transaction_repo = MagicMock()
    svc.session = mock_session
    return svc


def make_mock_portfolio(portfolio_id=None, user_id=None, name="My Portfolio",
                         currency="USD", is_default=True):
    p = MagicMock()
    p.id = portfolio_id or uuid4()
    p.user_id = user_id or uuid4()
    p.name = name
    p.currency = currency
    p.is_default = is_default
    p.is_active = True
    p.total_value = Decimal("10000")
    p.total_cost = Decimal("8000")
    p.total_gain_loss = Decimal("2000")
    p.total_gain_loss_percentage = Decimal("25.0")
    p.description = "Test portfolio"
    p.holdings = []
    p.created_at = datetime.now(timezone.utc)
    p.updated_at = datetime.now(timezone.utc)
    return p


# ─── PortfolioService.create_portfolio ───────────────────────────────────────

class TestCreatePortfolio:
    from app.modules.portfolio.schemas import PortfolioCreate

    @pytest.mark.asyncio
    async def test_create_success(self):
        from app.modules.portfolio.schemas import PortfolioCreate
        svc = make_portfolio_service()
        mock_portfolio = make_mock_portfolio()
        svc.portfolio_repo.get_user_portfolios_count = AsyncMock(return_value=0)
        svc.portfolio_repo.create = AsyncMock(return_value=mock_portfolio)

        with patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                   return_value=MagicMock()):
            data = PortfolioCreate(name="Test", currency="USD", is_default=False)
            result = await svc.create_portfolio(data, uuid4())

        assert result is not None
        svc.portfolio_repo.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_create_exceeds_limit_raises_exception(self):
        from app.modules.portfolio.schemas import PortfolioCreate
        svc = make_portfolio_service()
        svc.portfolio_repo.get_user_portfolios_count = AsyncMock(return_value=10)

        with patch("app.modules.portfolio.services.settings") as mock_settings:
            mock_settings.MAX_PORTFOLIOS_PER_USER = 5
            mock_settings.SUPPORTED_CURRENCIES = ["USD", "TWD"]
            with pytest.raises(BusinessLogicException):
                data = PortfolioCreate(name="Test", currency="USD", is_default=False)
                await svc.create_portfolio(data, uuid4())

    @pytest.mark.asyncio
    async def test_create_unsupported_currency_raises_exception(self):
        from app.modules.portfolio.schemas import PortfolioCreate
        svc = make_portfolio_service()
        svc.portfolio_repo.get_user_portfolios_count = AsyncMock(return_value=0)

        with patch("app.modules.portfolio.services.settings") as mock_settings:
            mock_settings.MAX_PORTFOLIOS_PER_USER = 10
            mock_settings.SUPPORTED_CURRENCIES = ["USD", "TWD"]
            with pytest.raises(BusinessLogicException):
                data = PortfolioCreate(name="Test", currency="XYZ", is_default=False)
                await svc.create_portfolio(data, uuid4())


# ─── PortfolioService.get_portfolio ──────────────────────────────────────────

class TestGetPortfolio:

    @pytest.mark.asyncio
    async def test_returns_portfolio(self):
        svc = make_portfolio_service()
        mock_portfolio = make_mock_portfolio()
        svc.portfolio_repo.get_by_id = AsyncMock(return_value=mock_portfolio)

        with patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                   return_value=MagicMock()):
            result = await svc.get_portfolio(uuid4(), uuid4())

        assert result is not None

    @pytest.mark.asyncio
    async def test_not_found_raises_404(self):
        svc = make_portfolio_service()
        svc.portfolio_repo.get_by_id = AsyncMock(return_value=None)

        with pytest.raises(NotFoundException):
            await svc.get_portfolio(uuid4(), uuid4())


# ─── PortfolioService.get_user_portfolios ────────────────────────────────────

class TestGetUserPortfolios:

    @pytest.mark.asyncio
    async def test_returns_list(self):
        svc = make_portfolio_service()
        mock_portfolios = [make_mock_portfolio(), make_mock_portfolio()]
        svc.portfolio_repo.get_user_portfolios = AsyncMock(
            return_value=(mock_portfolios, 2)
        )

        with patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                   side_effect=lambda p: MagicMock()):
            result, total = await svc.get_user_portfolios(uuid4())

        assert len(result) == 2
        assert total == 2

    @pytest.mark.asyncio
    async def test_returns_empty_list(self):
        svc = make_portfolio_service()
        svc.portfolio_repo.get_user_portfolios = AsyncMock(return_value=([], 0))

        result, total = await svc.get_user_portfolios(uuid4())
        assert result == []
        assert total == 0


# ─── PortfolioService.update_portfolio ───────────────────────────────────────

# ─── PortfolioService.delete_portfolio ───────────────────────────────────────

# ─── PortfolioService.get_default_portfolio ──────────────────────────────────

class TestGetDefaultPortfolio:

    @pytest.mark.asyncio
    async def test_returns_none_when_no_portfolio(self):
        svc = make_portfolio_service()
        svc.portfolio_repo.get_default_portfolio = AsyncMock(return_value=None)

        result = await svc.get_default_portfolio(uuid4())
        assert result is None

    @pytest.mark.asyncio
    async def test_fetches_from_db_on_cache_miss(self):
        svc = make_portfolio_service()
        mock_portfolio = make_mock_portfolio()
        svc.portfolio_repo.get_default_portfolio = AsyncMock(return_value=mock_portfolio)

        with patch("app.modules.portfolio.services.PortfolioResponse.model_validate",
                   return_value=MagicMock(id=mock_portfolio.id, dict=lambda: {})):
            result = await svc.get_default_portfolio(uuid4())

        svc.portfolio_repo.get_default_portfolio.assert_awaited_once()


# ─── PortfolioService.get_user_holdings ──────────────────────────────────────

class TestGetUserHoldings:

    @pytest.mark.asyncio
    async def test_with_portfolio_id(self):
        svc = make_portfolio_service()
        mock_holding = MagicMock()
        svc.holding_repo.get_portfolio_holdings = AsyncMock(
            return_value=([mock_holding], 1)
        )

        with patch("app.modules.portfolio.services.HoldingResponse.model_validate",
                   return_value=MagicMock()):
            result, total = await svc.get_user_holdings(uuid4(), portfolio_id=uuid4())

        assert len(result) == 1
        assert total == 1

    @pytest.mark.asyncio
    async def test_no_default_portfolio_returns_empty(self):
        svc = make_portfolio_service()
        svc.portfolio_repo.get_default_portfolio = AsyncMock(return_value=None)

        result, total = await svc.get_user_holdings(uuid4())
        assert result == []
        assert total == 0


# ─── portfolio TransactionService.get_transaction ────────────────────────────

class TestPortfolioTransactionService:

    @pytest.mark.asyncio
    async def test_get_transaction_success(self):
        svc = make_tx_service()
        mock_tx = MagicMock()
        svc.transaction_repo.get_by_id = AsyncMock(return_value=mock_tx)

        with patch("app.modules.portfolio.services.TransactionResponse.model_validate",
                   return_value=MagicMock()):
            result = await svc.get_transaction(uuid4(), uuid4())

        assert result is not None

    @pytest.mark.asyncio
    async def test_get_transaction_not_found_raises_404(self):
        svc = make_tx_service()
        svc.transaction_repo.get_by_id = AsyncMock(return_value=None)

        with pytest.raises(NotFoundException):
            await svc.get_transaction(uuid4(), uuid4())

    @pytest.mark.asyncio
    async def test_get_portfolio_transactions_not_found_raises_404(self):
        svc = make_tx_service()
        svc.portfolio_repo.get_by_id = AsyncMock(return_value=None)

        with pytest.raises(NotFoundException):
            await svc.get_portfolio_transactions(uuid4(), uuid4())

    @pytest.mark.asyncio
    async def test_get_portfolio_transactions_success(self):
        svc = make_tx_service()
        mock_portfolio = make_mock_portfolio()
        mock_tx = MagicMock()
        svc.portfolio_repo.get_by_id = AsyncMock(return_value=mock_portfolio)
        svc.transaction_repo.get_portfolio_transactions = AsyncMock(
            return_value=([mock_tx], 1)
        )

        with patch("app.modules.portfolio.services.TransactionResponse.model_validate",
                   return_value=MagicMock()):
            result, total = await svc.get_portfolio_transactions(uuid4(), uuid4())

        assert len(result) == 1
        assert total == 1


# ─── AnalyticsService.calculate_portfolio_performance ────────────────────────

class TestAnalyticsService:

    @pytest.mark.asyncio
    async def test_calculates_from_db_on_cache_miss(self):
        svc = make_analytics_service()
        mock_portfolio = make_mock_portfolio()
        svc.portfolio_repo.get_by_id = AsyncMock(return_value=mock_portfolio)
        svc.holding_repo.get_portfolio_holdings = AsyncMock(return_value=([], 0))

        mock_hist_repo = MagicMock()
        mock_hist_repo.get_batch_price_history = AsyncMock(return_value={})

        with patch("app.modules.portfolio.historical_price_repository.HistoricalPriceRepository", return_value=mock_hist_repo):
            result = await svc.calculate_portfolio_performance(uuid4(), uuid4())

        svc.portfolio_repo.get_by_id.assert_awaited_once()
        assert result.total_return == Decimal("2000")

    @pytest.mark.asyncio
    async def test_portfolio_not_found_raises_404(self):
        svc = make_analytics_service()
        svc.portfolio_repo.get_by_id = AsyncMock(return_value=None)

        with pytest.raises(NotFoundException):
            await svc.calculate_portfolio_performance(uuid4(), uuid4())
