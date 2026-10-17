-- Idempotent prod data repair: merge each security onto one symbol spelling.
--
-- Prod schema is NOT migrated by Alembic on deploy, and the Pi is production
-- (Railway/Supabase are not serving). Flow:
--   1. docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--        -f - < backend/scripts/prod_sql/2026_08_26_canonical_symbols.sql
--   2. On the Pi backend: alembic stamp head
-- Matches alembic/versions/2026_08_26_canonical_symbols.py.
--
-- Background: the same securities were stored under several spellings, each
-- accumulating its own separate, different-depth series in historical_prices —
-- 2330 held 65 rows while 2330.TW held 133 of the same ETF's sessions. Two
-- causes, both now closed at the write boundary (app/modules/portfolio/symbols.py):
--
--   * provider dialects — bare codes from FinLab/TWSE, ".TW" from Yahoo, with
--     nothing deciding which one gets stored;
--   * Excel — opening a CSV coerces the ticker column to a number and drops the
--     leading zeros every Taiwan ETF code carries, so "0050" imported as 50 and
--     "00713" as 713. 80 lots came in that way.
--
-- Every history-walking calculation (cost basis, IRR, day change, and
-- time-weighted return above all) keys on this string, so the split made them
-- answer differently depending on which spelling a lot happened to carry.
--
-- The BTC rows are deleted, not merged: "BTC" alone is a live US ticker
-- (Grayscale Bitcoin Mini Trust, ~$28), so what is stored under it is that
-- ETF's history, not Bitcoin's. It re-fetches under BTC-USD.
--
-- Re-runnable: every statement is a no-op once the data is canonical.

BEGIN;

-- ── Holdings ────────────────────────────────────────────────────────────────
-- Yahoo suffix off, and the market label corrected with it: a bare Taiwan code
-- labelled 'US' routes to the US provider, which does not know it.
UPDATE portfolio_holdings
SET symbol = regexp_replace(symbol, '\.TWO?$', ''),
    market = 'TW'
WHERE symbol ~ '^[0-9]+\.TWO?$';

-- Taiwan ETF codes Excel stripped. Padding cannot be derived from the code
-- alone ("50" is 4 wide, "713" is 5, "6208" is 6), so each is matched by the
-- (symbol, name) pair that identifies it unambiguously.
UPDATE portfolio_holdings SET symbol = '0050',   market = 'TW' WHERE symbol = '50'   AND name = '元大台灣50';
UPDATE portfolio_holdings SET symbol = '006208', market = 'TW' WHERE symbol = '6208' AND name = '富邦台灣50';
UPDATE portfolio_holdings SET symbol = '00713',  market = 'TW' WHERE symbol = '713'  AND name = '元大高息低波';

UPDATE portfolio_holdings
SET market = 'TW'
WHERE symbol ~ '^[0-9]+$' AND market IS DISTINCT FROM 'TW';

-- Scoped to holdings actually typed as crypto. Every base listed is also a live
-- equity ticker — LTC is LTC Properties, SOL is ReneSola, ADA is Adams
-- Diversified — so an unscoped rename turns a REIT position into Litecoin,
-- permanently and with nothing to undo it.
UPDATE portfolio_holdings
SET symbol = symbol || '-USD'
-- Both enum spellings: asset_type_enum carries `crypto` AND `cryptocurrency`,
-- and the app treats them as the same thing.
WHERE symbol IN ('BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','AVAX','MATIC','LTC')
  AND type IN ('crypto', 'cryptocurrency');

-- ── Portfolio transactions ──────────────────────────────────────────────────
-- A transaction's symbol is its holding's symbol; following the link repairs
-- them exactly, stripped codes included, without repeating the mapping.
-- Restricted to the spellings being merged. "differs from its holding" alone
-- also matches rows that legitimately carry another ticker — a spin-off, a
-- merger — and rewriting those would be silent and irreversible.
UPDATE portfolio_transactions t
SET symbol = h.symbol
FROM portfolio_holdings h
WHERE t.holding_id = h.id
  AND t.symbol IS DISTINCT FROM h.symbol
  AND (t.symbol ~ '^[0-9]+\.TWO?$' OR t.symbol IN ('50','6208','713') OR t.symbol IN ('BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','AVAX','MATIC','LTC'));

UPDATE portfolio_transactions
SET symbol = regexp_replace(symbol, '\.TWO?$', '')
WHERE holding_id IS NULL AND symbol ~ '^[0-9]+\.TWO?$';

UPDATE portfolio_transactions
SET symbol = symbol || '-USD'
WHERE holding_id IS NULL
  AND symbol IN ('BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','AVAX','MATIC','LTC');

