CREATE TABLE "runtime_secrets" (
	"account" text NOT NULL,
	"gateway" text NOT NULL,
	"name" text NOT NULL,
	"sealed_value" text NOT NULL,
	"set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_secrets_runtime_name_key" UNIQUE("account","gateway","name")
);
