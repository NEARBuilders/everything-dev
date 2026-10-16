CREATE TABLE "custody_wallet" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network" text NOT NULL,
	"wallet_id" text NOT NULL,
	"near_account_id" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"handoff_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "custody_wallet" ADD CONSTRAINT "custody_wallet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custodyWallet_userId_network_uidx" ON "custody_wallet" USING btree ("user_id","network");