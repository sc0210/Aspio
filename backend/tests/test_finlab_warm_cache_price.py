"""The FinLab warm-cache price path, which nothing exercised.

`_get_finlab_current_price` reuses the market DataFrame that `_get_finlab_historical`
already loaded, rather than making its own API call. That branch had no test — only
`_get_finlab_current_price` itself was ever patched out — and a change that made its
staleness check subtract a tz-naive pandas index from an aware `utc_now()` raised
TypeError inside a broad `except` that logs at debug. Every TW symbol after the first
would have fallen through to Yahoo with nothing above debug to say why.

FinLab indexes tz-naive. Anything compared against that index has to be naive too.
"""

from decimal import Decimal

import pytest

from app.utils.datetime_helpers import business_now, utc_now

pytestmark = pytest.mark.unit


def _warm_cache(mds, last_day, price=127.0, symbol="0050"):
    """Seed the module cache the way _get_finlab_historical leaves it."""
    import pandas as pd

    idx = pd.date_range(end=last_day, periods=3)
    assert idx.tz is None, "FinLab's index is tz-naive; the test must mirror that"
    mds._finlab_market_cache["close"] = pd.DataFrame(
        {symbol: [price - 2, price - 1, price]}, index=idx
    )
    mds._finlab_market_cache["last_fetch"] = utc_now()
    mds._finlab_market_cache["failed_at"] = None


@pytest.fixture
def mds():
    """Restore every module-level global this touches, not just the obvious one.

    An earlier version saved only `_finlab_market_cache` and leaked the other two,
    which made two tests in test_market_data_service.py fail in the full suite while
    passing alone — the worst kind of failure to chase. Note
    `clear_finlab_market_cache()` REBINDS the attribute rather than mutating it, so
    the restore has to set the attribute too.
    """
    import app.modules.portfolio.market_data_service as module

    saved = {
        "_finlab_market_cache": dict(module._finlab_market_cache),
        "_symbol_cache": dict(module._symbol_cache),
        "_finlab_storage_configured": module._finlab_storage_configured,
    }
    try:
        yield module
    finally:
        module.clear_finlab_market_cache()
        module._finlab_market_cache.clear()
        module._finlab_market_cache.update(saved["_finlab_market_cache"])
        module._symbol_cache.clear()
        module._symbol_cache.update(saved["_symbol_cache"])
        module._finlab_storage_configured = saved["_finlab_storage_configured"]


class TestTheWarmCacheReturnsAPrice:
    @pytest.mark.asyncio
    async def test_a_fresh_cache_answers_without_an_api_call(self, mds):
        _warm_cache(mds, business_now().replace(tzinfo=None))
        service = mds.MarketDataService(
            finlab_token="t", enable_finlab=True, enable_yahoo=False
        )

        price = await service._get_finlab_current_price("0050")

        assert price == Decimal("127.0")

    @pytest.mark.asyncio
    async def test_the_suffixed_symbol_finds_the_bare_column(self, mds):
        """A "0050.TW" holding must reach the "0050" column."""
        _warm_cache(mds, business_now().replace(tzinfo=None))
        service = mds.MarketDataService(
            finlab_token="t", enable_finlab=True, enable_yahoo=False
        )

        assert await service._get_finlab_current_price("0050.TW") == Decimal("127.0")

    @pytest.mark.asyncio
    async def test_a_stale_index_falls_through_instead_of_pricing(self, mds):
        """Older than 7 days is not a current price, however warm the cache."""
        stale = business_now().replace(tzinfo=None).replace(microsecond=0)
        _warm_cache(mds, stale.fromordinal(stale.toordinal() - 30))
        service = mds.MarketDataService(
            finlab_token="t", enable_finlab=True, enable_yahoo=False
        )

        assert await service._get_finlab_current_price("0050") is None

    @pytest.mark.asyncio
    async def test_a_symbol_the_market_frame_lacks_returns_nothing(self, mds):
        _warm_cache(mds, business_now().replace(tzinfo=None), symbol="0050")
        service = mds.MarketDataService(
            finlab_token="t", enable_finlab=True, enable_yahoo=False
        )

        assert await service._get_finlab_current_price("2330") is None
