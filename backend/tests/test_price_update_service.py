"""
Unit tests for Price Update Service

Tests cover:
- Market hours logic
- Smart caching behavior
- Force flag handling
- Holiday detection
- Database transaction handling
- Error scenarios
"""

import asyncio
import pytest
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from unittest.mock import Mock, AsyncMock, patch, MagicMock

from app.modules.portfolio.price_update_service import (
    MarketHoursManager,
    PriceUpdateService,
)
from app.modules.portfolio.models import PortfolioHolding


class TestMarketHoursManager:
    """Test suite for market hours and trading day logic"""

    def test_is_market_open_during_tw_trading_hours(self):
        """Taiwan market should be open Mon-Fri 9:00-13:30"""
        # Mock current time to Wednesday 10:00 TST (market open)
        with patch('app.modules.portfolio.price_update_service.datetime') as mock_dt:
            mock_now = datetime(2026, 4, 1, 10, 0, 0, tzinfo=ZoneInfo("Asia/Taipei"))
            mock_dt.now.return_value = mock_now

            assert MarketHoursManager.is_market_open("TW") == True

    def test_is_market_closed_before_open_tw(self):
        """Taiwan market should be closed before 9:00"""
        with patch('app.modules.portfolio.price_update_service.datetime') as mock_dt:
            mock_now = datetime(2026, 4, 1, 8, 30, 0, tzinfo=ZoneInfo("Asia/Taipei"))
            mock_dt.now.return_value = mock_now

            assert MarketHoursManager.is_market_open("TW") == False

    def test_is_market_closed_after_close_tw(self):
        """Taiwan market should be closed after 13:30"""
        with patch('app.modules.portfolio.price_update_service.datetime') as mock_dt:
            mock_now = datetime(2026, 4, 1, 14, 0, 0, tzinfo=ZoneInfo("Asia/Taipei"))
            mock_dt.now.return_value = mock_now

            assert MarketHoursManager.is_market_open("TW") == False

    def test_is_market_closed_on_weekend_tw(self):
        """Taiwan market should be closed on Saturday"""
        with patch('app.modules.portfolio.price_update_service.datetime') as mock_dt:
            # Saturday 10:00 TST
            mock_now = datetime(2026, 4, 4, 10, 0, 0, tzinfo=ZoneInfo("Asia/Taipei"))
            mock_dt.now.return_value = mock_now

            assert MarketHoursManager.is_market_open("TW") == False

    def test_is_market_open_crypto_24_7(self):
        """Crypto market should always be open"""
        with patch('app.modules.portfolio.price_update_service.datetime') as mock_dt:
            # Sunday 3:00 AM UTC
            mock_now = datetime(2026, 4, 5, 3, 0, 0, tzinfo=ZoneInfo("UTC"))
            mock_dt.now.return_value = mock_now

            assert MarketHoursManager.is_market_open("CRYPTO") == True

    def test_should_update_price_never_updated(self):
        """Should always update if never updated before"""
        result = MarketHoursManager.should_update_price("TW", last_update=None)
        assert result == True

    def test_should_update_price_during_market_hours_within_ttl(self):
        """Should NOT update if last updated < 1 hour ago during market hours"""
        # Last update: 30 minutes ago
        last_update = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=30)

        with patch.object(MarketHoursManager, 'is_market_open', return_value=True):
            result = MarketHoursManager.should_update_price("TW", last_update)
            assert result == False

    def test_should_update_price_during_market_hours_expired_ttl(self):
        """Should update if last updated > 1 hour ago during market hours"""
        # Last update: 90 minutes ago
        last_update = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=90)

        with patch.object(MarketHoursManager, 'is_market_open', return_value=True):
            result = MarketHoursManager.should_update_price("TW", last_update)
            assert result == True

    def test_should_update_price_market_closed_not_updated_today(self):
        """Should update if market closed and not updated after close"""
        # Last update: yesterday
        last_update = datetime.now(ZoneInfo("UTC")) - timedelta(days=1)

        with patch.object(MarketHoursManager, 'is_market_open', return_value=False):
            with patch.object(MarketHoursManager, 'get_market_close_time') as mock_close:
                # Market close time: today 13:30 TST
                mock_close.return_value = datetime.now(ZoneInfo("UTC"))

                result = MarketHoursManager.should_update_price("TW", last_update)
                assert result == True

    def test_should_update_price_crypto_30_min_interval(self):
        """Crypto should update every 30 minutes"""
        # Last update: 35 minutes ago
        last_update = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=35)

        result = MarketHoursManager.should_update_price("CRYPTO", last_update)
        assert result == True

    def test_should_update_price_crypto_within_interval(self):
        """Crypto should NOT update if < 30 minutes"""
        # Last update: 15 minutes ago
        last_update = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=15)

        result = MarketHoursManager.should_update_price("CRYPTO", last_update)
        assert result == False


