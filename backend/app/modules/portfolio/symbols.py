"""One canonical key per security.

The same security reaches this app under several spellings. Taiwan tickers
arrive bare from FinLab and TWSE ("0050") but Yahoo-suffixed from the US path
("0050.TW"); crypto arrives as a bare base ("BTC") from hand entry and as a
Yahoo pair ("BTC-USD") from a quote lookup. Nothing rejected those, so both
spellings were stored, and each accumulated its own separate, different-depth
row set in ``historical_prices``.

That is not cosmetic. Every history-walking calculation — cost basis, IRR,
day change, and time-weighted return above all — keys on the symbol string, so
it answers differently depending on which spelling a lot happens to carry, with
nothing surfacing that half the series was looked up under the other one.

The rule here: **store the form the security's own market names it by**, and
translate to a provider's dialect at the call, not in the database.

    Taiwan   bare code           0050, 006208, 2330      (FinLab / TWSE form)
    Crypto   Yahoo pair          BTC-USD                 (the only feed we use)
    US       the ticker          AAPL, VT

``to_yahoo_tw_symbol`` is how the TW form reaches Yahoo; it stays a call-site
concern.
"""

import re
from typing import Iterable, List, Optional

# Yahoo's exchange suffixes for the two Taiwan boards: ".TW" is TWSE (上市),
# ".TWO" is TPEx (上櫃). Neither is part of the code the exchange publishes.
_TW_SUFFIXES = (".TW", ".TWO")

