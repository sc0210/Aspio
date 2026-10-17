-- ============================================================================
-- Aspiro — realign Life Wallet legs left behind by the purchase-date edit bug
--
-- Until 2026-09-25, editing a holding's purchase date moved the holding and never
-- touched the ledger: the `linked.transaction_date` assignment sat inside a branch
-- gated on `quantity_changed or cost_changed`, so a date-only edit reached nothing.
-- The holding says one day, the Life Wallet expense that paid for it says another,
-- and for a purchase near the 1st the two sit in different months — so the holding
-- and the spending report disagree about which month the money left.
--
-- The code no longer does this, and it repairs what it safely can: a lot with ONE
-- linked leg moves that leg whenever the date is corrected. What it deliberately
-- will not do is decide for a lot with SEVERAL legs that agree on some other day.
-- Those are ambiguous from inside the request: they are either drift from this bug,
-- or genuine buys that merged into an older lot (`?aggregate=true` with no
-- purchase_date merges into the most recent lot whatever its date, and dates the new
-- leg today). Moving them on the wrong guess takes real purchases out of the month
-- they happened in — the very thing being fixed.
--
-- So that judgement is made here, by a person, looking at the rows.
--
-- Read-only as shipped: run sections 1 and 2 and read what comes back. Section 3
-- repairs only lots whose legs all agree on ONE day that differs from the holding's
-- Taipei day, and is commented out until you have decided the holding's date is the
-- one to trust. It is idempotent: a second run finds nothing.
--
-- Usage on the Pi (production):
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--     -f - < backend/scripts/prod_sql/2026_09_25_realign_drifted_holding_legs.sql
-- ============================================================================

\echo ''
\echo '=== 0. The day basis this script uses ============================='

-- purchase_date is timestamptz and the server runs UTC, so its calendar day has to
-- be read in Asia/Taipei — the app's business day. A purchase stamped
-- 2026-08-31T20:00Z is 2026-09-01 in Taipei, and the buy path booked the expense on
-- 09-01 accordingly. Reading .date() off the UTC value is the same off-by-one-day
-- mistake in SQL form.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'portfolio_holdings'
   AND column_name = 'purchase_date';

SELECT current_setting('TimeZone') AS server_timezone;

CREATE TEMP VIEW drifted AS
SELECT h.id                                              AS holding_id,
       h.user_id,
       h.symbol,
       h.purchase_date,
       (h.purchase_date AT TIME ZONE 'Asia/Taipei')::date AS holding_day,
       count(*)                                          AS legs,
       count(DISTINCT t.transaction_date)                AS leg_days,
       min(t.transaction_date)                           AS leg_day
  FROM portfolio_holdings h
  JOIN transactions t
    ON t.holding_id = h.id
   AND t.is_deleted = false
   -- The legs that PAID for the holding, and nothing else. holding_id is also set
   -- on the INCOME leg a cash withdrawal writes, dated its own withdrawal day, and
   -- a cancelled row keeps its link too. Counting those makes a single drifted lot
   -- look like a multi-day one and drops it from the repair; re-dating them moves a
   -- withdrawal that has nothing to do with the purchase. (The enum columns store
   -- NAMES, so these are upper case.)
   AND t.type = 'EXPENSE'
   AND t.status = 'COMPLETED'
 WHERE h.purchase_date IS NOT NULL
 GROUP BY h.id, h.user_id, h.symbol, h.purchase_date;

\echo ''
\echo '=== 1. How much is out of step (read-only) ========================'

SELECT 'holdings whose legs agree on one day that is NOT the holding day' AS what,
       count(*) AS holdings,
       sum(legs) AS legs
  FROM drifted
 WHERE leg_days = 1
   AND leg_day <> holding_day;

SELECT 'of those, where the two days fall in different months' AS what,
       count(*) AS holdings
  FROM drifted
 WHERE leg_days = 1
   AND leg_day <> holding_day
   AND date_trunc('month', leg_day) <> date_trunc('month', holding_day);

-- NOT repaired by section 3, and listed so they are not a surprise: legs spread
-- over several days. A lot reaches this shape by merging buys with no purchase_date,
-- where the differing days are real. The app leaves these alone too, except for any
-- leg already sitting on the holding's own day, which follows a date correction.
SELECT 'holdings whose legs sit on several days (left alone)' AS what,
       count(*) AS holdings,
       sum(legs) AS legs
  FROM drifted
 WHERE leg_days > 1;

SELECT 'holdings already in step (nothing to do)' AS what,
       count(*) AS holdings
  FROM drifted
 WHERE leg_days = 1
   AND leg_day = holding_day;

\echo ''
\echo '=== 2. The rows themselves, to eyeball before repairing ==========='

