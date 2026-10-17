"""What an exchange rate is when the live API cannot supply one.

It used to be the hardcoded table (USD→TWD 31.5, written by hand and never
updated), returned by the fetch as if it were live, then saved to currency_rates
as source="exchangerate-api" and served as today's rate for the rest of the day.
Nothing downstream could tell.

Now a failed live fetch is None. get_exchange_rate falls back to the last real
rate on record, then to the table, and holds either only briefly in memory —
never in the database.
"""

import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.utils import exchange_rate_service as ers_module
from app.utils.exchange_rate_service import ExchangeRateService


@pytest.fixture(autouse=True)
def _clear_module_caches():
    ers_module._cache.clear()
    ers_module._inflight_locks.clear()
    yield
    ers_module._cache.clear()
    ers_module._inflight_locks.clear()


def _service(live, last_known=None):
    svc = ExchangeRateService()
    svc._fetch_rates = AsyncMock(return_value=live)
    svc._get_from_db_cache = AsyncMock(return_value=None)
    svc._get_last_known_rate = AsyncMock(return_value=last_known)
    svc._save_to_db_cache = AsyncMock()
    return svc


def _cached_for(key):
    entry = ers_module._cache.get(key)
    return None if entry is None else entry["expires_at"] - time.time()


@pytest.mark.asyncio
async def test_a_live_rate_is_saved_and_cached_for_the_hour():
    svc = _service(live={"TWD": 31.6048})

    rate = await svc.get_exchange_rate("USD", "TWD")

    assert rate == Decimal("31.6048")
    svc._save_to_db_cache.assert_awaited_once_with("USD", "TWD", Decimal("31.6048"))
    assert _cached_for("exchange_rate:USD:TWD") > ers_module._ESTIMATE_TTL


@pytest.mark.asyncio
async def test_without_a_live_rate_the_last_recorded_one_beats_the_table():
    svc = _service(live=None, last_known=Decimal("31.6938"))

    rate = await svc.get_exchange_rate("USD", "TWD")

    assert rate == Decimal("31.6938")  # not the table's 31.5
    svc._save_to_db_cache.assert_not_awaited()
    assert _cached_for("exchange_rate:USD:TWD") <= ers_module._ESTIMATE_TTL


@pytest.mark.asyncio
async def test_the_table_is_the_last_resort_and_is_never_saved_as_live():
    svc = _service(live=None, last_known=None)

    rate = await svc.get_exchange_rate("USD", "TWD")

    assert rate == Decimal("31.5")
    svc._save_to_db_cache.assert_not_awaited()
    assert _cached_for("exchange_rate:USD:TWD") <= ers_module._ESTIMATE_TTL


@pytest.mark.asyncio
async def test_a_live_rate_missing_the_pair_also_falls_back_honestly():
    svc = _service(live={"JPY": 150.0}, last_known=Decimal("31.6"))

    assert await svc.get_exchange_rate("USD", "TWD") == Decimal("31.6")
    svc._save_to_db_cache.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_api_key_means_no_live_rates_not_the_table():
    svc = ExchangeRateService()
    svc.api_key = None

    assert await svc._fetch_rates("USD") is None


@pytest.mark.asyncio
async def test_an_api_error_means_no_live_rates_not_the_table():
    svc = ExchangeRateService()
    svc.api_key = "test-key"

    response = AsyncMock()
    response.raise_for_status = lambda: None
    response.json = lambda: {"result": "error", "error-type": "quota-reached"}
    client = AsyncMock()
    client.__aenter__.return_value.get = AsyncMock(return_value=response)

    with patch("app.utils.exchange_rate_service.httpx.AsyncClient", return_value=client):
        assert await svc._fetch_rates("USD") is None


@pytest.mark.asyncio
async def test_several_rates_without_a_live_source_come_back_unknown_for_callers_to_label():
    # The LINE /rates card fills unknowns from the table and marks them "approx";
    # handing it the table as though live hid that.
    svc = ExchangeRateService()
    svc._fetch_rates = AsyncMock(return_value=None)

    assert await svc.get_multiple_rates("USD", ["TWD", "JPY"]) == {"TWD": None, "JPY": None}


