CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "user_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'knowledge' NOT NULL,
	"encrypted_content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(768),
	"confidence" numeric(4, 3) DEFAULT '1' NOT NULL,
	"importance" integer DEFAULT 5 NOT NULL,
	"source_conversation_id" uuid,
	"source_message_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "memory_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_memory" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_mode" text DEFAULT 'strict' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "allow_openai_files" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_memories_user_hash_unique" ON "user_memories" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "user_memories_user_active_idx" ON "user_memories" USING btree ("user_id","active","updated_at");--> statement-breakpoint
CREATE INDEX "user_memories_embedding_hnsw_idx" ON "user_memories" USING hnsw ("embedding" vector_cosine_ops);
