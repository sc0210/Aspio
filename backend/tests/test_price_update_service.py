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
        """Should update if market closed and not updated since the last settled close"""
        last_update = datetime.now(ZoneInfo("UTC")) - timedelta(days=1)

        with patch.object(MarketHoursManager, 'is_market_open', return_value=False):
            with patch("app.modules.portfolio.price_update_service.last_settled_close",
                       return_value=datetime.now(ZoneInfo("UTC"))):
                result = MarketHoursManager.should_update_price("TW", last_update)
                assert result == True

    @pytest.mark.parametrize("now_taipei,last_taipei,due", [
        # A write in the minutes after the bell is mid-auction, not the close:
        # once the grace period passes the close is due again.
        ("2026-05-13 14:05", "2026-05-13 13:45", True),
        # Updated after today's settled close (13:30 + 30 min): nothing to do.
        ("2026-05-13 16:00", "2026-05-13 14:10", False),
        # Before the open the latest close is yesterday's: a write after it is
        # current, so a pre-open refresh does not refetch every lot.
        ("2026-05-13 08:00", "2026-05-12 22:00", False),
        ("2026-05-13 08:00", "2026-05-12 13:40", True),
        # Weekend: Friday's settled close decides.
        ("2026-05-16 11:00", "2026-05-15 15:00", False),
        ("2026-05-16 11:00", "2026-05-15 13:50", True),
    ])
    def test_closed_market_gate_follows_the_last_settled_close(self, now_taipei, last_taipei, due):
        tz = ZoneInfo("Asia/Taipei")
        now = datetime.strptime(now_taipei, "%Y-%m-%d %H:%M").replace(tzinfo=tz)
        last = datetime.strptime(last_taipei, "%Y-%m-%d %H:%M").replace(tzinfo=tz)
        with patch("app.modules.portfolio.price_update_service.datetime") as mock_dt:
            mock_dt.now.side_effect = lambda zone=None: now.astimezone(zone) if zone else now
            mock_dt.combine = datetime.combine
            assert MarketHoursManager.should_update_price("TW", last) is due

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


async def _seed_lots(session, lots, *, user_id=None):
    """One user, one portfolio, the given lots; returns (user_id, [lots])."""
    import uuid
    from datetime import date
    from app.modules.portfolio.models import Portfolio
    from app.modules.users.models import User

    if user_id is None:
        user = User(id=uuid.uuid4(), email=f"{uuid.uuid4()}@example.com", name="U",
                    hashed_password="x", is_active=True)
        session.add(user)
        await session.flush()
        user_id = user.id
    portfolio = Portfolio(id=uuid.uuid4(), user_id=user_id, name=f"P{uuid.uuid4()}",
                          is_default=False, currency="TWD")
    session.add(portfolio)
    await session.flush()
    rows = []
    for lot in lots:
        qty = Decimal(lot.get("qty", "10"))
        avg = Decimal(lot.get("avg", "100"))
        price = Decimal(lot.get("price", "100"))
        row = PortfolioHolding(
            id=uuid.uuid4(), portfolio_id=portfolio.id, user_id=user_id,
            symbol=lot["symbol"], name=lot["symbol"], quantity=qty, average_cost=avg,
            current_price=price, previous_close=lot.get("prev"),
            currency="TWD", market=lot.get("market", "TW"), type=lot.get("type", "stock"),
            exchange="X", total_cost=qty * avg, total_value=qty * price,
            purchase_date=date(2026, 9, 1), is_active=True,
            last_price_update_at=lot.get("stamp"),
        )
        session.add(row)
        rows.append(row)
    await session.commit()
    return user_id, rows