@pytest.mark.asyncio
@pytest.mark.database
async def test_the_last_known_rate_passes_over_an_estimate_saved_as_live(async_session):
    # Before this fix an outage saved the table's 31.5 as source="exchangerate-api".
    # Those rows are still in the table and must not come back as "the last real rate".
    from app.modules.portfolio.models import CurrencyRate

    now = datetime.now(timezone.utc)
    async_session.add_all([
        CurrencyRate(from_currency="USD", to_currency="TWD", rate=Decimal("31.604800"),
                     source="exchangerate-api", rate_timestamp=now - timedelta(days=3)),
        CurrencyRate(from_currency="USD", to_currency="TWD", rate=Decimal("31.500000"),
                     source="exchangerate-api", rate_timestamp=now - timedelta(days=1)),
    ])
    await async_session.commit()

    rate = await ExchangeRateService(async_session)._get_last_known_rate("USD", "TWD")

    assert rate == Decimal("31.6048")


@pytest.mark.asyncio
@pytest.mark.database
async def test_the_last_known_rate_is_the_newest_real_one(async_session):
    from app.modules.portfolio.models import CurrencyRate

    now = datetime.now(timezone.utc)
    async_session.add_all([
        CurrencyRate(from_currency="JPY", to_currency="TWD", rate=Decimal("0.201100"),
                     source="exchangerate-api", rate_timestamp=now - timedelta(days=30)),
        CurrencyRate(from_currency="JPY", to_currency="TWD", rate=Decimal("0.205700"),
                     source="exchangerate-api", rate_timestamp=now - timedelta(days=2)),
    ])
    await async_session.commit()

    assert await ExchangeRateService(async_session)._get_last_known_rate("JPY", "TWD") == Decimal("0.2057")
    assert await ExchangeRateService(async_session)._get_last_known_rate("EUR", "TWD") is None


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_pair_known_only_from_a_saved_estimate_has_no_last_known_rate(async_session):
    from app.modules.portfolio.models import CurrencyRate

    async_session.add(CurrencyRate(
        from_currency="USD", to_currency="TWD", rate=Decimal("31.500000"),
        source="exchangerate-api", rate_timestamp=datetime.now(timezone.utc) - timedelta(days=1),
    ))
    await async_session.commit()

    assert await ExchangeRateService(async_session)._get_last_known_rate("USD", "TWD") is None


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_live_rate_on_the_tables_value_is_still_trusted(async_session):
    # USD->HKD is pegged near the table's 7.8; a real fetch can land exactly on it.
    from app.modules.portfolio.models import CurrencyRate
    from app.utils.exchange_rate_service import LIVE_SOURCE

    now = datetime.now(timezone.utc)
    async_session.add_all([
        CurrencyRate(from_currency="USD", to_currency="HKD", rate=Decimal("7.750000"),
                     source="exchangerate-api", rate_timestamp=now - timedelta(days=45)),
        CurrencyRate(from_currency="USD", to_currency="HKD", rate=Decimal("7.800000"),
                     source=LIVE_SOURCE, rate_timestamp=now - timedelta(hours=2)),
    ])
    await async_session.commit()

    assert await ExchangeRateService(async_session)._get_last_known_rate("USD", "HKD") == Decimal("7.8")


@pytest.mark.asyncio
@pytest.mark.database
async def test_todays_cache_passes_over_an_estimate_saved_earlier_today(async_session):
    # A row the old code wrote this morning, before the deploy, would otherwise
    # be served as today's live rate for the rest of the day.
    from app.modules.portfolio.models import CurrencyRate

    async_session.add(CurrencyRate(
        from_currency="USD", to_currency="TWD", rate=Decimal("31.500000"),
        source="exchangerate-api", rate_timestamp=datetime.now(timezone.utc),
    ))
    await async_session.commit()

    assert await ExchangeRateService(async_session)._get_from_db_cache("USD", "TWD") is None


@pytest.mark.asyncio
@pytest.mark.database
async def test_todays_cache_serves_a_live_rate(async_session):
    from app.modules.portfolio.models import CurrencyRate
    from app.utils.exchange_rate_service import LIVE_SOURCE

    async_session.add(CurrencyRate(
        from_currency="USD", to_currency="HKD", rate=Decimal("7.800000"),
        source=LIVE_SOURCE, rate_timestamp=datetime.now(timezone.utc),
    ))
    await async_session.commit()

    assert await ExchangeRateService(async_session)._get_from_db_cache("USD", "HKD") == Decimal("7.8")


