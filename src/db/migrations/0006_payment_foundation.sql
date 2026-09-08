CREATE TYPE "public"."payment_event_state" AS ENUM('PENDING_RETRY', 'PROCESSED', 'DUPLICATE_CAPTURE', 'ORPHAN_CAPTURE', 'NO_ACTIVATION', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."payment_order_state" AS ENUM('PENDING', 'APPROVED', 'CAPTURED', 'ABANDONED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "payment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processing_state" "payment_event_state" DEFAULT 'PENDING_RETRY' NOT NULL,
	"failure_detail" text,
	"payload" jsonb NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"state" "payment_order_state" DEFAULT 'PENDING' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"provider" text DEFAULT 'paypal' NOT NULL,
	"provider_order_id" text,
	"provider_capture_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_order_amount_positive" CHECK ("payment_order"."amount_cents" > 0),
	CONSTRAINT "payment_order_amount_exact_domain" CHECK ("payment_order"."amount_cents" <= 2501999792),
	CONSTRAINT "payment_order_currency_usd_only" CHECK ("payment_order"."currency" = 'USD'),
	CONSTRAINT "payment_order_capture_id_with_captured_state" CHECK ((("payment_order"."state" = 'CAPTURED') or ("payment_order"."state" = 'REFUNDED')) = ("payment_order"."provider_capture_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_payment_id_payment_order_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_run_id_campaign_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."campaign_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_provider_event_uidx" ON "payment_event" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_event_payment_idx" ON "payment_event" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_provider_order_uidx" ON "payment_order" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_provider_capture_uidx" ON "payment_order" USING btree ("provider","provider_capture_id");--> statement-breakpoint
CREATE INDEX "payment_order_run_idx" ON "payment_order" USING btree ("run_id");