class TestPriceUpdateService:
    """Test suite for price update service"""

    @pytest.fixture
    def mock_session(self):
        """Mock database session"""
        session = AsyncMock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()
        session.execute = AsyncMock()
        return session

    @pytest.fixture
    def mock_holding(self):
        """Create mock holding"""
        holding = Mock(spec=PortfolioHolding)
        holding.id = "holding-123"
        holding.symbol = "0050"
        holding.market = "TW"
        holding.quantity = Decimal("100")
        holding.average_cost = Decimal("120.5")
        holding.current_price = Decimal("125.0")
        holding.total_cost = Decimal("12050")
        holding.total_value = Decimal("12500")
        holding.last_price_update_at = None
        return holding

    @pytest.mark.asyncio
    async def test_update_holding_price_force_flag_bypasses_cache(self, mock_session, mock_holding):
        """Force flag should bypass all caching logic"""
        service = PriceUpdateService(mock_session)

        # Set last update to 10 minutes ago (within cache TTL)
        mock_holding.last_price_update_at = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=10)

        # Mock market data service to return new price
        with patch.object(service.market_data_service, 'get_current_price', new_callable=AsyncMock) as mock_price:
            mock_price.return_value = Decimal("130.0")

            # Call with force=True
            result = await service.update_holding_price(mock_holding, force=True)

            # Should update despite cache being valid
            assert result == True
            assert mock_price.called == True
            assert mock_holding.current_price == Decimal("130.0")

    @pytest.mark.asyncio
    async def test_update_holding_price_respects_cache_when_not_forced(self, mock_session, mock_holding):
        """Should respect cache when force=False"""
        service = PriceUpdateService(mock_session)

        # Set last update to 10 minutes ago (within cache TTL)
        mock_holding.last_price_update_at = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=10)

        # Mock should_update_price to return False (cache valid)
        with patch.object(service.market_hours_manager, 'should_update_price', return_value=False):
            with patch.object(service.market_data_service, 'get_current_price', new_callable=AsyncMock) as mock_price:
                result = await service.update_holding_price(mock_holding, force=False)

                # Should NOT update (cache hit)
                assert result == False
                assert mock_price.called == False

    @pytest.mark.asyncio
    async def test_update_portfolio_prices_prefetches_each_symbol_once(self, mock_session):
        """The batch path fetches each symbol's price exactly once (concurrent
        prefetch) and reuses it in the sequential apply loop — never a second,
        serial fetch (which is what made refresh-prices ~31s for ~60 symbols)."""
        service = PriceUpdateService(mock_session)

        def _holding(symbol):
            h = Mock(spec=PortfolioHolding)
            h.id, h.symbol, h.market, h.type = f"h-{symbol}", symbol, "TW", "stock"
            h.quantity = Decimal("100")
            h.average_cost = h.current_price = Decimal("100")
            h.total_cost = h.total_value = Decimal("10000")
            h.last_price_update_at = None
            return h

        holdings = [_holding("0050"), _holding("2330"), _holding("0056")]
        result = Mock()
        result.scalars.return_value.all.return_value = holdings
        mock_session.execute.return_value = result

        with patch.object(service.market_hours_manager, "should_update_price", return_value=True):
            with patch.object(service.market_data_service, "get_current_price", new_callable=AsyncMock) as mock_price:
                mock_price.return_value = Decimal("150.0")

                stats = await service.update_portfolio_prices(user_id="u1")

        # Exactly one fetch per unique symbol — the prefetched result is reused.
        assert mock_price.call_count == 3
        assert sorted(c.args[0] for c in mock_price.call_args_list) == ["0050", "0056", "2330"]
        assert stats["updated"] == 3
        assert all(h.current_price == Decimal("150.0") for h in holdings)

    @pytest.mark.asyncio
    async def test_update_holding_price_calculates_metrics_correctly(self, mock_session, mock_holding):
        """Should correctly calculate total_value, gain_loss, and percentage"""
        service = PriceUpdateService(mock_session)

        mock_holding.quantity = Decimal("100")
        mock_holding.average_cost = Decimal("120.0")

        # Mock market data service
        with patch.object(service.market_data_service, 'get_current_price', new_callable=AsyncMock) as mock_price:
            mock_price.return_value = Decimal("150.0")  # 25% gain

            result = await service.update_holding_price(mock_holding, force=True)

            assert result == True
            assert mock_holding.current_price == Decimal("150.0")
            assert mock_holding.total_value == Decimal("15000")  # 100 * 150
            assert mock_holding.total_cost == Decimal("12000")  # 100 * 120
            assert mock_holding.gain_loss == Decimal("3000")  # 15000 - 12000
            assert mock_holding.gain_loss_percentage == Decimal("25")  # (3000 / 12000) * 100

    @pytest.mark.asyncio
    async def test_update_holding_price_handles_api_failure_gracefully(self, mock_session, mock_holding):
        """Should handle API failures without crashing"""
        service = PriceUpdateService(mock_session)

        # Mock market data service to raise exception
        with patch.object(service.market_data_service, 'get_current_price', new_callable=AsyncMock) as mock_price:
            mock_price.side_effect = Exception("API timeout")

            result = await service.update_holding_price(mock_holding, force=True)

            # _get_price_with_fallback falls back to existing price on API failure
            assert result == True
            assert mock_holding.current_price == Decimal("125.0")  # Existing price used as fallback

    @pytest.mark.asyncio
    async def test_update_holding_price_handles_zero_price(self, mock_session, mock_holding):
        """Should handle zero or None price from API"""
        service = PriceUpdateService(mock_session)

        # Mock market data service to return None
        with patch.object(service.market_data_service, 'get_current_price', new_callable=AsyncMock) as mock_price:
            mock_price.return_value = None

            result = await service.update_holding_price(mock_holding, force=True)

            # _get_price_with_fallback falls back to existing price when API returns None
            assert result == True
            assert mock_holding.current_price == Decimal("125.0")  # Existing price used as fallback

    @pytest.mark.asyncio
    async def test_update_portfolio_prices_filters_non_tradable_symbols(self, mock_session):
        """Should skip non-tradable symbols like CASH, SAVINGS, CRYPTO"""
        service = PriceUpdateService(mock_session)

        # Create mock holdings with mixed types
        holdings = [
            Mock(symbol="0050", market="TW", type="stock"),
            Mock(symbol="CASH-TWD", market="TW", type="cash"),
            Mock(symbol="BTC-USD", market="CRYPTO", type="crypto"),
            Mock(symbol="TWD-SAVINGS", market="TW", type="savings"),
        ]

        # Mock database query (MagicMock — scalars/all are synchronous)
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = holdings
        mock_session.execute.return_value = mock_result

        # Mock update function
        with patch.object(service, 'update_holding_price') as mock_update:
            mock_update.return_value = True

            result = await service.update_portfolio_prices("user-123", force=True)

            # Should only update tradable holding (0050)
            assert result['total'] == 1
            assert mock_update.call_count == 1

    @pytest.mark.asyncio
    async def test_update_portfolio_prices_commits_partial_success(self, mock_session):
        """Should commit successful updates even if some fail"""
        service = PriceUpdateService(mock_session)

        # Create 3 mock holdings
        holdings = [
            Mock(symbol="0050", market="TW", type="stock"),
            Mock(symbol="2330", market="TW", type="stock"),
            Mock(symbol="AAPL", market="US", type="stock"),
        ]

        # Mock database query (MagicMock — scalars/all are synchronous)
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = holdings
        mock_session.execute.return_value = mock_result

        # 3rd holding returns False (cache hit, not a failure)
        update_results = [True, True, False]
        with patch.object(service, 'update_holding_price') as mock_update:
            mock_update.side_effect = update_results

            result = await service.update_portfolio_prices("user-123", force=True)

            # False return = cached (not failed); failed only increments on exception
            assert result['total'] == 3
            assert result['updated'] == 2
            assert result['cached'] == 1
            assert result['failed'] == 0

            # Should commit all updates
            assert mock_session.commit.called == True

    @pytest.mark.asyncio
    async def test_update_portfolio_prices_rollback_on_commit_failure(self, mock_session):
        """Should rollback if commit fails"""
        service = PriceUpdateService(mock_session)

        holdings = [Mock(symbol="0050", market="TW", type="stock")]

        # Mock database query (MagicMock — scalars/all are synchronous)
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = holdings
        mock_session.execute.return_value = mock_result

        # Mock commit to fail
        mock_session.commit.side_effect = Exception("Database deadlock")

        with patch.object(service, 'update_holding_price', return_value=True):
            with pytest.raises(Exception, match="Database deadlock"):
                await service.update_portfolio_prices("user-123", force=True)

            # Should call rollback
            assert mock_session.rollback.called == True


