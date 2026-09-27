ALTER TABLE "onboarding_code" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "onboarding_code" ADD COLUMN "encrypted_code" text;--> statement-breakpoint
CREATE INDEX "onboardingCode_organizationId_eventId_idx" ON "onboarding_code" USING btree ("organization_id","event_id");