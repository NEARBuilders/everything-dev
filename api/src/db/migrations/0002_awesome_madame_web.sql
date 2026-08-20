ALTER TABLE "tenants" ADD COLUMN "allow_ui_overrides" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "allow_backend_overrides" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "allow_ssr" boolean DEFAULT false NOT NULL;