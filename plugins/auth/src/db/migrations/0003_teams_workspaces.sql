ALTER TABLE "invitation" ADD COLUMN "near_account_id" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "near_network" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_team_id" text;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "metadata" text;--> statement-breakpoint
CREATE INDEX "invitation_nearAccountId_idx" ON "invitation" USING btree ("near_account_id");--> statement-breakpoint
CREATE INDEX "invitation_nearNetwork_idx" ON "invitation" USING btree ("near_network");