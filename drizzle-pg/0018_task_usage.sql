ALTER TABLE messages ADD COLUMN task_usage jsonb;
--> statement-breakpoint
UPDATE messages m SET task_usage=(j.result->'usage') || jsonb_build_object(
 'calls',nullif(u.calls,0),'reasoning_tokens',u.reasoning,'cache_write_tokens',u.writes,
 'usage_complete',u.calls>0 AND u.inputs=coalesce((j.result->'usage'->>'input_tokens')::bigint,0) AND u.outputs=coalesce((j.result->'usage'->>'output_tokens')::bigint,0))
FROM chat_jobs j CROSS JOIN LATERAL (
 SELECT count(*)::int AS calls,sum(input_tokens)::bigint AS inputs,sum(output_tokens)::bigint AS outputs,
 sum(reasoning_tokens)::bigint AS reasoning,sum((tool_details->>'cacheWriteTokens')::bigint)::bigint AS writes
 FROM usage_events WHERE conversation_id=j.conversation_id AND created_at BETWEEN j.created_at AND j.updated_at
) u
WHERE m.conversation_id=j.conversation_id AND m.role='assistant'
AND j.status='completed' AND j.result->'usage' IS NOT NULL
AND m.created_at BETWEEN j.created_at AND j.updated_at
AND jsonb_array_length(m.attachments)>0 AND m.attachments=j.result->'attachments';

--> statement-breakpoint
CREATE OR REPLACE FUNCTION itis_history_bytes(owner_id uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT sum(octet_length(m.content)+octet_length(m.attachments::text)+octet_length(coalesce(m.task_usage::text,''))) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(title)+octet_length(coalesce(memory_summary,''))) FROM conversations WHERE user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(coalesce(extracted_text,''))) FROM stored_files WHERE user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(name)+octet_length(file_url)) FROM memory_documents WHERE user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(encrypted_text)+octet_length(terms::text)) FROM memory_document_chunks WHERE user_id=owner_id),0)
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
   delta:=octet_length(NEW.content)+octet_length(NEW.attachments::text)+octet_length(coalesce(NEW.task_usage::text,''));
   IF TG_OP='UPDATE' THEN delta:=delta-octet_length(OLD.content)-octet_length(OLD.attachments::text)-octet_length(coalesce(OLD.task_usage::text,'')); END IF;
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
