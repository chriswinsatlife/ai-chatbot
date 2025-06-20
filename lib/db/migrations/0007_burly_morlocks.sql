CREATE TABLE IF NOT EXISTS "User_Profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"modified_at" timestamp with time zone DEFAULT now(),
	"google_refresh_token" text
);
--> statement-breakpoint
DROP TABLE IF EXISTS "User";--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Document" RENAME COLUMN "text" TO "kind";
EXCEPTION WHEN undefined_column THEN
  NULL;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Chat" DROP CONSTRAINT "Chat_userId_User_id_fk";
EXCEPTION WHEN undefined_object THEN
  NULL;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Document" DROP CONSTRAINT "Document_userId_User_id_fk";
EXCEPTION WHEN undefined_object THEN
  NULL;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "Suggestion" DROP CONSTRAINT "Suggestion_userId_User_id_fk";
EXCEPTION WHEN undefined_object THEN
  NULL;
END;
$$;--> statement-breakpoint
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "tags" text[];--> statement-breakpoint
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "modifiedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "chat_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userId_User_Profiles_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User_Profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_User_Profiles_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User_Profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Document" ADD CONSTRAINT "Document_chat_id_Chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."Chat"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_userId_User_Profiles_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User_Profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