class TestPerUserRefresh:
    """update_portfolio_prices: one user's refresh, written through apply_quote."""

    OLD = datetime(2026, 1, 5, 6, 0, tzinfo=ZoneInfo("UTC"))

    @pytest.mark.asyncio
    async def test_fetches_each_symbol_once_and_writes_derived_columns(self, async_session):
        user_id, (a, b, c) = await _seed_lots(async_session, [
            dict(symbol="0050"), dict(symbol="0050", qty="5"), dict(symbol="2330"),
        ])
        service = PriceUpdateService(async_session)
        with patch.object(service, "_fetch_live_quote", new_callable=AsyncMock,
                          return_value=(Decimal("150"), Decimal("140"))) as fetch:
            stats = await service.update_portfolio_prices(user_id, force=True)

        assert sorted(call.args[0] for call in fetch.call_args_list) == ["0050", "2330"]
        assert stats["updated"] == 3
        for lot in (a, b, c):
            await async_session.refresh(lot)
            assert lot.current_price == Decimal("150")
            assert lot.total_value == lot.quantity * Decimal("150")
            assert lot.total_cost == lot.quantity * lot.average_cost
            assert lot.previous_close == Decimal("140")

    @pytest.mark.asyncio
    async def test_a_failed_fetch_writes_nothing_and_stamps_nothing(self, async_session):
        """It used to write the stored price back with a fresh stamp, so the gate
        stopped retrying and every user's scheduled refresh skipped the symbol."""
        user_id, (lot,) = await _seed_lots(async_session, [
            dict(symbol="0050", price="100", stamp=self.OLD),
        ])
        service = PriceUpdateService(async_session)
        with patch.object(service.market_data_service, "get_current_price",
                          new_callable=AsyncMock, return_value=None):
            stats = await service.update_portfolio_prices(user_id, force=True)

        await async_session.refresh(lot)
        assert stats["failed"] == 1 and stats["updated"] == 0
        assert lot.current_price == Decimal("100")
        assert lot.last_price_update_at.replace(tzinfo=None) == self.OLD.replace(tzinfo=None)

    @pytest.mark.asyncio
    async def test_a_sale_during_the_quote_wait_is_respected(self, async_session):
        """The refresh used to compute value and cost from the quantity it read
        before the network wait, overwriting a sale that committed meanwhile."""
        user_id, (lot,) = await _seed_lots(async_session, [dict(symbol="0050", qty="10")])
        service = PriceUpdateService(async_session)

        async def sale_lands_while_waiting(symbol, market):
            # Another request sells 6 and commits while this one waits on Yahoo.
            from sqlalchemy import update as sa_update
            await async_session.execute(
                sa_update(PortfolioHolding).where(PortfolioHolding.id == lot.id)
                .values(quantity=Decimal("4"), total_cost=Decimal("400"))
            )
            await async_session.commit()
            return Decimal("120"), None

        with patch.object(service, "_fetch_live_quote", side_effect=sale_lands_while_waiting):
            await service.update_portfolio_prices(user_id, force=True)

        await async_session.refresh(lot)
        assert lot.quantity == Decimal("4")
        assert lot.total_value == Decimal("480")
        assert lot.total_cost == Decimal("400")

    @pytest.mark.asyncio
    async def test_an_older_quote_never_overwrites_a_newer_one(self, async_session):
        later = datetime.now(ZoneInfo("UTC")) + timedelta(hours=1)
        _, (lot,) = await _seed_lots(async_session, [
            dict(symbol="0050", price="130", stamp=later),
        ])
        written = await PriceUpdateService(async_session).apply_quote(
            "0050", Decimal("99"), None, datetime.now(ZoneInfo("UTC"))
        )
        await async_session.commit()
        await async_session.refresh(lot)
        assert written == 0
        assert lot.current_price == Decimal("130")

    @pytest.mark.asyncio
    async def test_a_missing_previous_close_is_cleared_not_kept(self, async_session):
        """Kept beside a new price it could be days old: a multi-day move shown
        as today's change."""
        _, (lot,) = await _seed_lots(async_session, [
            dict(symbol="0050", prev=Decimal("80")),
        ])
        await PriceUpdateService(async_session).apply_quote(
            "0050", Decimal("110"), None, datetime.now(ZoneInfo("UTC"))
        )
        await async_session.commit()
        await async_session.refresh(lot)
        assert lot.current_price == Decimal("110")
        assert lot.previous_close is None

    @pytest.mark.asyncio
    async def test_the_stalest_lot_decides_whether_a_symbol_is_due(self, async_session):
        """A lot refreshed a minute ago must not hide an older sibling."""
        now = datetime.now(ZoneInfo("UTC"))
        user_id, _ = await _seed_lots(async_session, [
            dict(symbol="0050", stamp=now), dict(symbol="0050", stamp=self.OLD),
        ])
        service = PriceUpdateService(async_session)
        seen = []

        def gate(market, last_update):
            seen.append(last_update)
            return False

        with patch.object(service.market_hours_manager, "should_update_price", gate):
            await service.update_portfolio_prices(user_id)

        assert [s.replace(tzinfo=None) for s in seen] == [self.OLD.replace(tzinfo=None)]

    @pytest.mark.asyncio
    async def test_manually_priced_lots_are_left_alone(self, async_session):
        user_id, (cash,) = await _seed_lots(async_session, [
            dict(symbol="USDC", type="lending", price="1.02"),
        ])
        service = PriceUpdateService(async_session)
        with patch.object(service, "_fetch_live_quote", new_callable=AsyncMock) as fetch:
            stats = await service.update_portfolio_prices(user_id, force=True)
        assert fetch.call_count == 0
        assert stats["total"] == 0 and stats["skipped"] == 1


