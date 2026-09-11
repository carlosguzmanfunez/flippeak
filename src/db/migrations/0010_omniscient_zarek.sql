CREATE UNIQUE INDEX "payment_order_one_blocking_per_run_uidx" ON "payment_order" USING btree ("run_id") WHERE "payment_order"."state" <> 'ABANDONED'
            and "payment_order"."state" <> 'REFUNDED'
            and ("payment_order"."state" <> 'CAPTURED' or "payment_order"."application_state" = 'UNAPPLIED');