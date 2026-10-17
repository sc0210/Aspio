"""
Single-flight (thundering-herd) tests for ExchangeRateService.

A dashboard load fans out into several concurrent requests, each building its
own ExchangeRateService against its own DB session. With a cold in-memory
cache they all miss together, so every one of them used to hit the upstream
FX API for the *same* pair — four "Fetching exchange rate from API: USD -> TWD"
calls inside 550ms were observed in one page load — and each then wrote its own
duplicate row into currency_rates.

These tests pin the fix: concurrent misses for one pair collapse into a single
upstream fetch and a single DB write, while distinct pairs stay independent.
"""

import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.utils import exchange_rate_service as ers_module
from app.utils.exchange_rate_service import ExchangeRateService


@pytest.fixture(autouse=True)
def _clear_module_caches():
    """The in-memory rate cache and in-flight locks are module-level state."""
    ers_module._cache.clear()
    ers_module._inflight_locks.clear()
    yield
    ers_module._cache.clear()
    ers_module._inflight_locks.clear()


def _slow_rates(counter: dict, delay: float = 0.05):
    """A _fetch_rates stand-in that is slow enough for callers to pile up on."""

    # Patched onto the class, so it receives `self` like the real method.
    async def _fetch(self, base_currency: str):
        counter[base_currency] = counter.get(base_currency, 0) + 1
        await asyncio.sleep(delay)
        return {"TWD": 31.5, "JPY": 150.0, "EUR": 0.92}

    return _fetch


@pytest.mark.unit
class TestExchangeRateSingleFlight:
    """Concurrent misses for one currency pair must collapse into one fetch."""

    @pytest.mark.asyncio
    async def test_concurrent_same_pair_hits_api_once(self):
        """Ten concurrent USD->TWD misses = one upstream call, one shared value."""
        calls: dict = {}

        with patch.object(ExchangeRateService, "_fetch_rates", _slow_rates(calls)):
            # Separate instances: this is the real shape of the bug — one
            # service per in-flight request, so per-instance state cannot help.
            results = await asyncio.gather(
                *[
                    ExchangeRateService(db_session=None).get_exchange_rate("USD", "TWD")
                    for _ in range(10)
                ]
            )

        assert calls == {"USD": 1}, f"expected 1 upstream fetch, got {calls}"
        assert results == [Decimal("31.5")] * 10

    @pytest.mark.asyncio
    async def test_concurrent_same_pair_writes_db_cache_once(self):
        """The duplicate currency_rates rows go away too, not just the API calls."""
        calls: dict = {}
        saves: list = []

        async def _save(self, from_currency, to_currency, rate):
            saves.append((from_currency, to_currency, rate))

        with patch.object(ExchangeRateService, "_fetch_rates", _slow_rates(calls)), \
             patch.object(ExchangeRateService, "_get_from_db_cache", AsyncMock(return_value=None)), \
             patch.object(ExchangeRateService, "_save_to_db_cache", _save):
            await asyncio.gather(
                *[
                    ExchangeRateService(db_session=AsyncMock()).get_exchange_rate("USD", "TWD")
                    for _ in range(6)
                ]
            )

        assert saves == [("USD", "TWD", Decimal("31.5"))]

    @pytest.mark.asyncio
    async def test_distinct_pairs_are_not_serialised(self):
        """Deduping one pair must not make unrelated pairs queue behind it."""
        calls: dict = {}

        with patch.object(ExchangeRateService, "_fetch_rates", _slow_rates(calls, delay=0.2)):
            svc = ExchangeRateService(db_session=None)
            started = asyncio.get_running_loop().time()
            rates = await asyncio.gather(
                svc.get_exchange_rate("USD", "TWD"),
                svc.get_exchange_rate("USD", "JPY"),
                svc.get_exchange_rate("EUR", "TWD"),
            )
            elapsed = asyncio.get_running_loop().time() - started

        assert rates == [Decimal("31.5"), Decimal("150.0"), Decimal("31.5")]
        # Three different pairs ran concurrently, not one-after-another (0.6s).
        assert elapsed < 0.5, f"distinct pairs serialised: {elapsed:.2f}s"

    @pytest.mark.asyncio
    async def test_second_caller_reuses_warm_cache_without_refetching(self):
        """After the in-flight fetch resolves, later callers read the mem cache."""
        calls: dict = {}

        with patch.object(ExchangeRateService, "_fetch_rates", _slow_rates(calls)):
            await ExchangeRateService(db_session=None).get_exchange_rate("USD", "TWD")
            await ExchangeRateService(db_session=None).get_exchange_rate("USD", "TWD")

        assert calls == {"USD": 1}

    @pytest.mark.asyncio
    async def test_failed_fetch_does_not_poison_later_calls(self):
        """A raising fetch must release the in-flight slot, not deadlock the pair."""
        attempts = {"n": 0}

        async def _flaky(self, base_currency: str):
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise RuntimeError("upstream down")
            return {"TWD": 31.5}

        with patch.object(ExchangeRateService, "_fetch_rates", _flaky):
            svc = ExchangeRateService(db_session=None)
            with pytest.raises(RuntimeError):
                await svc.get_exchange_rate("USD", "TWD")

            # The pair is not wedged — the next caller retries and succeeds.
            assert await svc.get_exchange_rate("USD", "TWD") == Decimal("31.5")

        assert attempts["n"] == 2

    @pytest.mark.asyncio
    async def test_force_refresh_still_bypasses_the_cache(self):
        """force_refresh must not be answered from the value the lock holder cached."""
        calls: dict = {}

        with patch.object(ExchangeRateService, "_fetch_rates", _slow_rates(calls)):
            svc = ExchangeRateService(db_session=None)
            await svc.get_exchange_rate("USD", "TWD")
            await svc.get_exchange_rate("USD", "TWD", force_refresh=True)

        assert calls == {"USD": 2}, "force_refresh was served from cache"

    @pytest.mark.asyncio
    async def test_same_currency_short_circuits_without_locking(self):
        """USD->USD is a constant; it must not take the in-flight path at all."""
        calls: dict = {}

        with patch.object(ExchangeRateService, "_fetch_rates", _slow_rates(calls)):
            rate = await ExchangeRateService(db_session=None).get_exchange_rate("USD", "USD")

        assert rate == Decimal("1.0")
        assert calls == {}