class TestPriceUpdateEdgeCases:
    """Test edge cases and error scenarios"""

    @pytest.mark.asyncio
    async def test_update_price_with_timezone_aware_datetime(self):
        """Should handle timezone-aware last_update correctly"""
        # Last update with UTC timezone
        last_update_utc = datetime.now(ZoneInfo("UTC")) - timedelta(hours=2)

        # Last update with Taiwan timezone
        last_update_tw = datetime.now(ZoneInfo("Asia/Taipei")) - timedelta(hours=2)

        # Both should be treated equally
        result_utc = MarketHoursManager.should_update_price("TW", last_update_utc)
        result_tw = MarketHoursManager.should_update_price("TW", last_update_tw)

        assert result_utc == result_tw

    @pytest.mark.asyncio
    async def test_update_price_with_timezone_naive_datetime(self):
        """Should handle timezone-naive datetime by assuming UTC"""
        # Last update without timezone (naive)
        last_update_naive = datetime.now() - timedelta(hours=2)

        # Should not crash, assume UTC
        result = MarketHoursManager.should_update_price("TW", last_update_naive)
        assert isinstance(result, bool)

    def test_get_market_close_time_on_weekend_returns_none(self):
        """Should return None for market close on weekend"""
        # Saturday
        with patch('app.modules.portfolio.price_update_service.datetime') as mock_dt:
            mock_now = datetime(2026, 4, 4, 10, 0, 0, tzinfo=ZoneInfo("Asia/Taipei"))
            mock_dt.now.return_value = mock_now

            close_time = MarketHoursManager.get_market_close_time("TW")
            assert close_time is None

    def test_unknown_market_defaults_to_us_hours(self):
        """Unknown market should default to US market hours"""
        with patch('app.modules.portfolio.price_update_service.datetime') as mock_dt:
            # Wednesday 15:00 EST (US market open)
            mock_now = datetime(2026, 4, 1, 15, 0, 0, tzinfo=ZoneInfo("America/New_York"))
            mock_dt.now.return_value = mock_now

            result = MarketHoursManager.is_market_open("UNKNOWN")
            # Should use US hours (9:30-16:00 EST)
            assert result == True


