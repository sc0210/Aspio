-- ============================================================================
-- Aspiro — clear receipt data invented by the old attachment placeholder
--
-- `AttachmentService._process_attachment` used to be a stub. It ran on EVERY image
-- upload, not only in demo mode, and because its `confidence` was a hardcoded 0.85 —
-- always above its own 0.8 gate — it stamped the user's real transaction whenever
-- that transaction had no merchant yet:
--
--     merchant_name = 'Sample Store'
--     receipt_data  = {"merchant_detected": "Sample Store",
--                      "amount_detected": 25.0, "date_detected": ..., "confidence": 0.85}
--
-- and wrote "Merchant: Sample Store / Amount: $25.00" into the attachment's ocr_text.
--
-- Made-up money data in a personal finance ledger. The code no longer writes it
-- (upload stores the file; POST /scan-receipt does OCR and RETURNS the parse for the
-- user to confirm), but rows written before that deploy still carry it.
--
-- Read-only until you say otherwise: run the SELECTs first and look at what comes
-- back. A user may since have typed a real merchant over the top, or genuinely shop
-- somewhere called Sample Store, so the UPDATEs are deliberately narrow — they only
-- touch rows where the fabricated receipt_data is still attached.
--
-- Idempotent: running it twice changes nothing the second time.
--
-- Usage on the Pi (production):
--   docker exec -i aspiro-postgres psql -U aspiro_user -d aspiro_db \
--     -f - < backend/scripts/prod_sql/2026_09_25_clear_placeholder_receipt_data.sql
-- ============================================================================

\echo ''
\echo '=== 1. What is affected (read-only) ==============================='

SELECT 'transactions with the placeholder merchant' AS what,
       count(*) AS rows
FROM transactions
WHERE merchant_name = 'Sample Store'
  AND receipt_data ->> 'merchant_detected' = 'Sample Store';

SELECT 'attachments with the placeholder ocr_text' AS what,
       count(*) AS rows
FROM transaction_attachments
WHERE ocr_text LIKE '%Merchant: Sample Store%';

-- Rows where the user typed their own merchant OVER the placeholder. The blob is
-- still attached and still served by the API (receipt_data is in the transaction
-- response schema), so `amount_detected: 25.0` still reaches the client. The repair
-- below clears the blob on these while leaving the merchant the user chose.
SELECT 'fabricated blob present but merchant edited by the user' AS what,
       count(*) AS rows
FROM transactions
WHERE receipt_data ->> 'merchant_detected' = 'Sample Store'
  AND merchant_name IS DISTINCT FROM 'Sample Store';

-- The ones NOT repaired, so they are not a surprise: named Sample Store with no
-- fabricated blob, which is indistinguishable from a real shop of that name.
SELECT 'transactions named Sample Store WITHOUT the fabricated blob (left alone)' AS what,
       count(*) AS rows
FROM transactions
WHERE merchant_name = 'Sample Store'
  AND (receipt_data IS NULL OR receipt_data ->> 'merchant_detected' IS DISTINCT FROM 'Sample Store');

\echo ''
\echo '=== 2. The rows themselves, to eyeball before repairing ==========='

SELECT id, transaction_date, amount, merchant_name, receipt_data
FROM transactions
WHERE receipt_data ->> 'merchant_detected' = 'Sample Store'
ORDER BY transaction_date DESC
LIMIT 50;

\echo ''
\echo '=== 3. Repair — uncomment the BEGIN/COMMIT block to apply ========='

-- BEGIN;
--
-- Merchant first, while the blob still identifies the row — and only where the
-- placeholder's own name is still there, so a merchant the user typed is kept.
-- UPDATE transactions
--    SET merchant_name = NULL
--  WHERE merchant_name = 'Sample Store'
--    AND receipt_data ->> 'merchant_detected' = 'Sample Store';
--
-- Then the blob, keyed on itself, so rows whose merchant was edited are reached too.
-- The API serves receipt_data, so leaving it means still serving amount_detected 25.0.
-- UPDATE transactions
--    SET receipt_data = NULL
--  WHERE receipt_data ->> 'merchant_detected' = 'Sample Store';
--
-- UPDATE transaction_attachments
--    SET ocr_text = NULL
--  WHERE ocr_text LIKE '%Merchant: Sample Store%';
--
-- -- Expect both counts to be 0 now.
-- SELECT count(*) AS remaining_transactions
--   FROM transactions
--  WHERE receipt_data ->> 'merchant_detected' = 'Sample Store';
--
-- SELECT count(*) AS remaining_attachments
--   FROM transaction_attachments
--  WHERE ocr_text LIKE '%Merchant: Sample Store%';
--
-- COMMIT;

\echo ''
\echo 'Section 3 is commented out on purpose. Read sections 1 and 2 first.'
\echo ''
