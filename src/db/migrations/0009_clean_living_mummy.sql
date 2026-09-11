-- B2 / 0009 — deterministic backfill, then the coherence constraint.
--
-- Data backfill always precedes the constraint that depends on it, so a failing
-- CHECK is diagnosable without rolling back the enum and table additions of 0008.
--
-- Every statement is deterministic and evidence-based. Nothing is classified
-- silently: where the evidence is absent the row is left untouched, and the
-- post-migration verification reports it for manual reconciliation.

-- 1. Legacy CAPTURED orders that hold their verified ledger row were APPLIED.
--    run_funding is append-only and keyed by (provider, capture id), so the
--    presence of that row IS the evidence that the capture reached credited_cents.
UPDATE "payment_order" o
   SET "application_state" = 'APPLIED'
 WHERE o."state" = 'CAPTURED'
   AND o."application_state" IS NULL
   AND o."provider_capture_id" IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM "run_funding" f
          WHERE f."run_id" = o."run_id"
            AND f."provider" = o."provider"
            AND f."provider_event_id" = o."provider_capture_id"
            AND f."verified"
       );--> statement-breakpoint

-- 2. Legacy CAPTURED orders with NO ledger row were captured and never applied.
--    The absence is the evidence: an applied capture would have left a row.
UPDATE "payment_order" o
   SET "application_state" = 'UNAPPLIED'
 WHERE o."state" = 'CAPTURED'
   AND o."application_state" IS NULL
   AND o."provider_capture_id" IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM "run_funding" f
          WHERE f."run_id" = o."run_id"
            AND f."provider" = o."provider"
            AND f."provider_event_id" = o."provider_capture_id"
            AND f."verified"
       );--> statement-breakpoint

-- 3. Legacy H1-era deliveries: a verified capture FlipPeak could not apply, left
--    with the order still lacking a capture. Resolved ONLY when every piece of
--    evidence agrees:
--      - the delivery carries the CAPTURED_UNAPPLIED verdict,
--      - the order is found by the provider order id in the payload,
--      - neither this order nor another order already owns that capture id,
--      - the payload amount (exact, from the decimal string) and currency match,
--      - no ledger row exists for the capture, so it was never applied.
--    Anything ambiguous is deliberately left alone for manual reconciliation.
UPDATE "payment_order" o
   SET "state" = 'CAPTURED',
       "application_state" = 'UNAPPLIED',
       "provider_capture_id" = e."payload"->'resource'->>'id'
  FROM "payment_event" e
 WHERE e."processing_state" = 'CAPTURED_UNAPPLIED'
   AND e."provider" = o."provider"
   AND o."state" <> 'CAPTURED'
   AND o."provider_capture_id" IS NULL
   AND o."provider_order_id" IS NOT NULL
   AND o."provider_order_id" = e."payload"->'resource'->'supplementary_data'->'related_ids'->>'order_id'
   AND e."payload"->'resource'->>'id' IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM "payment_order" o2
          WHERE o2."provider" = o."provider"
            AND o2."provider_capture_id" = e."payload"->'resource'->>'id'
       )
   AND e."payload"->'resource'->'amount'->>'currency_code' = o."currency"
   AND (e."payload"->'resource'->'amount'->>'value') ~ '^[0-9]+\.[0-9]{2}$'
   AND ((e."payload"->'resource'->'amount'->>'value')::numeric * 100) = o."amount_cents"
   AND NOT EXISTS (
         SELECT 1 FROM "run_funding" f
          WHERE f."run_id" = o."run_id"
            AND f."provider" = o."provider"
            AND f."provider_event_id" = e."payload"->'resource'->>'id'
       );--> statement-breakpoint

-- 4. Write-once link of every resolved legacy delivery to its order. Only rows
--    whose payment_id is still NULL are touched, and the predicate is the pair
--    (provider, provider order id) — never the event id alone.
UPDATE "payment_event" e
   SET "payment_id" = o."id"
  FROM "payment_order" o
 WHERE e."processing_state" = 'CAPTURED_UNAPPLIED'
   AND e."payment_id" IS NULL
   AND e."provider" = o."provider"
   AND o."provider_order_id" IS NOT NULL
   AND o."provider_order_id" = e."payload"->'resource'->'supplementary_data'->'related_ids'->>'order_id';--> statement-breakpoint

-- 5. The coherence constraint, now that every capture-bearing row has a decision.
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_application_state_matches_capture" CHECK (("payment_order"."provider_capture_id" is not null) = ("payment_order"."application_state" is not null));