@pytest.mark.asyncio
async def test_the_refresh_endpoint_saves_rates_under_the_trusted_label():
    # Driven through the endpoint rather than its source text. The repository's
    # upsert is Postgres-only, so it is stubbed and the rows it is handed are read.
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from app.modules.portfolio.repositories import CurrencyRepository
    from app.modules.portfolio.routers.market_data import refresh_exchange_rates
    from app.utils.exchange_rate_service import LIVE_SOURCE

    live = MagicMock()
    live._fetch_rates = AsyncMock(return_value={"TWD": 31.6048, "HKD": 7.8})
    saved = []

    async def upsert(self_, rate_data):
        saved.append(rate_data)
        return SimpleNamespace(rate=rate_data["rate"])

    with patch("app.utils.exchange_rate_service.get_exchange_rate_service", return_value=live), \
         patch.object(CurrencyRepository, "create_or_update_rate", upsert):
        await refresh_exchange_rates(
            current_user=SimpleNamespace(id="user-1"), base_currency="USD", session=AsyncMock()
        )

    assert {row["to_currency"] for row in saved} == {"TWD", "HKD"}
    assert {row["source"] for row in saved} == {LIVE_SOURCE}

@pytest.mark.asyncio
@pytest.mark.database
async def test_holding_valuation_rate_passes_over_a_saved_estimate(async_session):
    # PortfolioRepository.get_latest_rate values foreign holdings; it read the
    # newest row of any label, so an old saved 31.5 could misprice them.
    from app.modules.portfolio.models import CurrencyRate
    from app.modules.portfolio.repositories import CurrencyRepository

    now = datetime.now(timezone.utc)
    async_session.add_all([
        CurrencyRate(from_currency="USD", to_currency="TWD", rate=Decimal("31.604800"),
                     source="ExchangeRate-API", rate_timestamp=now - timedelta(days=2)),
        CurrencyRate(from_currency="USD", to_currency="TWD", rate=Decimal("31.500000"),
                     source="ExchangeRate-API", rate_timestamp=now - timedelta(hours=1)),
    ])
    await async_session.commit()

    row = await CurrencyRepository(async_session).get_latest_rate("usd", "twd")

    assert row.rate == Decimal("31.6048")

@pytest.mark.asyncio
@pytest.mark.database
async def test_the_cache_window_follows_utc_not_the_host_clock(async_session, monkeypatch):
    """Rates are stamped in UTC, so "today" has to be UTC's.

    Taking the host's local date made the window wrong by its offset: in Taipei
    (UTC+8) every rate written between local midnight and 08:00 fell before a
    cutoff that was really 16:00 UTC the day before, so the cache missed every
    lookup for eight hours a day and the service went back out to the provider.

    Simulated by making the local date read one day ahead of UTC's, which is the
    state Taipei is in for those eight hours.
    """
    import app.utils.exchange_rate_service as svc
    from app.modules.portfolio.models import CurrencyRate
    from app.utils.exchange_rate_service import LIVE_SOURCE

    just_after_utc_midnight = datetime.now(timezone.utc).replace(
        hour=0, minute=30, second=0, microsecond=0
    )
    async_session.add(CurrencyRate(
        from_currency="USD", to_currency="SGD", rate=Decimal("1.340000"),
        source=LIVE_SOURCE, rate_timestamp=just_after_utc_midnight,
    ))
    await async_session.commit()

    class _LocalDateAhead(date):
        @classmethod
        def today(cls):
            return datetime.now(timezone.utc).date() + timedelta(days=1)

    # raising=False: the fixed module has no `date` to patch — the seam exists only
    # in the version this guards against, which read the host's local date.
    monkeypatch.setattr(svc, "date", _LocalDateAhead, raising=False)

    rate = await ExchangeRateService(async_session)._get_from_db_cache("USD", "SGD")
    assert rate == Decimal("1.34"), "a rate saved today (UTC) must still be served"
