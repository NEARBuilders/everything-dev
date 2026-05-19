ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "content" text;--> statement-breakpoint
