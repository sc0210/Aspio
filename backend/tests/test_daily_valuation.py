"""The dashboard strip and the P&L calendar value the portfolio the same way.

On 2026-11-21 the strip's month change and the calendar's month sum differed
by about an eighth, for one portfolio with no trades all month:

- the strip's trend converted every past day at today's USD rate, the calendar
  at each day's, so the two opened the month at different values;
- Friday's US close was in each lot's current_price but not yet in the stored
  history, so the calendar carried Thursday's close over Friday and dropped
  that day's fall.

Both series now share app/modules/portfolio/daily_valuation.py.
"""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
from zoneinfo import ZoneInfo

from app.modules.portfolio.daily_valuation import DailyFx, settled_quote_day
from app.modules.portfolio.historical_price_repository import _hist_cache
from app.modules.portfolio.models import HistoricalPrice, Portfolio, PortfolioHolding
from app.modules.portfolio.routers import performance_history
from app.utils.exchange_rate_service import ExchangeRateService
from app.utils.market_sessions import last_settled_close

UTC = timezone.utc
# Saturday 10:54 Taipei: the US Friday session settled at 16:30 New York.
SAT_MORNING = datetime(2026, 11, 21, 2, 54, tzinfo=UTC)


def _lot(market, stamped, price="10"):
    return SimpleNamespace(market=market, last_price_update_at=stamped, current_price=Decimal(price))


class TestSettledQuoteDay:
    def test_a_quote_fetched_after_fridays_us_close_is_fridays_close(self):
        lot = _lot("US", datetime(2026, 11, 21, 2, 54, tzinfo=UTC))
        assert settled_quote_day(lot, SAT_MORNING) == date(2026, 11, 20)

    def test_a_quote_fetched_before_that_close_settled_is_no_close(self):
        # 15:00 UTC Friday = 10:00 in New York, mid-session.
        lot = _lot("US", datetime(2026, 11, 20, 15, 0, tzinfo=UTC))
        assert settled_quote_day(lot, SAT_MORNING) is None

    def test_taiwan_after_the_bell_is_that_days_close(self):
        now = datetime(2026, 11, 20, 15, 0, tzinfo=ZoneInfo("Asia/Taipei"))
        lot = _lot("TW", datetime(2026, 11, 20, 14, 5, tzinfo=ZoneInfo("Asia/Taipei")))
        assert settled_quote_day(lot, now) == date(2026, 11, 20)

    def test_a_quote_fetched_during_the_next_session_is_no_close(self):
        # Monday 10:30 New York: later than Friday's settled close, but a
        # partial Monday price. It must not stand in for Friday.
        monday = datetime(2026, 11, 23, 15, 30, tzinfo=UTC)
        lot = _lot("US", monday)
        assert settled_quote_day(lot, monday + timedelta(minutes=5)) is None

    def test_monday_after_its_close_is_mondays_close(self):
        stamped = datetime(2026, 11, 23, 21, 40, tzinfo=UTC)  # 16:40 New York
        lot = _lot("US", stamped)
        assert settled_quote_day(lot, stamped) == date(2026, 11, 23)

    @pytest.mark.parametrize("label", ["NASDAQ", "NYSE", "nasdaq"])
    def test_exchange_labels_map_to_their_session(self, label):
        lot = _lot(label, datetime(2026, 11, 21, 2, 54, tzinfo=UTC))
        assert settled_quote_day(lot, SAT_MORNING) == date(2026, 11, 20)

    def test_a_naive_stamp_is_read_as_utc(self):
        lot = _lot("US", datetime(2026, 11, 21, 2, 54))
        assert settled_quote_day(lot, SAT_MORNING) == date(2026, 11, 20)

    @pytest.mark.parametrize("lot", [
        _lot("CRYPTO", SAT_MORNING),      # never closes
        _lot("SG", SAT_MORNING),          # no modelled session
        _lot("US", None),                 # never priced
        _lot("US", SAT_MORNING, price="0"),
    ])
    def test_no_close_day_when_nothing_says_it_is_one(self, lot):
        assert settled_quote_day(lot, SAT_MORNING) is None


class TestDailyFx:
    def _fx(self, live=Decimal("30")):
        dates = [date(2026, 11, 13), date(2026, 11, 14)]  # Friday is the last close
        closes = [Decimal("32.5"), Decimal("33")]

        class Live:
            async def get_exchange_rate(self, from_currency, to_currency):
                return live

        return DailyFx("TWD", date(2026, 12, 31), {"TWD=X": (dates, closes)}, Live())

    @pytest.mark.asyncio
    async def test_a_past_day_uses_its_own_close_carried_over_the_weekend(self):
        fx = self._fx()
        assert await fx.rate("USD", date(2026, 11, 13)) == Decimal("32.5")
        assert await fx.rate("USD", date(2026, 11, 16)) == Decimal("33")

    @pytest.mark.asyncio
    async def test_today_and_a_stale_series_use_the_live_rate(self):
        fx = self._fx()
        assert await fx.rate("USD", date(2026, 12, 31)) == Decimal("30")
        # A week after the last close still carries it; past that the series
        # is missing, not resting over a weekend.
        assert await fx.rate("USD", date(2026, 11, 21)) == Decimal("33")
        assert await fx.rate("USD", date(2026, 11, 22)) == Decimal("30")

    @pytest.mark.asyncio
    async def test_a_failed_read_of_stored_closes_falls_back_to_the_live_rate(self):
        class Broken:
            async def get_batch_price_range(self, **kw):
                raise RuntimeError("price store down")

        class Live:
            async def get_exchange_rate(self, from_currency, to_currency):
                return Decimal("30")

        fx = await DailyFx.load(Broken(), Live(), "TWD", date(2026, 11, 1), date(2026, 11, 21))
        assert await fx.rate("USD", date(2026, 11, 13)) == Decimal("30")

    @pytest.mark.asyncio
    async def test_the_base_currency_is_one(self):
        assert await self._fx().rate("TWD", date(2026, 11, 13)) == Decimal("1")


