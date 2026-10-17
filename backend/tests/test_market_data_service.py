"""
Unit tests for Market Data Service

Tests cover:
- API timeout handling
- Retry logic
- Error handling and fallbacks
- Cache behavior
- FinLab market-level caching
- Symbol mismatch handling
"""

import sys
import pytest
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

from app.modules.portfolio.market_data_service import (
    MarketDataService,
    _get_cache_ttl_until_market_close,
    clear_finlab_market_cache,
    get_finlab_cache_status,
    to_bare_tw_symbol,
    to_yahoo_tw_symbol,
    _parse_twse_row,
)
from app.utils.datetime_helpers import business_today
from app.utils.datetime_helpers import utc_now


class TestMarketDataService:
    """Test suite for market data service"""

    @pytest.fixture
    def service(self):
        """Create market data service instance"""
        return MarketDataService(
            finlab_token="test-token",
            tradingview_key="test-key",
            enable_finlab=True,
            enable_tradingview=True,
            enable_yahoo=True,
        )

    @pytest.mark.asyncio
    async def test_get_current_price_prefers_realtime_quote(self, service):
        """Current price should come from the live quote, not the daily history.

        Regression: the daily history frame lags the live market (its latest row
        can be the prior session's close or a NaN we drop), so deriving current
        price from history[-1] surfaced a stale value (e.g. 0050 at 104.45
        instead of the live 107.80).
        """
        with patch.object(service, '_get_realtime_price', new_callable=AsyncMock,
                          return_value=Decimal("107.80")) as mock_rt:
            with patch.object(service, 'get_historical_data',
                              new_callable=AsyncMock) as mock_hist:
                price = await service.get_current_price("0050", "TW")
                assert price == Decimal("107.80")
                assert mock_rt.called
                # History must not be consulted when a live quote is available
                assert not mock_hist.called

    @pytest.mark.asyncio
    async def test_get_current_price_falls_back_to_history(self, service):
        """When no live quote is available, fall back to the latest historical close"""
        mock_history = [{"date": "2026-06-29", "close": 104.45, "open": 103.0,
                         "high": 105.0, "low": 102.5, "volume": 1000000}]
        with patch.object(service, '_get_realtime_price', new_callable=AsyncMock,
                          return_value=None):
            with patch.object(service, 'get_historical_data',
                              new_callable=AsyncMock, return_value=mock_history):
                price = await service.get_current_price("AAPL", "US")
                assert price == Decimal("104.45")

    @pytest.mark.asyncio
    async def test_get_current_price_fallback_to_yahoo(self, service):
        """Should fallback to real-time Yahoo if historical data unavailable"""
        with patch.object(service, 'get_historical_data', return_value=[]):
            with patch.object(service, '_get_finlab_current_price',
                              new_callable=AsyncMock, return_value=None):
                with patch.object(service, '_get_yahoo_current_price',
                                  new_callable=AsyncMock,
                                  return_value=Decimal("125.50")) as mock_yahoo:
                    price = await service.get_current_price("0050", "TW")
                    assert price == Decimal("125.50")
                    assert mock_yahoo.called

    @pytest.mark.asyncio
    async def test_get_current_price_skip_cash_symbols(self, service):
        """Should skip API calls for cash symbols"""
        price = await service.get_current_price("CASH-TWD", "TW")
        assert price is None

        price = await service.get_current_price("USD-SAVINGS", "US")
        assert price is None

    @pytest.mark.asyncio
    async def test_get_current_price_timeout_raises_exception(self, service):
        """Should handle timeout gracefully — returns None, does not crash"""
        with patch.object(service, '_get_realtime_price',
                          side_effect=asyncio.TimeoutError("API timeout")):
            price = await service.get_current_price("0050", "TW")
            assert price is None

    @pytest.mark.asyncio
    async def test_get_current_price_returns_none_on_all_failures(self, service):
        """Should return None if historical + all real-time providers fail"""
        with patch.object(service, 'get_historical_data', return_value=[]):
            with patch.object(service, '_get_finlab_current_price',
                              new_callable=AsyncMock, return_value=None):
                with patch.object(service, '_get_yahoo_current_price',
                                  new_callable=AsyncMock, return_value=None):
                    price = await service.get_current_price("INVALID", "TW")
                    assert price is None


