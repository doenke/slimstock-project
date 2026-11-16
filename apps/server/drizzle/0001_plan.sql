CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"parent_key" uuid,
	"subproject_id" uuid,
	"title" text NOT NULL,
	"sort" double precision DEFAULT 0 NOT NULL,
	"pm" jsonb DEFAULT '{"deps":{}}'::jsonb NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"actual_start" date,
	"actual_end" date,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"origin" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'editing' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text,
	"based_on_version_id" uuid,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"replaced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_subproject_id_projects_id_fk" FOREIGN KEY ("subproject_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_items_version_key_idx" ON "plan_items" USING btree ("version_id","key");--> statement-breakpoint
CREATE INDEX "plan_versions_project_idx" ON "plan_versions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_one_working_idx" ON "plan_versions" USING btree ("project_id") WHERE kind = 'working';