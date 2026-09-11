CREATE TYPE "public"."payment_application_state" AS ENUM('APPLIED', 'UNAPPLIED');--> statement-breakpoint
CREATE TYPE "public"."payment_refund_cause" AS ENUM('NEVER_APPLIED', 'SERVED_EXPOSURE');--> statement-breakpoint
CREATE TYPE "public"."payment_refund_state" AS ENUM('REQUESTED', 'PENDING', 'COMPLETED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."payment_event_state" ADD VALUE 'CAPTURE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."payment_event_state" ADD VALUE 'CAPTURE_DENIED';--> statement-breakpoint
ALTER TYPE "public"."payment_event_state" ADD VALUE 'APPROVAL_REVERSED';--> statement-breakpoint
ALTER TYPE "public"."payment_event_state" ADD VALUE 'REFUND_PENDING';--> statement-breakpoint
ALTER TYPE "public"."payment_event_state" ADD VALUE 'REFUND_FAILED';--> statement-breakpoint
ALTER TYPE "public"."payment_event_state" ADD VALUE 'REFUND_RECORDED';--> statement-breakpoint
ALTER TYPE "public"."payment_event_state" ADD VALUE 'CAPTURE_REVERSED';--> statement-breakpoint
ALTER TYPE "public"."payment_event_state" ADD VALUE 'UNSUPPORTED';--> statement-breakpoint
ALTER TYPE "public"."payment_order_state" ADD VALUE 'REVERSED';--> statement-breakpoint
CREATE TABLE "payment_refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_order_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"provider" text DEFAULT 'paypal' NOT NULL,
	"provider_refund_id" text,
	"state" "payment_refund_state" DEFAULT 'REQUESTED' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"credited_reduction_cents" bigint,
	"non_capacity_refund_cents" bigint,
	"cause" "payment_refund_cause",
	"requested_by" text,
	"detail" text,
	"failure_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payment_refund_amount_positive" CHECK ("payment_refund"."amount_cents" > 0),
	CONSTRAINT "payment_refund_non_negative" CHECK (("payment_refund"."credited_reduction_cents" is null or "payment_refund"."credited_reduction_cents" >= 0)
          and ("payment_refund"."non_capacity_refund_cents" is null or "payment_refund"."non_capacity_refund_cents" >= 0)),
	CONSTRAINT "payment_refund_no_effect_before_completion" CHECK ("payment_refund"."state" = 'COMPLETED'
          or ("payment_refund"."credited_reduction_cents" is null
              and "payment_refund"."non_capacity_refund_cents" is null
              and "payment_refund"."cause" is null
              and "payment_refund"."completed_at" is null)),
	CONSTRAINT "payment_refund_completed_is_complete" CHECK ("payment_refund"."state" <> 'COMPLETED'
          or ("payment_refund"."credited_reduction_cents" is not null
              and "payment_refund"."non_capacity_refund_cents" is not null
              and "payment_refund"."cause" is not null
              and "payment_refund"."completed_at" is not null)),
	CONSTRAINT "payment_refund_decomposition" CHECK ("payment_refund"."credited_reduction_cents" is null
          or "payment_refund"."credited_reduction_cents" + "payment_refund"."non_capacity_refund_cents" = "payment_refund"."amount_cents"),
	CONSTRAINT "payment_refund_never_applied_releases_nothing" CHECK ("payment_refund"."cause" is distinct from 'NEVER_APPLIED' or "payment_refund"."credited_reduction_cents" = 0)
);
--> statement-breakpoint
ALTER TABLE "payment_order" DROP CONSTRAINT "payment_order_capture_id_with_captured_state";--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN "application_state" "payment_application_state";--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_payment_order_id_payment_order_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_run_id_campaign_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."campaign_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refund_provider_refund_uidx" ON "payment_refund" USING btree ("provider","provider_refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refund_one_open_per_order_uidx" ON "payment_refund" USING btree ("payment_order_id") WHERE "payment_refund"."state" in ('REQUESTED', 'PENDING');--> statement-breakpoint
CREATE INDEX "payment_refund_order_idx" ON "payment_refund" USING btree ("payment_order_id");--> statement-breakpoint
CREATE INDEX "payment_refund_run_idx" ON "payment_refund" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_credited_within_exact_domain" CHECK ("campaign_run"."credited_cents" <= 2501999792);--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_capture_id_with_captured_state" CHECK (("payment_order"."state" in ('PENDING', 'APPROVED', 'ABANDONED')) = ("payment_order"."provider_capture_id" is null));