class TestUpdateAllSymbolsPrices:
    """Tests for the symbol-first batch update used by the scheduler."""

    @pytest.fixture
    def mock_session(self):
        session = AsyncMock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()
        session.execute = AsyncMock()
        return session

    def _make_symbol_row(self, symbol, market):
        row = Mock()
        row.symbol = symbol
        row.market = market
        return row

    @pytest.mark.asyncio
    async def test_no_holdings_returns_zero_stats(self, mock_session):
        """Returns early with zeros when no tradable holdings exist."""
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_session.execute.return_value = mock_result

        service = PriceUpdateService(mock_session)
        stats = await service.update_all_symbols_prices(force=True)

        assert stats["total_symbols"] == 0
        assert stats["updated"] == 0
        assert mock_session.commit.called == False

    @pytest.mark.asyncio
    async def test_each_unique_symbol_fetched_once(self, mock_session):
        """Price is fetched exactly once per symbol, regardless of user count."""
        # Three holdings across two users, but only two unique symbols
        rows = [
            self._make_symbol_row("0050", "TW"),
            self._make_symbol_row("AAPL", "US"),
        ]
        mock_result = MagicMock()
        mock_result.fetchall.return_value = rows
        # Second/third execute calls are bulk UPDATEs (force=True skips sample query)
        mock_session.execute.side_effect = [mock_result, MagicMock(), MagicMock()]

        service = PriceUpdateService(mock_session)

        with patch.object(service, '_get_price_with_fallback', new_callable=AsyncMock) as mock_price:
            mock_price.return_value = Decimal("100.0")

            await service.update_all_symbols_prices(force=True)

            # Price fetched once per unique symbol
            assert mock_price.call_count == 2
            calls = [c.kwargs["symbol"] for c in mock_price.call_args_list]
            assert set(calls) == {"0050", "AAPL"}

    @pytest.mark.asyncio
    async def test_bulk_update_issued_per_symbol(self, mock_session):
        """A single UPDATE statement is executed for each symbol."""
        rows = [self._make_symbol_row("2330", "TW")]
        mock_result = MagicMock()
        mock_result.fetchall.return_value = rows
        # execute calls: initial query + bulk UPDATE (force=True skips sample)
        mock_session.execute.side_effect = [mock_result, MagicMock()]

        service = PriceUpdateService(mock_session)

        with patch.object(service, '_get_price_with_fallback', return_value=Decimal("600.0")):
            stats = await service.update_all_symbols_prices(force=True)

        assert stats["updated"] == 1
        assert stats["failed"] == 0
        assert mock_session.commit.called == True

    @pytest.mark.asyncio
    async def test_invalid_price_counts_as_failed(self, mock_session):
        """Symbol is counted as failed when price fetch returns None or zero."""
        rows = [self._make_symbol_row("BAD", "US")]
        mock_result = MagicMock()
        mock_result.fetchall.return_value = rows
        # Only the initial query execute call (price=None → no bulk UPDATE)
        mock_session.execute.return_value = mock_result

        service = PriceUpdateService(mock_session)

        with patch.object(service, '_get_price_with_fallback', return_value=None):
            stats = await service.update_all_symbols_prices(force=True)

        assert stats["failed"] == 1
        assert stats["updated"] == 0

    @pytest.mark.asyncio
    async def test_non_tradable_symbols_excluded(self, mock_session):
        """CASH, SAVINGS, CRYPTO symbols are filtered out at the query level."""
        # The query uses .notin_() and manual filter — simulate with empty result
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_session.execute.return_value = mock_result

        service = PriceUpdateService(mock_session)

        with patch.object(service, '_get_price_with_fallback') as mock_price:
            stats = await service.update_all_symbols_prices(force=True)
            assert mock_price.call_count == 0

        assert stats["total_symbols"] == 0

    @pytest.mark.asyncio
    async def test_skipped_when_market_fresh_and_not_forced(self, mock_session):
        """Symbol is cached (skipped) when market hours check says no update needed."""
        rows = [self._make_symbol_row("0050", "TW")]
        mock_result = MagicMock()
        mock_result.fetchall.return_value = rows
        # last_price_update_at = 30 minutes ago (within TTL)
        recent = datetime.now(ZoneInfo("UTC")) - timedelta(minutes=30)
        sample_result = MagicMock()
        sample_result.fetchone.return_value = (recent,)
        mock_session.execute.side_effect = [mock_result, sample_result]

        service = PriceUpdateService(mock_session)

        with patch.object(service.market_hours_manager, 'should_update_price', return_value=False):
            with patch.object(service, '_get_price_with_fallback') as mock_price:
                stats = await service.update_all_symbols_prices(force=False)
                assert mock_price.call_count == 0

        assert stats["cached"] == 1
        assert stats["updated"] == 0

    @pytest.mark.asyncio
    async def test_rollback_on_commit_failure(self, mock_session):
        """Session is rolled back if commit raises."""
        rows = [self._make_symbol_row("AAPL", "US")]
        mock_result = MagicMock()
        mock_result.fetchall.return_value = rows
        # execute calls: initial query + bulk UPDATE (force=True skips sample)
        mock_session.execute.side_effect = [mock_result, MagicMock()]
        mock_session.commit.side_effect = Exception("deadlock")

        service = PriceUpdateService(mock_session)

        with patch.object(service, '_get_price_with_fallback', return_value=Decimal("150.0")):
            with pytest.raises(Exception, match="deadlock"):
                await service.update_all_symbols_prices(force=True)

        assert mock_session.rollback.called == True

    @pytest.mark.asyncio
    async def test_one_symbol_exception_does_not_abort_others(self, mock_session):
        """An exception on one symbol is caught; remaining symbols still process."""
        rows = [
            self._make_symbol_row("CRASH", "US"),
            self._make_symbol_row("AAPL", "US"),
        ]
        mock_result = MagicMock()
        mock_result.fetchall.return_value = rows
        # execute calls: initial query + 1× bulk UPDATE for AAPL (CRASH fails before UPDATE)
        # force=True skips sample queries
        mock_session.execute.side_effect = [mock_result, MagicMock()]

        service = PriceUpdateService(mock_session)

        call_count = 0
        async def price_side_effect(symbol, market, **kwargs):
            nonlocal call_count
            call_count += 1
            if symbol == "CRASH":
                raise Exception("API error")
            return Decimal("200.0")

        with patch.object(service, '_get_price_with_fallback', side_effect=price_side_effect):
            stats = await service.update_all_symbols_prices(force=True)

        assert stats["failed"] == 1
        assert stats["updated"] == 1