-- ── Price history ───────────────────────────────────────────────────────────
-- uq_historical_prices_symbol_date rules out a blind rename: move only the
-- sessions the canonical key is missing, then drop what is left as duplicate.
-- (Where both spellings hold the same session their closes are identical, so
-- the merge cannot change a price.)
UPDATE historical_prices hp
SET symbol = regexp_replace(hp.symbol, '\.TWO?$', ''),
    market = 'TW'
WHERE hp.symbol ~ '^[0-9]+\.TWO?$'
  AND NOT EXISTS (
      SELECT 1 FROM historical_prices existing
      WHERE existing.symbol = regexp_replace(hp.symbol, '\.TWO?$', '')
        AND existing.date = hp.date
  );

DELETE FROM historical_prices WHERE symbol ~ '^[0-9]+\.TWO?$';

-- Deleted, never merged onto the pair. The BTC collision is not a one-off:
-- bare crypto bases are systematically live equity tickers (BTC and ETH are
-- Grayscale's mini trusts, LTC is LTC Properties, SOL is ReneSola, ADA is Adams
-- Diversified), and nothing in a stored row says which of the two it priced. A
-- merge would fold equity closes into a crypto series silently; dropping them
-- costs one re-fetch.
-- Only where the base is now orphaned. If a holding still refers to it — the
-- equity case the type-scoped rename above deliberately left alone — those rows
-- are that security's legitimate history, not a mislabelled coin.
DELETE FROM historical_prices hp
WHERE hp.symbol IN ('BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','AVAX','MATIC','LTC')
  AND NOT EXISTS (
      SELECT 1 FROM portfolio_holdings h WHERE h.symbol = hp.symbol
  );

UPDATE historical_prices
SET market = 'TW'
WHERE symbol ~ '^[0-9]+$' AND market IS DISTINCT FROM 'TW';

-- ── Dividends ───────────────────────────────────────────────────────────────
-- Same order as transactions: follow the holding first, since that repairs the
-- Excel-stripped codes exactly, then apply the rules to whatever is unlinked.
-- A dividend left spelled '50' is invisible to every lookup keyed by the
-- holding's repaired symbol.
UPDATE dividends d
SET symbol = h.symbol
FROM portfolio_holdings h
WHERE d.holding_id = h.id
  AND d.symbol IS DISTINCT FROM h.symbol
  AND (d.symbol ~ '^[0-9]+\.TWO?$' OR d.symbol IN ('50','6208','713') OR d.symbol IN ('BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','AVAX','MATIC','LTC'));

UPDATE dividends SET symbol = '0050'   WHERE holding_id IS NULL AND symbol = '50'   AND name = '元大台灣50';
UPDATE dividends SET symbol = '006208' WHERE holding_id IS NULL AND symbol = '6208' AND name = '富邦台灣50';
UPDATE dividends SET symbol = '00713'  WHERE holding_id IS NULL AND symbol = '713'  AND name = '元大高息低波';

UPDATE dividends
SET symbol = regexp_replace(symbol, '\.TWO?$', '')
WHERE holding_id IS NULL AND symbol ~ '^[0-9]+\.TWO?$';

UPDATE dividends
SET symbol = symbol || '-USD'
WHERE holding_id IS NULL
  AND symbol IN ('BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','AVAX','MATIC','LTC');

COMMIT;

-- Verify — expect zero rows from each of these:
--
--   SELECT symbol, count(*) FROM portfolio_holdings
--   WHERE symbol ~ '^[0-9]+\.TWO?$' OR symbol IN ('50','6208','713','BTC')
--   GROUP BY 1;
--
--   SELECT symbol, count(*) FROM historical_prices
--   WHERE symbol ~ '^[0-9]+\.TWO?$' OR symbol = 'BTC'
--   GROUP BY 1;
--
-- And one row per security, with the merged depth:
--
--   SELECT symbol, count(*) AS rows, min(date), max(date)
--   FROM historical_prices GROUP BY 1 ORDER BY 1;
--
-- Every rule above matches case-sensitively, which is sound only because the
-- write path has always uppercased. Confirm that still holds here — expect 0:
--
--   SELECT 'holdings' AS t, count(*) FROM portfolio_holdings WHERE symbol <> upper(symbol)
--   UNION ALL SELECT 'txns',      count(*) FROM portfolio_transactions WHERE symbol <> upper(symbol)
--   UNION ALL SELECT 'prices',    count(*) FROM historical_prices WHERE symbol <> upper(symbol)
--   UNION ALL SELECT 'dividends', count(*) FROM dividends WHERE symbol <> upper(symbol);
--
-- And no dividend left on a stripped code — expect 0:
--
--   SELECT symbol, count(*) FROM dividends
--   WHERE symbol IN ('50','6208','713') GROUP BY 1;
