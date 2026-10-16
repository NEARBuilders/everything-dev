CREATE TABLE "agent_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_account_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"grant_id" text,
	"correlation_id" text,
	"label" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"token_iv" text NOT NULL,
	"commitment" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"intent_type" text NOT NULL,
	"agent_id" text,
	"grant_row_id" text,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agentAccount_agentId_uidx" ON "agent_account" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agentAccount_userId_idx" ON "agent_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agentGrant_agentId_idx" ON "agent_grant" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agentGrant_userId_idx" ON "agent_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agentGrant_commitment_idx" ON "agent_grant" USING btree ("commitment");--> statement-breakpoint
CREATE UNIQUE INDEX "ownerIntent_correlationId_uidx" ON "owner_intent" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ownerIntent_idempotencyKey_uidx" ON "owner_intent" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ownerIntent_userId_idx" ON "owner_intent" USING btree ("user_id");