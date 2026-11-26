"""Expiring entries in a plain dict: ``{key: {"value": v, "expires_at": t}}``.

The in-process caches (exchange rates, symbol lookups, price history, latest
prices) share these two functions. An expired entry used to be dropped only when
its own key was read again, so keys that never come back stayed for good: the
price-history key carries today's date, which added a fresh set of whole price
series every day until the backend restarted. ``ttl_set`` now also drops the
store's expired entries.
"""

import time
from typing import Any, Dict, Hashable, Optional


def ttl_get(store: Dict[Hashable, dict], key: Hashable) -> Optional[Any]:
    entry = store.get(key)
    if entry and time.time() < entry["expires_at"]:
        return entry["value"]
    store.pop(key, None)
    return None


def ttl_set(store: Dict[Hashable, dict], key: Hashable, value: Any, ttl: float) -> None:
    now = time.time()
    # shortcut: sweeps the whole store on every write, fine for the few hundred
    # entries these caches hold; sweep on a timer if one grows to many thousands.
    for stale in [k for k, e in list(store.items()) if e["expires_at"] <= now]:
        store.pop(stale, None)
    store[key] = {"value": value, "expires_at": now + ttl}
