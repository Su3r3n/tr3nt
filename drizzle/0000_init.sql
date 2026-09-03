CREATE TABLE "artifact_blobs" (
	"sha256" char(64) PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"state_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_kind_allowed" CHECK ("artifacts"."kind" in ('code', 'schema', 'interface', 'doc', 'other'))
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"title" text NOT NULL,
	"what" text NOT NULL,
	"why" text NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(14, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_seq_positive" CHECK ("messages"."seq" > 0),
	CONSTRAINT "messages_role_allowed" CHECK ("messages"."role" in ('user', 'assistant', 'system')),
	CONSTRAINT "messages_status_allowed" CHECK ("messages"."status" in ('streaming', 'complete', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_not_blank" CHECK (length(btrim("projects"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"key_ref" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"message_id" uuid,
	"model" text NOT NULL,
	"budget" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(14, 6),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"branch_point_message_id" uuid,
	"branch_point_seq" integer,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"summary_tokens" integer,
	"summary_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "states_title_not_blank" CHECK (length(btrim("states"."title")) > 0),
	CONSTRAINT "states_status_allowed" CHECK ("states"."status" in ('active', 'abandoned', 'merged')),
	CONSTRAINT "states_shape" CHECK (("states"."kind" = 'root' and "states"."parent_id" is null and "states"."branch_point_seq" is null and "states"."depth" = 0)
          or ("states"."kind" = 'branch' and "states"."parent_id" is not null and "states"."branch_point_seq" is not null and "states"."depth" > 0))
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_sha256_artifact_blobs_sha256_fk" FOREIGN KEY ("sha256") REFERENCES "public"."artifact_blobs"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_traces" ADD CONSTRAINT "request_traces_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "states" ADD CONSTRAINT "states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "states" ADD CONSTRAINT "states_parent_id_states_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_state_idx" ON "artifacts" USING btree ("state_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_state_name_sha_uq" ON "artifacts" USING btree ("state_id","name","sha256");--> statement-breakpoint
CREATE INDEX "decisions_state_idx" ON "decisions" USING btree ("state_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_state_seq_uq" ON "messages" USING btree ("state_id","seq");--> statement-breakpoint
CREATE INDEX "request_traces_state_idx" ON "request_traces" USING btree ("state_id");--> statement-breakpoint
CREATE UNIQUE INDEX "states_one_root_per_project" ON "states" USING btree ("project_id") WHERE "states"."parent_id" is null;--> statement-breakpoint
CREATE INDEX "states_project_idx" ON "states" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "states_parent_idx" ON "states" USING btree ("parent_id");