# ── Both series, end to end on one seeded portfolio ──────────────────────────
#
# AAPL: 2 units, stored closes of 40 up to the day before the latest settled US
# session, current_price 55 fetched after that session closed. TWD=X is 32 on
# every stored day; the live rate is stubbed to 30.

LIVE_RATE = Decimal("30")
SERIES_RATE = Decimal("32")


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    async def no_refresh(user_id):
        return None

    async def rate(self, from_currency, to_currency):
        return LIVE_RATE if from_currency == "USD" else Decimal("1")

    monkeypatch.setattr(performance_history, "_refresh_prices_background", no_refresh)
    monkeypatch.setattr(ExchangeRateService, "get_exchange_rate", rate)
    _hist_cache.clear()
    yield
    _hist_cache.clear()


@pytest_asyncio.fixture
async def us_portfolio(async_session, test_user):
    settled = last_settled_close("US")
    # Always a weekday, and always before today in Taipei: New York's 16:30
    # is the next morning there.
    close_day = settled.astimezone(ZoneInfo("America/New_York")).date()
    stamped = settled + timedelta(minutes=5)

    pf = Portfolio(id=uuid4(), user_id=test_user.id, name="P", currency="TWD", is_active=True, is_default=True)
    async_session.add(pf)
    await async_session.flush()
    async_session.add(PortfolioHolding(
        id=uuid4(), portfolio_id=pf.id, user_id=test_user.id, symbol="AAPL", name="Apple",
        type="stock", exchange="NASDAQ", currency="USD", market="US",
        quantity=Decimal("2"), average_cost=Decimal("40"), current_price=Decimal("55"),
        total_cost=Decimal("80"), total_value=Decimal("110"), gain_loss=Decimal("30"),
        gain_loss_percentage=Decimal("37.5"), is_active=True, last_price_update_at=stamped,
        purchase_date=datetime.combine(close_day - timedelta(days=60), time.min, tzinfo=UTC),
    ))
    day = close_day - timedelta(days=45)
    while day <= close_day + timedelta(days=3):
        if day < close_day:  # the latest session's close is not stored yet
            async_session.add(HistoricalPrice(symbol="AAPL", market="US", date=day, close=Decimal("40"),
                                              source="t", currency="USD"))
        async_session.add(HistoricalPrice(symbol="TWD=X", market="FX", date=day, close=SERIES_RATE,
                                          source="t", currency="TWD"))
        day += timedelta(days=1)
    await async_session.commit()
    return close_day


def _prior_weekday(day):
    day -= timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


@pytest.mark.asyncio
@pytest.mark.api
async def test_calendar_counts_the_close_that_is_only_in_current_price(authenticated_client, us_portfolio):
    close_day = us_portfolio
    r = authenticated_client.get("/api/v1/portfolio/daily-performance", params={"days": 10})
    assert r.status_code == 200, r.text
    points = {p["date"]: p for p in r.json()["data"]}

    # Carrying 40 over it put 2 × 40 × 32 here, and the session's move nowhere.
    assert points[close_day.isoformat()]["value"] == pytest.approx(2 * 55 * 32)
    assert points[close_day.isoformat()]["provisional"] is False
    assert points[_prior_weekday(close_day).isoformat()]["value"] == pytest.approx(2 * 40 * 32)


@pytest.mark.asyncio
@pytest.mark.database
async def test_wallet_trend_matches_the_calendar_on_every_past_day(async_session, test_user, us_portfolio):
    from app.modules.dashboard.schemas import PeriodEnum
    from app.modules.dashboard.services import DashboardService

    close_day = us_portfolio
    trend = await DashboardService(async_session).get_wallet_trends(
        user_id=str(test_user.id), period=PeriodEnum.THIRTY_DAYS, force_refresh=True,
    )
    by_day = {str(p.date)[:10]: float(p.portfolio_wallet) for p in trend.data_points}

    # Past days at the day's stored rate (32), not today's live one (30).
    assert by_day[_prior_weekday(close_day).isoformat()] == pytest.approx(2 * 40 * 32)
    assert by_day[close_day.isoformat()] == pytest.approx(2 * 55 * 32)
