CREATE TABLE "run_funding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"funding_cents" bigint NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_funding_amount_positive" CHECK ("run_funding"."funding_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "run_funding" ADD CONSTRAINT "run_funding_run_id_campaign_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."campaign_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_funding_provider_event_uidx" ON "run_funding" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "run_funding_run_idx" ON "run_funding" USING btree ("run_id");