class TestFinLabCaching:
    """Test FinLab market-level caching behavior"""

    @pytest.fixture
    def service(self):
        return MarketDataService(finlab_token="test-token")

    @pytest.mark.asyncio
    async def test_finlab_cache_reused_for_multiple_symbols(self, service):
        """Should make 5 API calls for first symbol, 0 for subsequent"""
        import pandas as pd
        clear_finlab_market_cache()  # ensure clean state

        # Use recent dates so they fall within the `days=5` window
        today = business_today()
        recent_dates = pd.date_range(end=today, periods=3)
        mock_df = pd.DataFrame({
            "0050": [125.0, 126.0, 127.0],
            "2330": [600.0, 605.0, 610.0],
        }, index=recent_dates)

        mock_data = MagicMock()
        mock_data.get.return_value = mock_df

        mock_finlab_mod = MagicMock()
        mock_finlab_mod.data = mock_data  # 'from finlab import data' → mock_data

        # finlab is lazy-imported inside the method; patch via sys.modules
        with patch.dict(sys.modules, {'finlab': mock_finlab_mod}):
            # First call: should fetch market data (5 API calls for OHLCV)
            result1 = await service._get_finlab_historical("0050", days=5)
            api_calls_first = mock_data.get.call_count

            # Second call: should reuse cached DataFrames (0 extra calls)
            result2 = await service._get_finlab_historical("2330", days=5)
            api_calls_second = mock_data.get.call_count

            assert len(result1) > 0
            assert len(result2) > 0
            assert api_calls_second == api_calls_first  # No additional calls

    @pytest.mark.asyncio
    async def test_finlab_cache_expires_after_ttl(self, service):
        """Cache should expire after TTL"""
        clear_finlab_market_cache()

        # Verify cache is empty
        status = get_finlab_cache_status()
        assert status['is_cached'] == False

    @pytest.mark.asyncio
    async def test_finlab_symbol_not_found_returns_empty(self, service):
        """Should return empty list if symbol not in FinLab dataset"""
        import pandas as pd
        clear_finlab_market_cache()

        # Dataset without symbol "9999"
        from datetime import date as _date
        recent_dates = pd.date_range(end=_date.today(), periods=2)
        mock_df = pd.DataFrame({
            "0050": [125.0, 126.0],
        }, index=recent_dates)

        mock_data = MagicMock()
        mock_data.get.return_value = mock_df

        mock_finlab_mod = MagicMock()
        mock_finlab_mod.data = mock_data

        with patch.dict(sys.modules, {'finlab': mock_finlab_mod}):
            result = await service._get_finlab_historical("9999", days=5)
            assert result == []

    @pytest.mark.asyncio
    async def test_finlab_timeout_does_not_start_second_fetch(self, service):
        """A caller timing out must NOT let the next caller start a new fetch.

        Regression (Railway OOM, Jul 2026): the market fetch thread can't be
        cancelled, so when caller #1 timed out, its thread kept parsing full
        market tables while caller #2 started a second whole-market fetch —
        two ~100MB+ parses in RAM at once killed the 512MB host. The fetch is
        now single-flight: later callers wait on the same in-flight task, and
        its result still lands in the cache after every caller has timed out.
        """
        import time
        import pandas as pd
        import app.modules.portfolio.market_data_service as mds

        clear_finlab_market_cache()

        recent_dates = pd.date_range(end=datetime.now(), periods=3)
        frame = pd.DataFrame(
            {"0050": [125.0, 126.0, 127.0],
             "006208": [95.0, 96.0, 97.0],
             "2330": [900.0, 910.0, 920.0]},
            index=recent_dates,
        )
        fetch_calls = 0

        def slow_fetch(token, window_start):
            nonlocal fetch_calls
            fetch_calls += 1
            time.sleep(0.5)  # longer than the patched caller timeout
            return {k: frame.copy() for k in ("close", "open", "high", "low", "volume")}

        with patch.dict(sys.modules, {'finlab': MagicMock()}):
            with patch.object(mds, '_fetch_finlab_market_window', side_effect=slow_fetch):
                with patch.object(mds, 'FINLAB_FETCH_TIMEOUT_SECONDS', 0.1):
                    with patch.object(mds, '_sym_cache_get', return_value=None):
                        # Caller 1 times out; the fetch keeps running.
                        result1 = await service._get_finlab_historical("0050", days=5)
                        assert result1 == []
                        assert fetch_calls == 1

                        # Caller 2 must join the in-flight fetch, not start its own.
                        result2 = await service._get_finlab_historical("006208", days=5)
                        assert result2 == []
                        assert fetch_calls == 1

                        # Let the background fetch land its frames in the cache.
                        task = mds._finlab_market_cache["fetch_task"]
                        assert task is not None
                        await task

                        # Cache is populated: next symbol is served with no new fetch.
                        result3 = await service._get_finlab_historical("2330", days=5)
                        assert len(result3) > 0
                        assert fetch_calls == 1

        clear_finlab_market_cache()

    @pytest.mark.asyncio
    async def test_finlab_failure_arms_cooldown(self, service):
        """After a failed fetch, don't re-fetch immediately — fail fast to Yahoo.

        Back-to-back re-fetches of the whole market are ~100MB+ each; on a
        memory-capped host the retry is more dangerous than the miss.
        """
        import app.modules.portfolio.market_data_service as mds

        clear_finlab_market_cache()

        fetch_calls = 0

        def failing_fetch(token, window_start):
            nonlocal fetch_calls
            fetch_calls += 1
            raise RuntimeError("boom")

        with patch.dict(sys.modules, {'finlab': MagicMock()}):
            with patch.object(mds, '_fetch_finlab_market_window', side_effect=failing_fetch):
                with patch.object(mds, '_sym_cache_get', return_value=None):
                    result1 = await service._get_finlab_historical("0050", days=5)
                    assert result1 == []
                    assert fetch_calls == 1
                    assert mds._finlab_market_cache["failed_at"] is not None

                    # Within the cooldown window: no new fetch is attempted.
                    result2 = await service._get_finlab_historical("2330", days=5)
                    assert result2 == []
                    assert fetch_calls == 1

                    # Once the cooldown expires, fetching is allowed again.
                    # Aware, like the code that writes it: the cooldown compares
                    # against utc_now(), and a naive value here raises inside the
                    # fetch's except, so the cooldown would silently never expire.
                    mds._finlab_market_cache["failed_at"] = utc_now() - timedelta(
                        seconds=mds.FINLAB_FETCH_COOLDOWN_SECONDS + 1
                    )
                    result3 = await service._get_finlab_historical("0050", days=5)
                    assert result3 == []
                    assert fetch_calls == 2

        clear_finlab_market_cache()


