CREATE TABLE "upvotes" (
	"id" text PRIMARY KEY NOT NULL,
	"thing_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "upvotes_thing_user_unique" ON "upvotes" USING btree ("thing_id","user_id");