ALTER TABLE "nodes" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN IF NOT EXISTS "kind" text;--> statement-breakpoint
UPDATE "nodes" SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('kind', "kind"::text) WHERE "kind" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" DROP COLUMN IF EXISTS "kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."node_kind";
