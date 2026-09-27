CREATE TABLE "onboarding_code" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"organization_id" text NOT NULL,
	"event_name" text NOT NULL,
	"team_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"max_uses" integer DEFAULT 50 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"code_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_code" ADD CONSTRAINT "onboarding_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_code" ADD CONSTRAINT "onboarding_code_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_code" ADD CONSTRAINT "onboarding_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_redemption" ADD CONSTRAINT "onboarding_redemption_code_id_onboarding_code_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."onboarding_code"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_redemption" ADD CONSTRAINT "onboarding_redemption_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboardingCode_codeHash_uidx" ON "onboarding_code" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "onboardingRedemption_codeId_userId_uidx" ON "onboarding_redemption" USING btree ("code_id","user_id");--> statement-breakpoint
CREATE INDEX "onboardingRedemption_codeId_idx" ON "onboarding_redemption" USING btree ("code_id");