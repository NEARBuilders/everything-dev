CREATE TABLE "device_code" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp with time zone,
	"polling_interval" integer,
	"client_id" text,
	"scope" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_code" ADD CONSTRAINT "device_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCode_deviceCode_uidx" ON "device_code" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCode_userCode_uidx" ON "device_code" USING btree ("user_code");