class TestYahooFinanceFallback:
    """Test Yahoo Finance fallback and caching"""

    @pytest.fixture
    def service(self):
        return MarketDataService(enable_yahoo=True)

    @pytest.mark.asyncio
    async def test_yahoo_cache_hit_returns_cached_data(self, service):
        """Should return cached data without API call"""
        cached = [{"date": "2026-03-31", "close": 125.0, "open": 124.0, "high": 126.0, "low": 123.0, "volume": 1000}]
        with patch('app.modules.portfolio.market_data_service._sym_cache_get', return_value=cached) as mock_cache_get:
            result = await service._get_yahoo_historical("0050.TW", days=5)

            assert len(result) == 1
            assert result[0]['close'] == 125.0
            assert mock_cache_get.called == True

    @pytest.mark.asyncio
    async def test_yahoo_empty_history_returns_empty(self, service):
        """Should handle empty history from Yahoo"""
        import pandas as pd

        mock_ticker = MagicMock()
        mock_ticker.history.return_value = pd.DataFrame()  # Empty DataFrame

        mock_yf_mod = MagicMock()
        mock_yf_mod.Ticker.return_value = mock_ticker

        # yfinance is lazy-imported; patch via sys.modules
        with patch.dict(sys.modules, {'yfinance': mock_yf_mod}):
            with patch('app.modules.portfolio.market_data_service._sym_cache_get', return_value=None):
                result = await service._get_yahoo_historical("INVALID", days=5)
                assert result == []

    @pytest.mark.asyncio
    async def test_yahoo_api_error_returns_empty(self, service):
        """Should handle Yahoo API errors gracefully"""
        mock_yf_mod = MagicMock()
        mock_yf_mod.Ticker.side_effect = Exception("API error")

        with patch.dict(sys.modules, {'yfinance': mock_yf_mod}):
            result = await service._get_yahoo_historical("AAPL", days=5)
            assert result == []

    @pytest.mark.asyncio
    async def test_yahoo_current_price_uses_live_quote(self, service):
        """Current price should use fast_info.last_price, not the lagging history.

        Regression: Yahoo's daily history had a NaN row for the current day so
        history[-1] returned the prior session's close (104.45) while the live
        quote correctly reported 107.80.
        """
        import pandas as pd

        mock_ticker = MagicMock()
        mock_ticker.fast_info = {"last_price": 107.8}
        # A stale/NaN daily history that must NOT be used while a live quote exists
        mock_ticker.history.return_value = pd.DataFrame({"Close": [104.45, float("nan")]})

        mock_yf_mod = MagicMock()
        mock_yf_mod.Ticker.return_value = mock_ticker

        with patch.dict(sys.modules, {'yfinance': mock_yf_mod}):
            with patch('app.modules.portfolio.market_data_service._sym_cache_get',
                       return_value=None):
                with patch('app.modules.portfolio.market_data_service._sym_cache_set'):
                    price = await service._get_yahoo_current_price("0050.TW")
                    assert price == Decimal("107.8")

    @pytest.mark.asyncio
    async def test_yahoo_current_price_falls_back_to_history(self, service):
        """When no live quote is available, use the latest historical close"""
        mock_ticker = MagicMock()
        mock_ticker.fast_info = {}  # no last_price → forces history fallback

        mock_yf_mod = MagicMock()
        mock_yf_mod.Ticker.return_value = mock_ticker

        history = [{"date": "2026-06-29", "close": 104.45, "open": 103.0,
                    "high": 105.0, "low": 102.5, "volume": 1000}]

        with patch.dict(sys.modules, {'yfinance': mock_yf_mod}):
            with patch('app.modules.portfolio.market_data_service._sym_cache_get',
                       return_value=None):
                with patch('app.modules.portfolio.market_data_service._sym_cache_set'):
                    with patch.object(service, '_get_yahoo_historical',
                                      new_callable=AsyncMock, return_value=history):
                        price = await service._get_yahoo_current_price("0050.TW")
                        assert price == Decimal("104.45")


