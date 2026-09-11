-- B2 / 0010 — the one-blocking-order-per-run index, behind a fail-closed preflight.
--
-- Real history can hold more than one blocking order on a single run (an
-- APPROVED plus one or more PENDING orders that were created before the rule
-- existed). Such a run cannot take the index, and the migration must NOT "fix"
-- it by inventing ABANDONED: retiring an order requires provider evidence that it
-- can no longer be captured, which is a reconciliation step performed against
-- PayPal, not a data edit performed here.
--
-- This preflight therefore refuses to proceed and reports how much history needs
-- reconciling. `assessBlockingHistory` (src/lib/blocking-order-preflight.ts) is
-- the reconciliation path that supplies the provider evidence.

DO $$
DECLARE
  offending_runs integer;
  offending_orders integer;
BEGIN
  SELECT count(*) INTO offending_runs
    FROM (
      SELECT "run_id"
        FROM "payment_order"
       WHERE "state" <> 'ABANDONED'
         AND "state" <> 'REFUNDED'
         AND ("state" <> 'CAPTURED' OR "application_state" = 'UNAPPLIED')
       GROUP BY "run_id"
      HAVING count(*) > 1
    ) AS blocked_runs;

  IF offending_runs > 0 THEN
    SELECT count(*) INTO offending_orders
      FROM "payment_order"
     WHERE "state" <> 'ABANDONED'
       AND "state" <> 'REFUNDED'
       AND ("state" <> 'CAPTURED' OR "application_state" = 'UNAPPLIED')
       AND "run_id" IN (
             SELECT "run_id"
               FROM "payment_order"
              WHERE "state" <> 'ABANDONED'
                AND "state" <> 'REFUNDED'
                AND ("state" <> 'CAPTURED' OR "application_state" = 'UNAPPLIED')
              GROUP BY "run_id"
             HAVING count(*) > 1
           );

    RAISE EXCEPTION
      'B2 0010 preflight: % run(s) hold % simultaneously blocking order(s). The index cannot be created until those are reconciled against the provider. Do NOT mark them ABANDONED to make this migration pass.',
      offending_runs, offending_orders;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "payment_order_one_blocking_per_run_uidx" ON "payment_order" USING btree ("run_id") WHERE "payment_order"."state" <> 'ABANDONED'
            and "payment_order"."state" <> 'REFUNDED'
            and ("payment_order"."state" <> 'CAPTURED' or "payment_order"."application_state" = 'UNAPPLIED');
