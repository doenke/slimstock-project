ALTER TABLE "plan_versions" ADD COLUMN "no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "base_snapshot" jsonb;