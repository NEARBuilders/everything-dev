ALTER TABLE "organization" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;