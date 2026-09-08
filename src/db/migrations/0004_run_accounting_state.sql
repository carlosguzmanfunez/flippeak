ALTER TABLE "campaign_run" ADD COLUMN "credited_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_run" ADD COLUMN "consumed_cent_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_run" ADD COLUMN "rate_anchor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_credited_non_negative" CHECK ("campaign_run"."credited_cents" >= 0);--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_consumed_non_negative" CHECK ("campaign_run"."consumed_cent_ms" >= 0);--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_consumed_within_credit" CHECK ("campaign_run"."consumed_cent_ms" <= "campaign_run"."credited_cents" * 3600000);--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_anchor_matches_status" CHECK (("campaign_run"."status" = 'DRAFT') = ("campaign_run"."rate_anchor_at" IS NULL));