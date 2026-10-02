ALTER TABLE "organization" DROP CONSTRAINT "organization_requested_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;