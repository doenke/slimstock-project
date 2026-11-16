CREATE TABLE "plan_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"item_key" uuid,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "version_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"comment" text,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "link_token_hash" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "link_token_enc" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "link_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "link_last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_comments" ADD CONSTRAINT "plan_comments_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_comments" ADD CONSTRAINT "plan_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_reviews" ADD CONSTRAINT "version_reviews_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_reviews" ADD CONSTRAINT "version_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_comments_version_idx" ON "plan_comments" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "version_reviews_version_idx" ON "version_reviews" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_link_idx" ON "memberships" USING btree ("link_token_hash");