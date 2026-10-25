ALTER TABLE "team" ADD COLUMN "event_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "near_account_accountId_network_uidx" ON "near_account" USING btree ("account_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX "team_organizationId_eventId_uidx" ON "team" USING btree ("organization_id","event_id");