class TestConcurrencyAndRaceConditions:
    """Test concurrent access and race conditions"""

    @pytest.mark.asyncio
    async def test_concurrent_price_updates_same_holding(self):
        """Multiple concurrent updates to same holding should be safe"""
        # This test would require actual asyncio testing
        # For now, document the expected behavior
        pass

    @pytest.mark.asyncio
    async def test_concurrent_cache_initialization(self):
        """Multiple concurrent cache initializations should not cause race condition"""
        # This requires testing the finlab cache lock initialization
        pass


class TestHistoricalFallbackGuard:
    """A batch update must never trade a fresh price for an old close.

    Regression: update_all_symbols_prices iterated distinct (symbol, market)
    pairs, so "0050" ran twice — once as TW, once as a mislabelled US. The US
    pass 404'd on the bare ticker, fell through to the historical fallback, and
    overwrote the good 106.40 quote with a stale 105.20.
    """

    @pytest.fixture
    def mock_session(self):
        session = AsyncMock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()
        return session

    @pytest.mark.asyncio
    async def test_returns_none_instead_of_stale_close(self, mock_session):
        service = PriceUpdateService(mock_session)

        with patch.object(
            service.market_data_service, "get_current_price", return_value=None
        ):
            price = await service._get_price_with_fallback(
                symbol="0050", market="US", allow_historical_fallback=False
            )

        assert price is None, "must not surface a historical close to this caller"

    @pytest.mark.asyncio
    async def test_existing_price_still_wins_over_nothing(self, mock_session):
        """Disabling the historical fallback must not disable fallback 1."""
        service = PriceUpdateService(mock_session)

        with patch.object(
            service.market_data_service, "get_current_price", return_value=None
        ):
            price = await service._get_price_with_fallback(
                symbol="0050",
                market="US",
                current_price=Decimal("106.40"),
                allow_historical_fallback=False,
            )

        assert price == Decimal("106.40")


