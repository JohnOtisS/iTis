CREATE TABLE "stored_files" (
	"url" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "storage_limit_bytes" bigint DEFAULT 2147483648 NOT NULL;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_files_user_idx" ON "stored_files" USING btree ("user_id");
--> statement-breakpoint
INSERT INTO stored_files (url, user_id, bytes)
SELECT DISTINCT ON (a->>'url') a->>'url', c.user_id, greatest(coalesce((a->>'size')::bigint,0),0)
FROM messages m JOIN conversations c ON c.id=m.conversation_id,
LATERAL jsonb_array_elements(m.attachments) a
WHERE a->>'url' LIKE '/api/files/%'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION itis_history_bytes(owner_id uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT sum(octet_length(m.content) + octet_length(m.attachments::text))
 FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(title)+octet_length(coalesce(memory_summary,''))) FROM conversations WHERE user_id=owner_id),0)
$$;
--> statement-breakpoint
CREATE FUNCTION itis_check_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; capacity bigint; used bigint; delta bigint;
BEGIN
 IF TG_TABLE_NAME = 'stored_files' THEN
   owner_id := NEW.user_id;
   delta := NEW.bytes;
   IF TG_OP='UPDATE' THEN delta := delta - OLD.bytes; END IF;
 ELSIF TG_TABLE_NAME = 'messages' THEN
   SELECT user_id INTO owner_id FROM conversations WHERE id=NEW.conversation_id;
   delta := octet_length(NEW.content)+octet_length(NEW.attachments::text);
   IF TG_OP='UPDATE' THEN delta := delta-octet_length(OLD.content)-octet_length(OLD.attachments::text); END IF;
 ELSE
   owner_id := NEW.user_id;
   delta := octet_length(NEW.title)+octet_length(coalesce(NEW.memory_summary,''));
   IF TG_OP='UPDATE' THEN delta := delta-octet_length(OLD.title)-octet_length(coalesce(OLD.memory_summary,'')); END IF;
 END IF;
 IF delta <= 0 THEN RETURN NEW; END IF;
 SELECT storage_limit_bytes INTO capacity FROM users WHERE id=owner_id FOR UPDATE;
 SELECT itis_history_bytes(owner_id)+coalesce(sum(bytes),0) INTO used FROM stored_files WHERE user_id=owner_id;
 IF used+delta > capacity THEN RAISE EXCEPTION 'Storage quota exceeded' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER stored_files_quota BEFORE INSERT OR UPDATE ON stored_files FOR EACH ROW EXECUTE FUNCTION itis_check_storage();
--> statement-breakpoint
CREATE TRIGGER messages_storage_quota BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION itis_check_storage();
--> statement-breakpoint
CREATE TRIGGER conversations_storage_quota BEFORE INSERT OR UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION itis_check_storage();