class TestRefreshTransactionOwnership:
    @pytest.mark.asyncio
    async def test_a_callers_open_transaction_is_not_committed_early(self, async_session):
        """Flushed rows leave session.new/dirty empty, so only "was a transaction
        already open" tells whether the caller has work in flight."""
        from sqlalchemy import select as sa_select
        user_id, _ = await _seed_lots(async_session, [dict(symbol="0050")])
        await async_session.execute(sa_select(1))  # the caller's transaction
        service = PriceUpdateService(async_session)
        during_fetch = []

        async def fetch(symbol, market):
            during_fetch.append(async_session.in_transaction())
            return None

        with patch.object(service, "_fetch_live_quote", side_effect=fetch):
            await service.update_portfolio_prices(user_id, force=True)
        assert during_fetch == [True]

    @pytest.mark.asyncio
    async def test_its_own_read_transaction_is_released_before_the_wait(self, async_session):
        user_id, _ = await _seed_lots(async_session, [dict(symbol="0050")])
        service = PriceUpdateService(async_session)
        during_fetch = []

        async def fetch(symbol, market):
            during_fetch.append(async_session.in_transaction())
            return None

        with patch.object(service, "_fetch_live_quote", side_effect=fetch):
            await service.update_portfolio_prices(user_id, force=True)
        assert during_fetch == [False]


