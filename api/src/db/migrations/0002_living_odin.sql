CREATE TABLE "discovery_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_node_id" uuid NOT NULL,
	"canonical_url" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_curators" (
	"user_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_features" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"target_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_luma_connections" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"calendar_id" text NOT NULL,
	"calendar_name" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "discovery_measurements" (
	"key" text PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"node_id" uuid,
	"campaign" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_profiles" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"token" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_activities" ADD CONSTRAINT "discovery_activities_owner_node_id_nodes_id_fk" FOREIGN KEY ("owner_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_features" ADD CONSTRAINT "discovery_features_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_history" ADD CONSTRAINT "discovery_history_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_luma_connections" ADD CONSTRAINT "discovery_luma_connections_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_measurements" ADD CONSTRAINT "discovery_measurements_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_profiles" ADD CONSTRAINT "discovery_profiles_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_manual_url" ON "discovery_activities" USING btree ("canonical_url") WHERE "discovery_activities"."data"->'luma' IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_luma_node_url" ON "discovery_activities" USING btree ("owner_node_id","canonical_url") WHERE "discovery_activities"."data"->'luma' IS NOT NULL;--> statement-breakpoint
CREATE INDEX "discovery_measurement_visit" ON "discovery_measurements" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "discovery_measurement_time" ON "discovery_measurements" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_report_token_target" ON "discovery_reports" USING btree ("token","target_id");