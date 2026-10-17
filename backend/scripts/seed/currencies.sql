-- Reference rows for the `currencies` table, which `transactions.currency` references.
--
-- Nothing else creates them: no migration and no startup code seeds this table, so a
-- fresh database cannot record a single transaction ("Key (currency)=(TWD) is not
-- present in table currencies"). Production has had these rows since 2025-10; the
-- values below are copied from it (2026-10-06), rates included — exchange_rate_usd is
-- a fallback in portfolio FX conversion (portfolio/services.py).
--
-- Idempotent: existing rows are left alone, so running it against production changes
-- nothing. Used by the image smoke test (scripts/ci/smoke_images.sh).
--   psql "$DATABASE_URL" -f backend/scripts/seed/currencies.sql

INSERT INTO currencies (code, name, symbol, exchange_rate_usd, region, is_major, is_active, last_updated, created_at, updated_at)
VALUES
  ('CNY', 'Chinese Yuan',     '¥',   0.14000000, 'China',         true, true, now(), now(), now()),
  ('HKD', 'Hong Kong Dollar', 'HK$', 0.13000000, 'Hong Kong',     true, true, now(), now(), now()),
  ('JPY', 'Japanese Yen',     '¥',   0.00670000, 'Japan',         true, true, now(), now(), now()),
  ('SGD', 'Singapore Dollar', 'S$',  0.74000000, 'Singapore',     true, true, now(), now(), now()),
  ('TWD', 'Taiwan Dollar',    'NT$', 0.03200000, 'Taiwan',        true, true, now(), now(), now()),
  ('USD', 'US Dollar',        '$',   1.00000000, 'United States', true, true, now(), now(), now())
ON CONFLICT (code) DO NOTHING;