class TestSchedulerTotalsSync:
    @pytest.mark.asyncio
    async def test_a_failed_portfolio_sync_is_counted_not_hidden(self, async_session):
        await _seed_lots(async_session, [dict(symbol="0050")])
        await _seed_lots(async_session, [dict(symbol="0050")])
        service = PriceUpdateService(async_session)
        from app.modules.portfolio.services import PortfolioService

        with patch.object(service, "_get_price_with_fallback", new_callable=AsyncMock,
                          return_value=Decimal("120")), \
             patch.object(service.market_data_service, "get_previous_close",
                          new_callable=AsyncMock, return_value=None), \
             patch.object(PortfolioService, "_update_portfolio_totals",
                          new_callable=AsyncMock, side_effect=RuntimeError("fx down")):
            stats = await service.update_all_symbols_prices(force=True)

        assert stats["updated"] == 1
        assert (stats["portfolios_synced"], stats["portfolios_failed"]) == (0, 2)


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

    @staticmethod
    def _wire(session, first):
        """First execute() is the symbol query; every later one (per-symbol UPDATE,
        the affected-portfolios read) gets an empty, generic result."""
        def _rest():
            res = MagicMock()
            res.fetchall.return_value = []
            res.all.return_value = []
            res.rowcount = 1
            return res
        calls = {"n": 0}

        async def _execute(*args, **kwargs):
            calls["n"] += 1
            return first if calls["n"] == 1 else _rest()

        session.execute = AsyncMock(side_effect=_execute)

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
        self._wire(mock_session, mock_result)

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
        self._wire(mock_session, mock_result)

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
        sample_result.fetchall.return_value = [("0050", recent, 0)]
        no_shared_quotes = MagicMock()
        no_shared_quotes.scalars.return_value.all.return_value = []
        mock_session.execute.side_effect = [mock_result, sample_result, no_shared_quotes]

        service = PriceUpdateService(mock_session)

        with patch.object(service.market_hours_manager, 'should_update_price', return_value=False):
            with patch.object(service, '_get_price_with_fallback') as mock_price:
                stats = await service.update_all_symbols_prices(force=False)
                assert mock_price.call_count == 0

        assert stats["cached"] == 1
        assert stats["updated"] == 0

    @pytest.mark.asyncio
    async def test_a_failed_commit_loses_one_symbol_not_the_run(self, mock_session):
        """Each symbol commits on its own: a failure rolls back that symbol only
        (it used to roll back every symbol before it, the whole market)."""
        rows = [self._make_symbol_row("AAPL", "US")]
        mock_result = MagicMock()
        mock_result.fetchall.return_value = rows
        self._wire(mock_session, mock_result)
        mock_session.commit.side_effect = Exception("deadlock")

        service = PriceUpdateService(mock_session)

        with patch.object(service, '_get_price_with_fallback', return_value=Decimal("150.0")):
            stats = await service.update_all_symbols_prices(force=True)

        assert mock_session.rollback.called == True
        assert stats["failed"] == 1 and stats["updated"] == 0

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
        self._wire(mock_session, mock_result)

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
        # The freshness query selects (symbol, MIN(last_price_update_at), count of
        # never-priced lots) and is read positionally.
        stale_rows = [(s, (last_updates or {}).get(s), 0) for s, _ in symbols]
        results = [symbol_rows, stale_rows]
        calls = {"n": 0}

        async def _execute(*args, **kwargs):
            res = Mock()
            i = calls["n"]
            calls["n"] += 1
            res.fetchall.return_value = results[i] if i < len(results) else []
            res.all.return_value = []
            res.scalars.return_value.all.return_value = []  # no shared quotes yet
            res.rowcount = 1
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


