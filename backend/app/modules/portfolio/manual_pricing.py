"""Which holdings carry a price the user sets, rather than one a feed fetches.

Price refresh has always left cash, crypto and lending positions alone, along
with a few bookkeeping symbols ("CASH", "USDT-LEND", "TWD-SAVINGS"): none of
them has a quote we fetch. Their price is whatever was last written, and until
2026-09-17 nothing let the user write it. A USD lending position earning
interest sat at its purchase price indefinitely.

This is the one rule both sides read. Price refresh uses it to skip these
holdings, and the holding editor uses it to decide whose price may be set by
hand. A manual price on a quoted holding would be overwritten by the next
refresh, which is why the editor refuses one.
"""

from typing import Optional

MANUALLY_PRICED_TYPES = frozenset({"cash", "crypto", "cryptocurrency", "lending"})

_MANUALLY_PRICED_SYMBOLS = frozenset(
    {"SAVINGS", "TWD-SAVINGS", "CPF-OA", "CRYPTO", "CASH", "EMERGENCY-FUND"}
)
_MANUALLY_PRICED_SUFFIXES = ("-SAVINGS", "-LEND")


def is_manually_priced(symbol: Optional[str], asset_type: Optional[str]) -> bool:
    """True when no price feed updates this holding, so the user's price stands."""
    if asset_type and str(asset_type).lower() in MANUALLY_PRICED_TYPES:
        return True
    sym = (symbol or "").upper()
    return sym in _MANUALLY_PRICED_SYMBOLS or sym.endswith(_MANUALLY_PRICED_SUFFIXES)