class TestSymbolBatchConcurrency:
    """update_all_symbols_prices — the scheduler's symbol-first batch path.

    The per-user path (update_portfolio_prices) already prefetches its quotes
    concurrently; this one still fetched them one symbol at a time, which is
    what makes the all-users refresh scale linearly with the symbol count.
    These tests pin the concurrent prefetch without changing what gets written.
    """

    @pytest.fixture
    def mock_session(self):
        session = AsyncMock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()
        return session

    @staticmethod
    def _row(**kwargs):
        row = Mock()
        for k, v in kwargs.items():
            setattr(row, k, v)
        return row

    def _wire_session(self, session, symbols, last_updates=None):
        """First execute() returns the distinct (symbol, market) rows, the second
        the per-symbol last_price_update_at; everything after is an UPDATE."""
        symbol_rows = [self._row(symbol=s, market=m) for s, m in symbols]
        # The freshness query selects (symbol, MAX(last_price_update_at)) and is
        # read positionally, matching how SQLAlchemy hands back grouped rows.
        stale_rows = [(s, (last_updates or {}).get(s)) for s, _ in symbols]
        results = [symbol_rows, stale_rows]
        calls = {"n": 0}

        async def _execute(*args, **kwargs):
            res = Mock()
            i = calls["n"]
            calls["n"] += 1
            res.fetchall.return_value = results[i] if i < len(results) else []
            return res

        session.execute = AsyncMock(side_effect=_execute)

    def _tracking_fetch(self, tracker, delay=0.05, price=Decimal("150.0")):
        async def _fetch(symbol, market, allow_historical_fallback=True, **kwargs):
            tracker["inflight"] += 1
            tracker["max"] = max(tracker["max"], tracker["inflight"])
            tracker["symbols"].append(symbol)
            try:
                await asyncio.sleep(delay)
                return price
            finally:
                tracker["inflight"] -= 1

        return _fetch

    @pytest.mark.asyncio
    async def test_prices_are_fetched_concurrently(self, mock_session):
        """12 symbols must overlap in flight, not run strictly one at a time."""
        service = PriceUpdateService(mock_session)
        symbols = [(f"SYM{i}", "TW") for i in range(12)]
        self._wire_session(mock_session, symbols)
        tracker = {"inflight": 0, "max": 0, "symbols": []}

        with patch.object(service, "_get_price_with_fallback", self._tracking_fetch(tracker)), \
             patch.object(service.market_data_service, "get_previous_close",
                          new_callable=AsyncMock, return_value=Decimal("149.0")):
            stats = await service.update_all_symbols_prices(force=True)

        assert tracker["max"] > 1, "quotes were still fetched one at a time"
        assert stats["updated"] == 12
        assert sorted(tracker["symbols"]) == sorted(s for s, _ in symbols)

    @pytest.mark.asyncio
    async def test_concurrency_is_bounded(self, mock_session):
        """Unbounded fan-out would hammer the upstream provider."""
        service = PriceUpdateService(mock_session)
        symbols = [(f"SYM{i}", "TW") for i in range(40)]
        self._wire_session(mock_session, symbols)
        tracker = {"inflight": 0, "max": 0, "symbols": []}

        with patch.object(service, "_get_price_with_fallback", self._tracking_fetch(tracker)), \
             patch.object(service.market_data_service, "get_previous_close",
                          new_callable=AsyncMock, return_value=None):
            await service.update_all_symbols_prices(force=True)

        assert tracker["max"] <= service.SYMBOL_FETCH_CONCURRENCY

    @pytest.mark.asyncio
    async def test_each_symbol_fetched_exactly_once(self, mock_session):
        service = PriceUpdateService(mock_session)
        symbols = [("0050", "TW"), ("2330", "TW"), ("AAPL", "US")]
        self._wire_session(mock_session, symbols)
        tracker = {"inflight": 0, "max": 0, "symbols": []}

        with patch.object(service, "_get_price_with_fallback", self._tracking_fetch(tracker, delay=0)), \
             patch.object(service.market_data_service, "get_previous_close",
                          new_callable=AsyncMock, return_value=None):
            stats = await service.update_all_symbols_prices(force=True)

        assert sorted(tracker["symbols"]) == ["0050", "2330", "AAPL"]
        assert stats["updated"] == 3

    @pytest.mark.asyncio
    async def test_fresh_symbols_are_skipped_without_fetching(self, mock_session):
        """The market-hours skip must survive the restructure: a symbol whose
        price is still fresh is counted as cached and never fetched."""
        service = PriceUpdateService(mock_session)
        symbols = [("0050", "TW"), ("2330", "TW")]
        self._wire_session(mock_session, symbols)
        tracker = {"inflight": 0, "max": 0, "symbols": []}

        def _should_update(market, last_update):
            return False

        with patch.object(service.market_hours_manager, "should_update_price", _should_update), \
             patch.object(service, "_get_price_with_fallback", self._tracking_fetch(tracker)), \
             patch.object(service.market_data_service, "get_previous_close",
                          new_callable=AsyncMock, return_value=None):
            stats = await service.update_all_symbols_prices(force=False)

        assert tracker["symbols"] == []
        assert stats["cached"] == 2
        assert stats["updated"] == 0

    @pytest.mark.asyncio
    async def test_one_bad_symbol_does_not_sink_the_batch(self, mock_session):
        """A provider error for one symbol must not abort the other updates."""
        service = PriceUpdateService(mock_session)
        symbols = [("GOOD1", "TW"), ("BOOM", "TW"), ("GOOD2", "TW")]
        self._wire_session(mock_session, symbols)

        async def _fetch(symbol, market, allow_historical_fallback=True, **kwargs):
            if symbol == "BOOM":
                raise RuntimeError("provider exploded")
            return Decimal("150.0")

        with patch.object(service, "_get_price_with_fallback", _fetch), \
             patch.object(service.market_data_service, "get_previous_close",
                          new_callable=AsyncMock, return_value=None):
            stats = await service.update_all_symbols_prices(force=True)

        assert stats["updated"] == 2
        assert stats["failed"] == 1

    @pytest.mark.asyncio
    async def test_no_price_counts_as_failed_and_writes_nothing(self, mock_session):
        """A None/zero quote must not be written over a good stored price."""
        service = PriceUpdateService(mock_session)
        symbols = [("0050", "TW"), ("2330", "TW")]
        self._wire_session(mock_session, symbols)

        async def _fetch(symbol, market, allow_historical_fallback=True, **kwargs):
            return None if symbol == "0050" else Decimal("150.0")

        with patch.object(service, "_get_price_with_fallback", _fetch), \
             patch.object(service.market_data_service, "get_previous_close",
                          new_callable=AsyncMock, return_value=None):
            stats = await service.update_all_symbols_prices(force=True)

        assert stats["failed"] == 1
        assert stats["updated"] == 1

    @pytest.mark.asyncio
    async def test_previous_close_lookups_are_also_concurrent(self, mock_session):
        """get_previous_close is a second per-symbol round-trip on a cache miss;
        it must ride along in the same bounded prefetch, not re-serialise."""
        service = PriceUpdateService(mock_session)
        symbols = [(f"SYM{i}", "TW") for i in range(8)]
        self._wire_session(mock_session, symbols)
        prev = {"inflight": 0, "max": 0}

        async def _prev_close(symbol, market):
            prev["inflight"] += 1
            prev["max"] = max(prev["max"], prev["inflight"])
            try:
                await asyncio.sleep(0.05)
                return Decimal("149.0")
            finally:
                prev["inflight"] -= 1

        with patch.object(service, "_get_price_with_fallback",
                          self._tracking_fetch({"inflight": 0, "max": 0, "symbols": []}, delay=0)), \
             patch.object(service.market_data_service, "get_previous_close", _prev_close):
            await service.update_all_symbols_prices(force=True)

        assert prev["max"] > 1, "previous_close lookups were still serial"


