CREATE TABLE "chat_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_message_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"stage" text DEFAULT 'Preparing' NOT NULL,
	"provider_response_id" text,
	"result" jsonb,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "extracted_text" text;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "provider_file_id" text;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "provider_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "tool_cost_usd" numeric(14, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "tool_details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD CONSTRAINT "chat_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD CONSTRAINT "chat_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD CONSTRAINT "chat_jobs_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_jobs_user_conversation_idx" ON "chat_jobs" USING btree ("user_id","conversation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX chat_jobs_one_running_per_conversation ON chat_jobs(conversation_id) WHERE status='running';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION itis_history_bytes(owner_id uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT sum(octet_length(m.content)+octet_length(m.attachments::text)) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(title)+octet_length(coalesce(memory_summary,''))) FROM conversations WHERE user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(coalesce(extracted_text,''))) FROM stored_files WHERE user_id=owner_id),0)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION itis_check_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; capacity bigint; used bigint; delta bigint;
BEGIN
 IF TG_TABLE_NAME='stored_files' THEN
   owner_id:=NEW.user_id; delta:=NEW.bytes+octet_length(coalesce(NEW.extracted_text,''));
   IF TG_OP='UPDATE' THEN delta:=delta-OLD.bytes-octet_length(coalesce(OLD.extracted_text,'')); END IF;
 ELSIF TG_TABLE_NAME='messages' THEN
   SELECT user_id INTO owner_id FROM conversations WHERE id=NEW.conversation_id;
   delta:=octet_length(NEW.content)+octet_length(NEW.attachments::text);
   IF TG_OP='UPDATE' THEN delta:=delta-octet_length(OLD.content)-octet_length(OLD.attachments::text); END IF;
 ELSE
   owner_id:=NEW.user_id; delta:=octet_length(NEW.title)+octet_length(coalesce(NEW.memory_summary,''));
   IF TG_OP='UPDATE' THEN delta:=delta-octet_length(OLD.title)-octet_length(coalesce(OLD.memory_summary,'')); END IF;
 END IF;
 IF delta<=0 THEN RETURN NEW; END IF;
 SELECT storage_limit_bytes INTO capacity FROM users WHERE id=owner_id FOR UPDATE;
 SELECT itis_history_bytes(owner_id)+coalesce(sum(bytes),0) INTO used FROM stored_files WHERE user_id=owner_id;
 IF used+delta>capacity THEN RAISE EXCEPTION 'Storage quota exceeded' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