-- Read this before uncommenting anything. The question section 3 answers one way is
-- "which of these two days is right?" — and it assumes the holding's. If a row here
-- shows a leg on a day you remember buying on, and a holding date you do not
-- recognise, then for that row the answer is the other way round: use the id list in
-- section 3 to leave it out, and fix the holding instead.
--
-- A leg you corrected by hand in the ledger looks exactly like drift here, and would
-- be reset. That state is supported by the app — a date edit that resends the same
-- business day deliberately leaves such a leg alone — so the CSV in section 3 is
-- what you undo from if one of these rows turns out to have been deliberate.
--
-- No LIMIT on purpose: section 3 rewrites every row this lists, so a limit here
-- would repair rows nobody had looked at.
SELECT holding_id, symbol, purchase_date, holding_day, leg_day, legs,
       (leg_day - holding_day) AS days_apart
  FROM drifted
 WHERE leg_days = 1
   AND leg_day <> holding_day
 ORDER BY abs(leg_day - holding_day) DESC, holding_day DESC;

\echo ''
\echo '=== 3. Repair — uncomment the BEGIN/COMMIT block to apply ========='

-- FIRST, the before-image. transactions keeps no history, so once the UPDATE below
-- is committed the old dates exist nowhere else. Run this on the HOST, in its own
-- psql session, before uncommenting anything — a `\copy` inside the script would
-- write the file into the container, where it is no use to you. A table instead of a
-- CSV would need RLS under the new-table rule.
--
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db -At -F, -c "
--     SELECT t.id, t.holding_id, t.transaction_date AS was,
--            (h.purchase_date AT TIME ZONE 'Asia/Taipei')::date AS becomes
--       FROM transactions t
--       JOIN portfolio_holdings h ON h.id = t.holding_id
--      WHERE t.is_deleted = false
--        AND t.type = 'EXPENSE' AND t.status = 'COMPLETED'
--        AND h.id IN (
--          SELECT h2.id FROM portfolio_holdings h2
--            JOIN transactions t2 ON t2.holding_id = h2.id AND t2.is_deleted = false
--                                AND t2.type = 'EXPENSE' AND t2.status = 'COMPLETED'
--           WHERE h2.purchase_date IS NOT NULL
--           GROUP BY h2.id, h2.purchase_date
--          HAVING count(DISTINCT t2.transaction_date) = 1
--             AND min(t2.transaction_date)
--                 <> (h2.purchase_date AT TIME ZONE 'Asia/Taipei')::date)
--   " > realign_legs_before.csv
--
-- The CSV query and the UPDATE below define drift twice, in two sessions, so
-- reconcile them before committing: `wc -l` on the CSV (minus nothing — it has no
-- header) must equal the row count the UPDATE reports. If they differ, one of the
-- two has been edited and not the other, and the undo file is incomplete. ROLLBACK.
--
-- To undo one row afterwards:
--   UPDATE transactions SET transaction_date = '<was>' WHERE id = '<id>';
--
-- BEGIN;
--
-- UPDATE transactions t
--    SET transaction_date = d.holding_day
--   FROM drifted d
--  WHERE t.holding_id = d.holding_id
--    AND t.is_deleted = false
--    AND t.type = 'EXPENSE'
--    AND t.status = 'COMPLETED'
--    AND d.leg_days = 1
--    AND d.leg_day <> d.holding_day
--    -- To repair only some of what section 2 listed — say a row whose leg date you
--    -- recognise as the real purchase day and whose holding date you do not — add
--    -- the ids you DO want and leave the rest for another day:
--    -- AND d.holding_id = ANY(ARRAY['00000000-0000-0000-0000-000000000000']::uuid[])
--    ;
--
-- -- Expect 0: the view is recomputed, so anything left here was not repaired.
-- SELECT count(*) AS still_out_of_step
--   FROM (
--     SELECT h.id,
--            (h.purchase_date AT TIME ZONE 'Asia/Taipei')::date AS holding_day,
--            count(DISTINCT t.transaction_date) AS leg_days,
--            min(t.transaction_date) AS leg_day
--       FROM portfolio_holdings h
--       JOIN transactions t ON t.holding_id = h.id AND t.is_deleted = false
--                          AND t.type = 'EXPENSE' AND t.status = 'COMPLETED'
--      WHERE h.purchase_date IS NOT NULL
--      GROUP BY h.id, h.purchase_date
--   ) again
--  WHERE leg_days = 1
--    AND leg_day <> holding_day;
--
-- COMMIT;

\echo ''
\echo 'Section 3 is commented out on purpose. Read sections 1 and 2 first.'
\echo ''
