CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'pending_deletion');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subdomain" text NOT NULL,
	"account_id" text NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "tenants_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "tenants_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_subdomain_idx" ON "tenants" USING btree ("subdomain");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_account_id_idx" ON "tenants" USING btree ("account_id");