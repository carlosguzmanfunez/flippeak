ALTER TABLE "campaign" ADD CONSTRAINT "campaign_title_valid" CHECK (length(btrim("campaign"."title")) BETWEEN 1 AND 50
        AND strpos("campaign"."title", chr(10)) = 0
        AND strpos("campaign"."title", chr(13)) = 0);--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_summary_valid" CHECK (length(btrim("campaign"."summary")) BETWEEN 1 AND 140
        AND strpos("campaign"."summary", chr(10)) = 0
        AND strpos("campaign"."summary", chr(13)) = 0);--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_title_valid" CHECK (length(btrim("campaign_run"."title")) BETWEEN 1 AND 50
        AND strpos("campaign_run"."title", chr(10)) = 0
        AND strpos("campaign_run"."title", chr(13)) = 0);--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_summary_valid" CHECK (length(btrim("campaign_run"."summary")) BETWEEN 1 AND 140
        AND strpos("campaign_run"."summary", chr(10)) = 0
        AND strpos("campaign_run"."summary", chr(13)) = 0);