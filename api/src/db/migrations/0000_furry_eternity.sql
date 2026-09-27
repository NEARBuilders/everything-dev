CREATE TYPE "public"."node_kind" AS ENUM('country', 'state', 'city');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'pending', 'suspended', 'pending_deletion');--> statement-breakpoint
CREATE TYPE "public"."validator_role" AS ENUM('official', 'community');--> statement-breakpoint
CREATE TABLE "domain_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_bindings_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "node_kind" NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"tenant_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"allow_ui_overrides" boolean DEFAULT true NOT NULL,
	"allow_backend_overrides" boolean DEFAULT false NOT NULL,
	"allow_ssr" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "validators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"network" text DEFAULT 'mainnet' NOT NULL,
	"protocol" text DEFAULT 'near' NOT NULL,
	"role" "validator_role" DEFAULT 'official' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_bindings" ADD CONSTRAINT "domain_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_id_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validators" ADD CONSTRAINT "validators_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_bindings_tenant_idx" ON "domain_bindings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_bindings_one_primary_per_tenant_idx" ON "domain_bindings" USING btree ("tenant_id") WHERE is_primary = true;--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_parent_slug_idx" ON "nodes" USING btree ("parent_id","slug") WHERE parent_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_root_slug_idx" ON "nodes" USING btree ("slug") WHERE parent_id IS NULL;--> statement-breakpoint
CREATE INDEX "nodes_parent_idx" ON "nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "nodes_tenant_idx" ON "nodes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "validators_node_idx" ON "validators" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "validators_one_default_per_node_idx" ON "validators" USING btree ("node_id") WHERE is_default = true;