class TestHistoricalDataFetching:
    """Test historical data fetching logic"""

    @pytest.fixture
    def service(self):
        return MarketDataService(
            finlab_token="test-token",
            tradingview_key="test-key",
            enable_finlab=True,
            enable_tradingview=True,
            enable_yahoo=True,
        )

    @pytest.mark.asyncio
    async def test_get_historical_data_tw_uses_finlab(self, service):
        """Taiwan stocks should use FinLab"""
        with patch.object(service, '_get_finlab_historical') as mock_finlab:
            mock_finlab.return_value = [{"date": "2026-03-31", "close": 125.0}]

            result = await service.get_historical_data("0050", "TW", days=30)

            assert len(result) == 1
            assert mock_finlab.called == True

    @pytest.mark.asyncio
    async def test_get_historical_data_tw_fallback_to_yahoo(self, service):
        """Should fallback to Yahoo if FinLab fails"""
        with patch.object(service, '_get_finlab_historical', return_value=[]):
            with patch.object(service, '_get_yahoo_historical') as mock_yahoo:
                mock_yahoo.return_value = [{"date": "2026-03-31", "close": 125.0}]

                result = await service.get_historical_data("0050", "TW", days=30)

                assert len(result) == 1
                assert mock_yahoo.called == True

    @pytest.mark.asyncio
    async def test_get_historical_data_us_uses_tradingview(self, service):
        """US stocks should use TradingView"""
        with patch.object(service, '_get_tradingview_historical') as mock_tv:
            mock_tv.return_value = [{"date": "2026-03-31", "close": 180.0}]

            result = await service.get_historical_data("AAPL", "US", days=30)

            assert len(result) == 1
            assert mock_tv.called == True

    @pytest.mark.asyncio
    async def test_get_historical_data_crypto_uses_yahoo(self, service):
        """Crypto should use Yahoo Finance"""
        with patch.object(service, '_get_yahoo_historical') as mock_yahoo:
            mock_yahoo.return_value = [{"date": "2026-03-31", "close": 60000.0}]

            result = await service.get_historical_data("BTC-USD", "CRYPTO", days=30)

            assert len(result) == 1
            assert mock_yahoo.called == True

    @pytest.mark.asyncio
    async def test_get_historical_data_skip_cash_symbols(self, service):
        """Should skip cash symbols"""
        result = await service.get_historical_data("CASH-TWD", "TW", days=30)
        assert result == []


