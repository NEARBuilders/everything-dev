ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "operation" text DEFAULT 'create' NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "remove_status" text DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "remove_error" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "removed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "proposal_submissions" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
ALTER TABLE "proposal_submissions" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "proposal_submissions" ADD COLUMN IF NOT EXISTS "payload" text;
--> statement-breakpoint
ALTER TABLE "proposal_submissions" ADD COLUMN IF NOT EXISTS "metadata" text;
--> statement-breakpoint
ALTER TABLE "proposal_audit_log" ADD COLUMN IF NOT EXISTS "actor_label" text;
--> statement-breakpoint
ALTER TABLE "proposal_audit_log" ADD COLUMN IF NOT EXISTS "details" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proposal_submissions_idempotency_unique" ON "proposal_submissions" USING btree ("plugin_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proposals_plugin_entity_operation_unique" ON "proposals" USING btree ("plugin_id","entity_id","operation");
