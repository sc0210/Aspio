"""
Unit tests for the in-process price cache (_PriceCache).
Tests thread-safety and TTL expiry without hitting any external service.
"""

import threading
import time
import pytest

# Import the private class by reaching into the module
from app.modules.portfolio.router import _PriceCache, _lp_cache_get, _lp_cache_set


class TestPriceCache:
    def setup_method(self):
        self.cache = _PriceCache()

    # ── Basic TTL ─────────────────────────────────────────────────────────────

    def test_get_returns_none_for_missing_key(self):
        assert self.cache.get("AAPL") is None

    def test_set_then_get_returns_value(self):
        self.cache.set("AAPL", 180.5, ttl=60)
        assert self.cache.get("AAPL") == 180.5

    def test_expired_entry_returns_none(self):
        self.cache.set("AAPL", 180.5, ttl=0)  # expires immediately
        time.sleep(0.01)
        assert self.cache.get("AAPL") is None

    def test_expired_entry_is_evicted(self):
        self.cache.set("AAPL", 180.5, ttl=0)
        time.sleep(0.01)
        self.cache.get("AAPL")  # triggers eviction
        with self.cache._lock:
            assert "AAPL" not in self.cache._store

    def test_overwrite_updates_value_and_ttl(self):
        self.cache.set("AAPL", 100.0, ttl=60)
        self.cache.set("AAPL", 200.0, ttl=60)
        assert self.cache.get("AAPL") == 200.0

    def test_clear_removes_all_entries(self):
        self.cache.set("AAPL", 100.0, ttl=60)
        self.cache.set("TSLA", 250.0, ttl=60)
        self.cache.clear()
        assert self.cache.get("AAPL") is None
        assert self.cache.get("TSLA") is None

    def test_different_keys_stored_independently(self):
        self.cache.set("AAPL", 180.0, ttl=60)
        self.cache.set("TSLA", 250.0, ttl=60)
        assert self.cache.get("AAPL") == 180.0
        assert self.cache.get("TSLA") == 250.0

    # ── Thread safety ─────────────────────────────────────────────────────────

    def test_concurrent_writes_do_not_corrupt_state(self):
        errors = []

        def writer(symbol: str, price: float):
            try:
                for _ in range(100):
                    self.cache.set(symbol, price, ttl=10)
            except Exception as exc:
                errors.append(exc)

        threads = [
            threading.Thread(target=writer, args=(f"SYM{i}", float(i)))
            for i in range(10)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Thread errors: {errors}"

    def test_concurrent_reads_and_writes_are_safe(self):
        self.cache.set("AAPL", 180.0, ttl=60)
        errors = []

        def reader():
            try:
                for _ in range(50):
                    self.cache.get("AAPL")
            except Exception as exc:
                errors.append(exc)

        def writer():
            try:
                for i in range(50):
                    self.cache.set("AAPL", float(i), ttl=60)
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=reader) for _ in range(4)]
        threads += [threading.Thread(target=writer) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Thread errors: {errors}"

    # ── Module-level helpers ──────────────────────────────────────────────────

    def test_module_level_set_and_get(self):
        _lp_cache_set("__test_key__", 42.0, ttl=60)
        result = _lp_cache_get("__test_key__")
        assert result == 42.0

    def test_module_level_get_returns_none_for_missing(self):
        assert _lp_cache_get("__nonexistent__") is None