# Bare crypto bases we canonicalise to a Yahoo pair — but only for a holding
# the user typed AS crypto.
#
# Every one of these is also a live US equity ticker: LTC is LTC Properties, SOL
# is ReneSola, ADA is Adams Diversified, BTC is Grayscale's Bitcoin Mini Trust.
# That is precisely why the bare spelling is ambiguous and worth resolving — and
# precisely why resolving it from the string alone is destructive. A REIT
# position in LTC renamed to LTC-USD prices Litecoin forever after.
#
# The portfolio also holds bookkeeping rows with crypto-ish symbols ("CRYPTO",
# "USDT-LEND") that are not tradeable pairs; a hyphen already present, or a
# symbol outside this list, is left alone regardless of type.
_CRYPTO_BASES = frozenset(
    {"BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "DOT", "AVAX", "MATIC", "LTC"}
)

# `asset_type_enum` carries BOTH spellings, and the Add Holding form, the
# rebalancing service and the price updater all treat them as the same thing.
# Matching only "crypto" left a holding typed "cryptocurrency" stored bare —
# the ambiguous-with-an-equity-ticker state this module exists to close, and
# silently, since nothing errors.
CRYPTO_ASSET_TYPES = frozenset({"crypto", "cryptocurrency"})

# The quote currency Yahoo pairs are keyed by.
_CRYPTO_QUOTE = "USD"

# Taiwan listed codes are four digits or more — 4 for a stock ("2330"), 5-6 for
# an ETF, which always leads with "00" ("0050", "00713", "006208"). Nothing on
# either board is shorter, so a 1-3 digit code cannot be a real ticker.
_MIN_TW_CODE_LENGTH = 4

# Leveraged and inverse ETFs append a class letter to the numeric code — 00631L
# (元大台灣50正2), 00632R, 00675L. Requiring all digits left that whole class
# outside canonicalisation, so "00631L.TW" and "00631L" stayed two separate
# series while the FinLab and TWSE paths both wrote the bare form.
_TW_CODE = re.compile(r"^[0-9]{4,6}[A-Z]?$")


def to_bare_tw_symbol(symbol: str) -> str:
    """``"0050.TW"`` -> ``"0050"``. FinLab keys its market DataFrames by bare code."""
    upper = (symbol or "").upper()
    for suffix in _TW_SUFFIXES:
        if upper.endswith(suffix):
            return symbol[: -len(suffix)]
    return symbol


def to_yahoo_tw_symbol(symbol: str) -> str:
    """``"0050"`` -> ``"0050.TW"``, idempotent. Yahoo needs the exchange suffix."""
    # Normalise once: appending to the raw argument turned None into the literal
    # ticker "None.TW", which then went out to Yahoo as a lookup.
    base = symbol or ""
    if base.upper().endswith(_TW_SUFFIXES):
        return base
    return f"{base}.TW" if base else base


def is_tw_code(symbol: str) -> bool:
    """Is this a Taiwan listed code, in either spelling?

    Recognised from the string alone, not from the holding's ``market`` column —
    that column is user-supplied and is wrong often enough that
    ``resolve_symbol_market`` exists to work around it.
    """
    bare = to_bare_tw_symbol((symbol or "").upper())
    return bool(_TW_CODE.match(bare))


def canonical_symbol(symbol: Optional[str]) -> str:
    """The one spelling this app stores a security under, from the string alone.

    Only the Taiwan rule is safe to apply without knowing what the holding is:
    a ".TW" suffix can only ever mean a Taiwan listing, so stripping it never
    changes which security is meant. Crypto is different — every bare base is
    also a live equity ticker — and needs :func:`canonical_symbol_for_asset`.

    This is what the price table and the transaction schema use, because neither
    carries an asset type.
    """
    base = (symbol or "").strip().upper()
    if not base:
        return base

    if is_tw_code(base):
        return to_bare_tw_symbol(base)

    return base


def canonical_symbol_for_asset(symbol: Optional[str], asset_type: Optional[str]) -> str:
    """The stored spelling for a holding, whose asset type resolves the ambiguity.

    Only a holding declared as crypto gets the Yahoo pair form. Everything else
    keeps the ticker as typed, so a REIT position in LTC stays LTC Properties
    rather than becoming Litecoin.
    """
    base = canonical_symbol(symbol)
    if not base or (asset_type or "").strip().lower() not in CRYPTO_ASSET_TYPES:
        return base

    # A pair already, or a bookkeeping row ("USDT-LEND"): leave it alone.
    if "-" in base or base not in _CRYPTO_BASES:
        return base

    return f"{base}-{_CRYPTO_QUOTE}"


def looks_like_stripped_tw_code(symbol: Optional[str]) -> bool:
    """Does this look like a Taiwan ticker Excel ate the leading zeros off?

    Opening a CSV in Excel coerces a ticker column to a number, so "0050"
    becomes 50 and "00713" becomes 713 before the user has typed anything —
    which is how 80 lots came to be stored under 50/6208/713. The template is
    XLSX with a text-formatted column for that reason
    (:func:`build_import_template_xlsx`), but a file that was already corrupted
    still imports.

    Only *provably* impossible codes are reported: a numeric code shorter than
    four digits. A stripped "006208" lands on "6208", which is indistinguishable
    from a real TPEx code, so this cannot catch every case — it catches the ones
    that cannot be anything else.
    """
    base = (symbol or "").strip().upper()
    return base.isdigit() and 0 < len(base) < _MIN_TW_CODE_LENGTH


def symbol_lookup_variants(
    symbol: str, market: Optional[str] = None
) -> List[str]:
    """Every spelling a symbol's stored rows may still be keyed under.

    Needed while pre-canonicalisation rows survive — a database that has had the
    merge applied returns a single-element list for everything.
    """
    base = (symbol or "").upper()
    if not base:
        return []

    bare = to_bare_tw_symbol(base)
    if bare != base:
        return [base, bare]

    if is_tw_code(bare) or (market or "").upper() == "TW":
        return _unique([base, to_yahoo_tw_symbol(base)])

    # Deliberately no crypto widening. "BTC" and "BTC-USD" are two *different*
    # securities' rows (see _CRYPTO_BASES), so reading both and preferring the
    # freshest would price Bitcoin off a $28 ETF — the failure this whole module
    # exists to prevent, reintroduced on the read side.
    return [base]


def _unique(values: Iterable[str]) -> List[str]:
    return list(dict.fromkeys(values))