class TestSharedQuotes:
    """security_quotes: one live quote per symbol, shared by every holder."""

    @pytest.mark.asyncio
    async def test_the_shared_quote_only_moves_forward(self, async_session):
        from app.modules.portfolio.models import SecurityQuote
        service = PriceUpdateService(async_session)
        t1 = datetime(2026, 5, 13, 6, 0, tzinfo=ZoneInfo("UTC"))
        await service.store_quote("0050", Decimal("100"), None, t1, market="TW", currency="TWD")
        await service.store_quote("0050", Decimal("90"), None, t1 - timedelta(hours=1), market="TW", currency="TWD")
        await async_session.commit()
        quote = await async_session.get(SecurityQuote, "0050")
        await async_session.refresh(quote)
        assert quote.price == Decimal("100")

    @pytest.mark.asyncio
    async def test_a_second_users_refresh_reuses_the_first_ones_fetch(self, async_session):
        """One provider call serves every holder: B's refresh finds A's quote fresh."""
        a_id, (a_lot,) = await _seed_lots(async_session, [dict(symbol="0050")])
        b_id, (b_lot,) = await _seed_lots(async_session, [dict(symbol="0050")])
        service = PriceUpdateService(async_session)

        with patch.object(service, "_fetch_live_quote", new_callable=AsyncMock,
                          return_value=(Decimal("150"), Decimal("140"))) as fetch:
            await service.update_portfolio_prices(a_id, force=True)
            stats_b = await service.update_portfolio_prices(b_id)

        assert fetch.await_count == 1
        await async_session.refresh(b_lot)
        assert b_lot.current_price == Decimal("150") and b_lot.previous_close == Decimal("140")
        assert stats_b["updated"] == 1 and stats_b["failed"] == 0

    @pytest.mark.asyncio
    async def test_the_scheduler_prices_a_new_lot_from_the_stored_quote_without_fetching(self, async_session):
        user_id, (lot,) = await _seed_lots(async_session, [dict(symbol="0050", price="100")])
        service = PriceUpdateService(async_session)
        now = datetime.now(ZoneInfo("UTC"))
        await service.store_quote("0050", Decimal("123"), Decimal("120"), now, market="TW", currency="TWD")
        await async_session.commit()

        with patch.object(service, "_get_price_with_fallback", new_callable=AsyncMock) as fetch, \
             patch.object(service.market_hours_manager, "should_update_price", return_value=False):
            stats = await service.update_all_symbols_prices()

        assert fetch.await_count == 0
        assert stats["cached"] == 1
        await async_session.refresh(lot)
        assert lot.current_price == Decimal("123")
        assert lot.total_value == lot.quantity * Decimal("123")


class TestFanOutWritesOnlyWhatIsMissing:
    @pytest.mark.asyncio
    async def test_a_lot_that_already_has_the_quote_is_not_rewritten(self, async_session):
        now = datetime.now(ZoneInfo("UTC"))
        _, (lot,) = await _seed_lots(async_session, [dict(symbol="0050", price="123", stamp=now)])
        service = PriceUpdateService(async_session)
        await service.store_quote("0050", Decimal("123"), None, now, market="TW", currency="TWD")
        await async_session.commit()
        written = await service.apply_quote("0050", Decimal("123"), None, now, store=False)
        assert written == 0

    @pytest.mark.asyncio
    async def test_a_fan_out_only_run_still_syncs_portfolio_totals(self, async_session):
        from app.modules.portfolio.services import PortfolioService
        await _seed_lots(async_session, [dict(symbol="0050", price="100")])
        service = PriceUpdateService(async_session)
        await service.store_quote("0050", Decimal("123"), None, datetime.now(ZoneInfo("UTC")),
                                  market="TW", currency="TWD")
        await async_session.commit()

        with patch.object(service.market_hours_manager, "should_update_price", return_value=False), \
             patch.object(PortfolioService, "_update_portfolio_totals", new_callable=AsyncMock) as totals:
            stats = await service.update_all_symbols_prices()

        assert stats["updated"] == 0
        assert totals.await_count == 1 and stats["portfolios_synced"] == 1

    @pytest.mark.asyncio
    async def test_a_run_where_every_lot_has_the_quote_writes_and_syncs_nothing(self, async_session):
        now = datetime.now(ZoneInfo("UTC"))
        from app.modules.portfolio.services import PortfolioService
        await _seed_lots(async_session, [dict(symbol="0050", price="123", stamp=now)])
        service = PriceUpdateService(async_session)
        await service.store_quote("0050", Decimal("123"), None, now, market="TW", currency="TWD")
        await async_session.commit()

        with patch.object(service.market_hours_manager, "should_update_price", return_value=False), \
             patch.object(service, "apply_quote", new_callable=AsyncMock) as apply, \
             patch.object(PortfolioService, "_update_portfolio_totals", new_callable=AsyncMock) as totals:
            await service.update_all_symbols_prices()

        assert apply.await_count == 0
        assert totals.await_count == 0
