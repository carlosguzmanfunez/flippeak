-- B2 / 0009 — deterministic backfill, then the coherence constraint.
--
-- Data backfill always precedes the constraint that depends on it, so a failing
-- CHECK is diagnosable without rolling back the enum and table additions of 0008.
--
-- Every statement is deterministic and evidence-based. Nothing is inferred from
-- absence alone, and nothing ambiguous is classified: where the evidence does
-- not uniquely identify one answer, the row is left untouched and the migration
-- fails closed before the coherence constraint rather than inventing a state.

-- 1. APPLIED requires POSITIVE evidence: the verified ledger row that this very
--    capture produced. run_funding is append-only and keyed by (provider, capture
--    id), so its presence is that evidence.
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

-- 2. Legacy H1-era deliveries: a verified capture FlipPeak could not apply, left
--    with the order carrying no capture at all. Resolved only when the evidence
--    is UNIQUE:
--      - the delivery is a CAPTURED_UNAPPLIED verdict,
--      - the order is reached by the provider order id in the payload,
--      - amount (exact, parsed from the decimal string) and currency match,
--      - no ledger row exists for that capture (so it was never applied),
--      - and the order has EXACTLY ONE distinct candidate capture across all its
--        matching deliveries. Zero candidates -> untouched. More than one
--        distinct capture -> untouched and left for reconciliation, never chosen
--        arbitrarily.
WITH candidates AS (
  SELECT o."id" AS order_id,
         e."payload"->'resource'->>'id' AS capture_id
    FROM "payment_order" o
    JOIN "payment_event" e
      ON e."processing_state" = 'CAPTURED_UNAPPLIED'
     AND e."provider" = o."provider"
     AND o."provider_order_id" IS NOT NULL
     AND o."provider_order_id" = e."payload"->'resource'->'supplementary_data'->'related_ids'->>'order_id'
     AND e."payload"->'resource'->>'id' IS NOT NULL
     AND e."payload"->'resource'->'amount'->>'currency_code' = o."currency"
     AND (e."payload"->'resource'->'amount'->>'value') ~ '^[0-9]+\.[0-9]{2}$'
     AND ((e."payload"->'resource'->'amount'->>'value')::numeric * 100) = o."amount_cents"
     AND NOT EXISTS (
           SELECT 1 FROM "run_funding" f
            WHERE f."run_id" = o."run_id"
              AND f."provider" = o."provider"
              AND f."provider_event_id" = e."payload"->'resource'->>'id'
         )
   WHERE o."state" <> 'CAPTURED'
     AND o."provider_capture_id" IS NULL
),
candidate_counts AS (
  -- Plain aggregation, NOT a window function: PostgreSQL rejects DISTINCT inside
  -- window functions ("DISTINCT is not implemented for window functions"), so the
  -- cardinality must come from a GROUP BY.
  SELECT order_id,
         count(DISTINCT capture_id) AS distinct_captures,
         -- Deterministic: the WHERE below admits only groups with exactly one
         -- distinct capture id, so every row of an admitted group carries the
         -- same value and min() is that value.
         min(capture_id) AS capture_id
    FROM candidates
   GROUP BY order_id
)
UPDATE "payment_order" o
   SET "state" = 'CAPTURED',
       "application_state" = 'UNAPPLIED',
       "provider_capture_id" = c.capture_id
  FROM candidate_counts c
 WHERE o."id" = c.order_id
   AND c.distinct_captures = 1
   AND NOT EXISTS (
         SELECT 1 FROM "payment_order" o2
          WHERE o2."provider" = o."provider"
            AND o2."provider_capture_id" = c.capture_id
       );--> statement-breakpoint

-- 3. Write-once link, restricted to what was ACTUALLY resolved above: the order
--    must be CAPTURED/UNAPPLIED and carry the exact capture id of this delivery.
--    An unresolved or ambiguous delivery keeps payment_id NULL on purpose, so the
--    reconciliation queue can see it.
UPDATE "payment_event" e
   SET "payment_id" = o."id"
  FROM "payment_order" o
 WHERE e."processing_state" = 'CAPTURED_UNAPPLIED'
   AND e."payment_id" IS NULL
   AND e."provider" = o."provider"
   AND o."state" = 'CAPTURED'
   AND o."application_state" = 'UNAPPLIED'
   AND o."provider_capture_id" = e."payload"->'resource'->>'id'
   AND o."provider_order_id" IS NOT NULL
   AND o."provider_order_id" = e."payload"->'resource'->'supplementary_data'->'related_ids'->>'order_id';--> statement-breakpoint

-- 4. Fail closed. A CAPTURED row that has neither a verified ledger row (APPLIED)
--    nor unambiguous evidence of a non-applied capture (UNAPPLIED) is an
--    inconsistency, not a classification problem: the migration refuses to add
--    the coherence constraint and reports the count so a human can resolve it.
--    Silence here would mean inventing financial history.
DO $$
DECLARE
  offending integer;
BEGIN
  SELECT count(*) INTO offending
    FROM "payment_order"
   WHERE "state" = 'CAPTURED'
     AND "application_state" IS NULL;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'B2 0009 fail-closed: % CAPTURED order(s) have no verified ledger row and no unambiguous evidence of a non-applied capture. Resolve them before the coherence constraint can be added.',
      offending;
  END IF;
END $$;--> statement-breakpoint

-- 5. The coherence constraint, now that every capture-bearing row has a decision.
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_application_state_matches_capture" CHECK (("payment_order"."provider_capture_id" is not null) = ("payment_order"."application_state" is not null));
