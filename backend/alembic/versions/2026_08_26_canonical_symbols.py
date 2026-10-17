"""Merge each security onto one symbol spelling

Revision ID: 2026_08_26_canonical_symbols
Revises: 2026_08_02_holding_txn_link
Create Date: 2026-08-26

Data-only. The same securities were stored under several spellings, each with
its own separate row set in `historical_prices`:

    0050 / 0050.TW / 50      2317 / 2317.TW      2330 / 2330.TW
    006208 / 6208            00713 / 713         BTC / BTC-USD

Two distinct causes, both now closed at the write boundary
(`portfolio/symbols.py`):

1. **Provider dialects.** Bare Taiwan codes come from FinLab and TWSE, suffixed
   ones from Yahoo, and nothing decided which to store — so a security's history
   ended up split across two keys, each shallower than the other. 2330 held 65
   rows as "2330" and 133 as "2330.TW".

2. **Excel.** Opening a CSV coerces the ticker column to a number, dropping the
   leading zeros Taiwan ETF codes all carry: "0050" arrives as 50, "00713" as
   713. 80 lots were imported that way, under codes no exchange lists and no
   provider can price. They are matched here by (symbol, name), the pair that
   identifies them unambiguously.

The BTC rows are deleted rather than merged. "BTC" alone is a live US ticker —
Grayscale Bitcoin Mini Trust, trading around $28 — so the rows stored under it
are that ETF's prices, not Bitcoin's, and folding a $28 series into a $60,000
one would corrupt the result. They re-fetch under the pair symbol.

Overlapping dates were checked before writing this: where both spellings hold
the same session, their closes are identical, so the merge cannot change a
price. On a collision the row already under the canonical key wins.

NOTE (prod): production schema is NOT migrated automatically. Apply
backend/scripts/prod_sql/2026_08_26_canonical_symbols.sql against the Pi's
database manually, then `alembic stamp head`.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "2026_08_26_canonical_symbols"
down_revision = "2026_08_02_holding_txn_link"
branch_labels = None
depends_on = None


# Kept in step with _CRYPTO_BASES in app/modules/portfolio/symbols.py.
CRYPTO_BASES = (
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "DOT", "AVAX", "MATIC", "LTC",
)

# Taiwan ETF codes Excel stripped, and the name each is stored under. Padding
# cannot be derived from the code alone — "50" is 4 characters wide, "713" is 5
# and "6208" is 6 — so the repair is by identity, not by rule.
STRIPPED_TW_CODES = (
    ("50", "0050", "元大台灣50"),
    ("6208", "006208", "富邦台灣50"),
    ("713", "00713", "元大高息低波"),
)

_TW_SUFFIXED = r"^[0-9]+\.TWO?$"
_TW_BARE = r"^[0-9]+$"


def _crypto_list() -> str:
    return ", ".join(f"'{base}'" for base in CRYPTO_BASES)


def _merged_spellings(column: str, crypto: str) -> str:
    """Restrict a follow-the-holding update to the spellings being merged.

    ``symbol IS DISTINCT FROM h.symbol`` alone also matches rows that carry a
    *legitimately* different ticker from their holding — a spin-off, a merger, a
    dividend paid in another security. Rewriting those to the holding's ticker
    would be silent and, in a migration whose downgrade is a no-op, permanent.
    """
    stripped = ", ".join(f"'{code}'" for code, _, _ in STRIPPED_TW_CODES)
    return (
        f"({column} ~ '{_TW_SUFFIXED}'"
        f" OR {column} IN ({stripped})"
        f" OR {column} IN ({crypto}))"
    )


def upgrade() -> None:
    crypto = _crypto_list()

    # ── Holdings ──────────────────────────────────────────────────────────────
    # Yahoo suffix off, and the market label corrected with it: a bare Taiwan
    # code labelled "US" routes to the US provider, which does not know it.
    op.execute(
        f"""
        UPDATE portfolio_holdings
        SET symbol = regexp_replace(symbol, '\\.TWO?$', ''),
            market = 'TW'
        WHERE symbol ~ '{_TW_SUFFIXED}'
        """
    )

    for stripped, intact, name in STRIPPED_TW_CODES:
        op.execute(
            f"""
            UPDATE portfolio_holdings
            SET symbol = '{intact}', market = 'TW'
            WHERE symbol = '{stripped}' AND name = '{name}'
            """
        )

    op.execute(
        f"""
        UPDATE portfolio_holdings
        SET market = 'TW'
        WHERE symbol ~ '{_TW_BARE}' AND market IS DISTINCT FROM 'TW'
        """
    )

    # Scoped to holdings actually typed as crypto. Every base in that list is
    # also a live equity ticker — LTC is LTC Properties, SOL is ReneSola, ADA is
    # Adams Diversified — so an unscoped rename would turn a REIT position into
    # Litecoin, permanently and with no downgrade to undo it.
    op.execute(
        f"""
        UPDATE portfolio_holdings
        SET symbol = symbol || '-USD'
        WHERE symbol IN ({crypto}) AND type IN ('crypto', 'cryptocurrency')
        """
    )

    # ── Portfolio transactions ────────────────────────────────────────────────
    # A transaction's symbol is its holding's symbol; following the link repairs
    # them exactly, including the stripped codes, without repeating the mapping.
    op.execute(
        f"""
        UPDATE portfolio_transactions t
        SET symbol = h.symbol
        FROM portfolio_holdings h
        WHERE t.holding_id = h.id
          AND t.symbol IS DISTINCT FROM h.symbol
          AND {_merged_spellings('t.symbol', crypto)}
        """
    )

    # Transactions with no holding to follow get the same rules directly.
    op.execute(
        f"""
        UPDATE portfolio_transactions
        SET symbol = regexp_replace(symbol, '\\.TWO?$', '')
        WHERE holding_id IS NULL AND symbol ~ '{_TW_SUFFIXED}'
        """
    )
    op.execute(
        f"""
        UPDATE portfolio_transactions
        SET symbol = symbol || '-USD'
        WHERE holding_id IS NULL AND symbol IN ({crypto})
        """
    )

    # ── Price history ─────────────────────────────────────────────────────────
    # uq_historical_prices_symbol_date rules out a blind rename: move only the
    # sessions the canonical key is missing, then drop what is left as duplicate.
    op.execute(
        f"""
        UPDATE historical_prices hp
        SET symbol = regexp_replace(hp.symbol, '\\.TWO?$', ''),
            market = 'TW'
        WHERE hp.symbol ~ '{_TW_SUFFIXED}'
          AND NOT EXISTS (
              SELECT 1 FROM historical_prices existing
              WHERE existing.symbol = regexp_replace(hp.symbol, '\\.TWO?$', '')
                AND existing.date = hp.date
          )
        """
    )
    op.execute(f"DELETE FROM historical_prices WHERE symbol ~ '{_TW_SUFFIXED}'")

    # Deleted, never merged onto the pair: nothing in a stored row says whether
    # it priced the coin or the equity that shares its ticker, and folding $28
    # ETF closes into a $60k series is worse than the split.
    #
    # Only where the base is now orphaned, though. If a holding still refers to
    # it — the equity case above, which the type-scoped rename deliberately left
    # alone — those rows are that security's legitimate history.
    op.execute(
        f"""
        DELETE FROM historical_prices hp
        WHERE hp.symbol IN ({crypto})
          AND NOT EXISTS (
              SELECT 1 FROM portfolio_holdings h WHERE h.symbol = hp.symbol
          )
        """
    )

    op.execute(
        f"""
        UPDATE historical_prices
        SET market = 'TW'
        WHERE symbol ~ '{_TW_BARE}' AND market IS DISTINCT FROM 'TW'
        """
    )

    # Dividends follow their holding first, exactly as transactions do — that is
    # what repairs the Excel-stripped codes, which no rule can derive. A dividend
    # left spelled '50' is invisible to every lookup keyed by the holding's
    # repaired symbol.
    op.execute(
        f"""
        UPDATE dividends d
        SET symbol = h.symbol
        FROM portfolio_holdings h
        WHERE d.holding_id = h.id
          AND d.symbol IS DISTINCT FROM h.symbol
          AND {_merged_spellings('d.symbol', crypto)}
        """
    )

    for stripped, intact, name in STRIPPED_TW_CODES:
        op.execute(
            f"""
            UPDATE dividends
            SET symbol = '{intact}'
            WHERE holding_id IS NULL AND symbol = '{stripped}' AND name = '{name}'
            """
        )

    op.execute(
        f"""
        UPDATE dividends
        SET symbol = regexp_replace(symbol, '\\.TWO?$', '')
        WHERE holding_id IS NULL AND symbol ~ '{_TW_SUFFIXED}'
        """
    )
    op.execute(
        f"""
        UPDATE dividends
        SET symbol = symbol || '-USD'
        WHERE holding_id IS NULL AND symbol IN ({crypto})
        """
    )


def downgrade() -> None:
    """Not reversible.

    The merge is lossy by design: once "0050.TW" and "0050" are one key, nothing
    records which rows arrived under which spelling, and re-splitting them would
    recreate the defect this exists to remove. Restore from a backup if the
    merge itself has to be undone.
    """
    pass
