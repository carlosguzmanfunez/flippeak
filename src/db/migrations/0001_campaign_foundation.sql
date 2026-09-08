CREATE TYPE "public"."campaign_category" AS ENUM('creators', 'music-and-artists', 'events', 'gaming', 'apps', 'ai', 'tech', 'startups', 'ecommerce', 'entertainment', 'education', 'other');--> statement-breakpoint
CREATE TYPE "public"."campaign_run_status" AS ENUM('DRAFT', 'ACTIVE', 'EXHAUSTED');--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"destination_url" text NOT NULL,
	"category" "campaign_category" NOT NULL,
	"subtype" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_subtype_not_blank" CHECK (length(btrim("campaign"."subtype")) > 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"previous_run_id" uuid,
	"status" "campaign_run_status" DEFAULT 'DRAFT' NOT NULL,
	"time_rate_cents_per_hour" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"destination_url" text NOT NULL,
	"category" "campaign_category" NOT NULL,
	"subtype" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_run_id_campaign_id_uk" UNIQUE("id","campaign_id"),
	CONSTRAINT "campaign_run_subtype_not_blank" CHECK (length(btrim("campaign_run"."subtype")) > 0),
	CONSTRAINT "campaign_run_time_rate_band" CHECK ("campaign_run"."time_rate_cents_per_hour" BETWEEN 100 AND 100000),
	CONSTRAINT "campaign_run_no_self_reference" CHECK ("campaign_run"."previous_run_id" IS NULL OR "campaign_run"."previous_run_id" <> "campaign_run"."id")
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_previous_run_fk" FOREIGN KEY ("previous_run_id","campaign_id") REFERENCES "public"."campaign_run"("id","campaign_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_owner_user_id_idx" ON "campaign" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "campaign_run_campaign_id_idx" ON "campaign_run" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_run_one_active_per_campaign_uidx" ON "campaign_run" USING btree ("campaign_id") WHERE "campaign_run"."status" = 'ACTIVE';