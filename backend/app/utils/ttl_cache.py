"""Expiring entries in a plain dict: ``{key: {"value": v, "expires_at": t}}``.

The in-process caches (exchange rates, symbol lookups, price history, latest
prices) share these two functions. An expired entry used to be dropped only when
its own key was read again, so keys that never come back stayed for good: the
price-history key carries today's date, which added a fresh set of whole price
series every day until the backend restarted. ``ttl_set`` now also sweeps the
store's expired entries, at most once a minute.
"""

import time
from typing import Any, Dict, Hashable, Optional

_SWEEP_EVERY = 60.0
_last_sweep: Dict[int, float] = {}


def ttl_get(store: Dict[Hashable, dict], key: Hashable) -> Optional[Any]:
    entry = store.get(key)
    if entry and time.time() < entry["expires_at"]:
        return entry["value"]
    store.pop(key, None)
    return None


def ttl_set(store: Dict[Hashable, dict], key: Hashable, value: Any, ttl: float) -> None:
    now = time.time()
    store[key] = {"value": value, "expires_at": now + ttl}
    if now - _last_sweep.get(id(store), 0.0) >= _SWEEP_EVERY:
        _last_sweep[id(store)] = now
        for stale in [k for k, e in store.items() if e["expires_at"] <= now]:
            del store[stale]
