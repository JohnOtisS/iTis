CREATE TABLE memory_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,file_url text NOT NULL,name text NOT NULL,mime_type text NOT NULL,bytes bigint NOT NULL,binary_hash text NOT NULL,text_hash text NOT NULL,characters integer NOT NULL,chunk_count integer NOT NULL,source_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,binary_hash),UNIQUE(user_id,text_hash)
);
CREATE TABLE memory_document_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES memory_documents(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,ordinal integer NOT NULL,encrypted_text text NOT NULL,content_hash text NOT NULL,terms text[] NOT NULL
);
CREATE INDEX memory_chunks_terms_idx ON memory_document_chunks USING gin(terms);
CREATE INDEX memory_chunks_user_idx ON memory_document_chunks(user_id);
CREATE OR REPLACE FUNCTION itis_history_bytes(owner_id uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT sum(octet_length(m.content)+octet_length(m.attachments::text)) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(title)+octet_length(coalesce(memory_summary,''))) FROM conversations WHERE user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(coalesce(extracted_text,''))) FROM stored_files WHERE user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(name)+octet_length(file_url)) FROM memory_documents WHERE user_id=owner_id),0)
 + coalesce((SELECT sum(octet_length(encrypted_text)+octet_length(terms::text)) FROM memory_document_chunks WHERE user_id=owner_id),0)
$$;