class TestBatchPriceFetching:
    """Test batch price fetching"""

    @pytest.fixture
    def service(self):
        return MarketDataService(finlab_token="test-token")

class TestCacheTTLCalculation:
    """Test cache TTL calculation"""

    def test_cache_ttl_before_market_close(self):
        """TTL should be until market close"""
        from zoneinfo import ZoneInfo

        with patch('app.modules.portfolio.market_data_service.datetime') as mock_dt:
            # 11:00 TST (2.5 hours until 13:30 close)
            mock_now = datetime(2026, 4, 1, 11, 0, 0, tzinfo=ZoneInfo("Asia/Taipei"))
            mock_dt.now.return_value = mock_now

            ttl = _get_cache_ttl_until_market_close()

            # Should be ~2.5 hours (9000 seconds)
            assert 8000 <= ttl <= 10000

    def test_cache_ttl_after_market_close(self):
        """TTL should be until next trading day close"""
        from zoneinfo import ZoneInfo

        with patch('app.modules.portfolio.market_data_service.datetime') as mock_dt:
            # 15:00 TST (after 13:30 close)
            mock_now = datetime(2026, 4, 1, 15, 0, 0, tzinfo=ZoneInfo("Asia/Taipei"))
            mock_dt.now.return_value = mock_now

            ttl = _get_cache_ttl_until_market_close()

            # Should be capped at 24 hours
            assert ttl <= 86400

    def test_cache_ttl_minimum_1_hour(self):
        """TTL should be at least 1 hour"""
        from zoneinfo import ZoneInfo

        with patch('app.modules.portfolio.market_data_service.datetime') as mock_dt:
            # 13:25 TST (5 minutes until close)
            mock_now = datetime(2026, 4, 1, 13, 25, 0, tzinfo=ZoneInfo("Asia/Taipei"))
            mock_dt.now.return_value = mock_now

            ttl = _get_cache_ttl_until_market_close()

            # Should be at least 1 hour (3600 seconds)
            assert ttl >= 3600


class TestErrorHandling:
    """Test error handling and edge cases"""

    @pytest.fixture
    def service(self):
        return MarketDataService(finlab_token="test-token")

    @pytest.mark.asyncio
    async def test_get_current_price_handles_exception(self, service):
        """Should handle unexpected exceptions gracefully"""
        with patch.object(service, '_get_realtime_price') as mock_realtime:
            mock_realtime.side_effect = Exception("Unexpected error")

            price = await service.get_current_price("0050", "TW")

            # Should return None instead of crashing
            assert price is None

    @pytest.mark.asyncio
    async def test_finlab_import_error_returns_empty(self, service):
        """Should handle ImportError if finlab not installed"""
        clear_finlab_market_cache()
        # Simulate finlab not being importable; also stub Yahoo fallback so no
        # real network call is made and the "no finlab" path returns empty.
        with patch.dict(sys.modules, {'finlab': None}):
            with patch.object(service, '_get_yahoo_historical', return_value=[]):
                result = await service._get_finlab_historical("0050", days=5)
                assert result == []

    @pytest.mark.asyncio
    async def test_yahoo_import_error_returns_empty(self, service):
        """Should handle ImportError if yfinance not installed"""
        with patch('builtins.__import__', side_effect=ImportError):
            result = await service._get_yahoo_historical("AAPL", days=5)

            assert result == []


