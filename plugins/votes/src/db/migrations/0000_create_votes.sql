CREATE TABLE IF NOT EXISTS "upvotes" (
  "id" text PRIMARY KEY NOT NULL,
  "thing_id" text NOT NULL,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "upvotes_thing_user_unique" ON "upvotes" ("thing_id", "user_id");