class TestScheduledMarketJob:
    """Each scheduled job prices the symbols whose resolved market it owns."""

    async def _job_prices(self, async_session, market, holdings_by_user):
        """Seed real holdings, run the job, return (symbols fetched, stats)."""
        import uuid
        from contextlib import asynccontextmanager
        from datetime import date
        from app.core import scheduler
        from app.modules.portfolio.models import Portfolio
        from app.modules.users.models import User

        for index, holdings in enumerate(holdings_by_user):
            user = User(
                id=uuid.uuid4(), email=f"{uuid.uuid4()}@example.com", name="U",
                hashed_password="x", is_active=True,
            )
            async_session.add(user)
            await async_session.flush()
            portfolio = Portfolio(
                id=uuid.uuid4(), user_id=user.id, name="P", is_default=True, currency="TWD"
            )
            async_session.add(portfolio)
            await async_session.flush()
            for symbol, label in holdings:
                async_session.add(PortfolioHolding(
                    id=uuid.uuid4(), portfolio_id=portfolio.id, user_id=user.id,
                    symbol=symbol, name=symbol, quantity=Decimal("1"),
                    average_cost=Decimal("1"), current_price=Decimal("1"),
                    currency="TWD", market=label, type="stock", exchange="X",
                    total_cost=Decimal("1"), total_value=Decimal("1"),
                    purchase_date=date(2026, 9, 1), is_active=True,
                ))
        await async_session.commit()

        @asynccontextmanager
        async def same_session():
            yield async_session

        fetched = []

        async def fake_price(self, symbol, market, allow_historical_fallback=True):
            fetched.append(symbol)
            return Decimal("100")

        with patch.object(scheduler, "async_session", same_session), \
             patch.object(PriceUpdateService, "_get_price_with_fallback", fake_price), \
             patch.object(MarketHoursManager, "should_update_price", return_value=True), \
             patch("app.modules.portfolio.price_update_service.get_market_data_service") as mds:
            mds.return_value.get_previous_close = AsyncMock(return_value=None)
            stats = await scheduler.update_all_users_prices(market)
        return sorted(fetched), stats

    MIXED = [[("0050", "TW"), ("2330", "US"), ("AAPL", "US"), ("BTC-USD", "CRYPTO"), ("D05", "SG")]]

    @pytest.mark.asyncio
    async def test_tw_job_only_touches_tw_symbols(self, async_session):
        fetched, _ = await self._job_prices(async_session, "TW", self.MIXED)
        assert fetched == ["0050", "2330"]

    @pytest.mark.asyncio
    async def test_us_job_also_covers_markets_without_a_job(self, async_session):
        fetched, _ = await self._job_prices(async_session, "US", self.MIXED)
        assert fetched == ["AAPL", "D05"]

    @pytest.mark.asyncio
    async def test_all_job_touches_every_market(self, async_session):
        fetched, _ = await self._job_prices(async_session, "ALL", self.MIXED)
        assert fetched == ["0050", "2330", "AAPL", "BTC-USD", "D05"]

    @pytest.mark.asyncio
    async def test_tw_code_labelled_us_is_priced_without_any_tw_label(self, async_session):
        fetched, stats = await self._job_prices(
            async_session, "TW", [[("2330", "US"), ("AAPL", "US")]]
        )
        assert fetched == ["2330"]
        assert (stats["users"], stats["updated"]) == (1, 1)

    @pytest.mark.asyncio
    async def test_sg_only_user_is_priced_by_the_us_job(self, async_session):
        fetched, stats = await self._job_prices(
            async_session, "US", [[("D05", "SG")], [("0050", "TW")]]
        )
        assert fetched == ["D05"]
        assert stats["users"] == 1

    @pytest.mark.asyncio
    async def test_lowercase_crypto_label_routes_to_the_crypto_job(self, async_session):
        holdings = [[("BTC-USD", "crypto")]]
        assert (await self._job_prices(async_session, "CRYPTO", holdings))[0] == ["BTC-USD"]
        assert (await self._job_prices(async_session, "US", holdings))[0] == []


# Run with: pytest tests/test_price_update_service.py -v
# Run with coverage: pytest tests/test_price_update_service.py --cov=app.modules.portfolio.price_update_service