class TestTaiwanSymbolNormalization:
    """TW tickers arrive both bare ("0050") and Yahoo-style ("0050.TW").

    FinLab keys its market DataFrames by bare code while Yahoo requires the
    exchange suffix, so passing a symbol through unnormalised makes one of the
    two providers report the ticker as unknown — which leaves a gap in the
    stored price history and a wrong day-change percentage downstream.
    """

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "symbol,expected",
        [
            ("0050", "0050"),
            ("0050.TW", "0050"),
            ("2330.TWO", "2330"),
            ("AAPL", "AAPL"),
        ],
    )
    def test_to_bare_tw_symbol(self, symbol, expected):
        assert to_bare_tw_symbol(symbol) == expected

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "symbol,expected",
        [
            ("0050", "0050.TW"),
            # Idempotent — must not produce "0050.TW.TW".
            ("0050.TW", "0050.TW"),
            ("2330.TWO", "2330.TWO"),
        ],
    )
    def test_to_yahoo_tw_symbol(self, symbol, expected):
        assert to_yahoo_tw_symbol(symbol) == expected

    @pytest.mark.asyncio
    async def test_twse_fills_a_session_both_feeds_dropped(self):
        """TWSE is the last resort when FinLab and Yahoo both come back empty.

        Neither commercial feed had 0050's 2026-08-13 bar; the exchange
        publishes it as 106.70. Without this link the hole persists and every
        chart and day change spanning it is wrong.
        """
        service = MarketDataService(
            finlab_token=None, enable_finlab=False, enable_yahoo=True
        )
        twse_bars = [
            {"date": "2026-08-13", "open": 106.5, "high": 107.0,
             "low": 106.0, "close": 106.7, "volume": 1, "source": "twse"},
        ]

        with patch.object(service, "_get_yahoo_historical", return_value=[]):
            with patch.object(
                service, "_get_twse_historical", return_value=twse_bars
            ) as mock_twse:
                result = await service.get_historical_data("0050", "TW", days=10)

        mock_twse.assert_awaited_once()
        assert result == twse_bars

    @pytest.mark.asyncio
    async def test_twse_not_consulted_when_yahoo_succeeds(self):
        """The exchange is a fallback, not a default — it is slow and throttled."""
        service = MarketDataService(
            finlab_token=None, enable_finlab=False, enable_yahoo=True
        )
        yahoo_bars = [{"date": "2026-08-13", "close": 106.7}]

        with patch.object(service, "_get_yahoo_historical", return_value=yahoo_bars):
            with patch.object(service, "_get_twse_historical") as mock_twse:
                result = await service.get_historical_data("0050", "TW", days=10)

        mock_twse.assert_not_called()
        assert result == yahoo_bars

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "row,expected_date,expected_close",
        [
            # Republic-of-China year: 115 + 1911 = 2026. Thousands separators.
            (
                ["115/08/13", "12,345", "1,000", "106.50", "107.00",
                 "106.00", "106.70", "+0.10", "5000"],
                "2026-08-13",
                106.7,
            ),
            (["115/01/02", "1", "1", "1.0", "1.0", "1.0", "99.95", "0", "1"],
             "2026-01-02", 99.95),
        ],
    )
    def test_parse_twse_row(self, row, expected_date, expected_close):
        parsed = _parse_twse_row(row)
        assert parsed is not None
        assert parsed["date"] == expected_date
        assert parsed["close"] == expected_close
        assert parsed["source"] == "twse"

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "row",
        [
            # Suspended / no trades — "--" must not become a bar.
            ["115/08/13", "0", "0", "--", "--", "--", "--", "0", "0"],
            ["115/08/13", "0", "0", "1.0", "1.0", "1.0", "0.00", "0", "0"],
            ["not-a-date", "1", "1", "1", "1", "1", "1", "0", "1"],
            ["115/08/13"],  # truncated
            [],
        ],
    )
    def test_parse_twse_row_rejects_non_bars(self, row):
        assert _parse_twse_row(row) is None

    @pytest.mark.asyncio
    async def test_finlab_historical_looks_up_bare_code(self):
        """A "0050.TW" holding must find the "0050" column in FinLab data.

        Regression: the suffixed form logged "Symbol 0050.TW not found in
        dataset" and stored nothing, so the holding's history stopped updating
        while its current price kept ticking.
        """
        import pandas as pd

        service = MarketDataService(
            finlab_token="test-token", enable_finlab=True, enable_yahoo=False
        )
        clear_finlab_market_cache()

        recent_dates = pd.date_range(end=business_today(), periods=3)
        mock_df = pd.DataFrame({"0050": [104.6, 105.2, 106.4]}, index=recent_dates)

        mock_data = MagicMock()
        mock_data.get.return_value = mock_df
        mock_finlab_mod = MagicMock()
        mock_finlab_mod.data = mock_data

        with patch.dict(sys.modules, {"finlab": mock_finlab_mod}):
            result = await service._get_finlab_historical("0050.TW", days=5)

        assert result, "suffixed TW symbol should resolve to the bare column"
        assert len(result) == 3


# Run with: pytest tests/test_market_data_service.py -v
# Run with coverage: pytest tests/test_market_data_service.py --cov=app.modules.portfolio.market_data_service
