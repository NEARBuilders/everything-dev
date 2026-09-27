CREATE TABLE "device_link_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deviceLinkClaim_tokenHash_uidx" ON "device_link_claim" USING btree ("token_hash");