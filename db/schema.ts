import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  locale: text("locale", { enum: ["en", "vi"] }).notNull().default("en"),
  avatarUrl: text("avatar_url"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "plus", "standard"] }).notNull().default("standard"),
  tokenLimit: bigint("token_limit", { mode: "number" }).notNull().default(100000),
  unlimited: boolean("unlimited").notNull().default(false),
  totalTokenLimit: bigint("total_token_limit", { mode: "number" }).notNull().default(1000000),
  totalUnlimited: boolean("total_unlimited").notNull().default(false),
  storageLimitBytes: bigint("storage_limit_bytes", { mode: "number" }).notNull().default(2147483648),
  resetWindowHours: integer("reset_window_hours").notNull().default(5),
  aiProvider: text("ai_provider", { enum: ["openai", "local"] }).notNull().default("local"),
  imageProvider: text("image_provider", { enum: ["openai", "comfyui", "disabled"] }).notNull().default("openai"),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  autoMemory: boolean("auto_memory").notNull().default(true),
  memoryVersion: integer("memory_version").notNull().default(0),
  privacyMode: text("privacy_mode", { enum: ["strict", "balanced"] }).notNull().default("strict"),
  allowOpenAiFiles: boolean("allow_openai_files").notNull().default(false),
  allowMultipleSessions: boolean("allow_multiple_sessions").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const storedFiles = pgTable("stored_files", {
  url: text("url").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  contentHash: text("content_hash"),
  extractedText: text("extracted_text"),
  providerFileId: text("provider_file_id"),
  providerExpiresAt: timestamp("provider_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("stored_files_user_idx").on(table.userId)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_user_id_idx").on(table.userId),
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  contextTokens: bigint("context_tokens", { mode: "number" }).notNull().default(0),
  memorySummary: text("memory_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("conversations_user_updated_idx").on(table.userId, table.updatedAt)]);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["system", "user", "assistant", "tool"] }).notNull(),
  content: text("content").notNull(),
  model: text("model"),
  tokenCount: integer("token_count").notNull().default(0),
  attachments: jsonb("attachments").$type<Array<{ name: string; url: string; type?: string; size?: number; kind?: "input" | "output" }>>().notNull().default([]),
  memoryNotice: text("memory_notice"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("messages_conversation_created_idx").on(table.conversationId, table.createdAt)]);

export const userMemories = pgTable("user_memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["profile", "preference", "knowledge", "instruction"] }).notNull().default("knowledge"),
  encryptedContent: text("encrypted_content").notNull(),
  revisions: jsonb("revisions").$type<Array<{ encryptedContent: string; contentHash: string; kind: "profile" | "preference" | "knowledge" | "instruction"; sourceConversationId: string | null; sourceMessageId: string | null; at: string }>>().notNull().default([]),
  contentHash: text("content_hash").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull().default("1"),
  importance: integer("importance").notNull().default(5),
  sourceConversationId: uuid("source_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  sourceMessageId: uuid("source_message_id").references(() => messages.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("user_memories_user_hash_unique").on(table.userId, table.contentHash),
  index("user_memories_user_active_idx").on(table.userId, table.active, table.updatedAt),
  index("user_memories_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
]);

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  requestId: text("request_id"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 8 }).notNull().default("0"),
  toolCostUsd: numeric("tool_cost_usd", { precision: 14, scale: 8 }).notNull().default("0"),
  toolDetails: jsonb("tool_details").notNull().default({}),
  routerReason: text("router_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("usage_events_user_created_idx").on(table.userId, table.createdAt),
  index("usage_events_created_idx").on(table.createdAt),
]);

export const imageGenerations = pgTable("image_generations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  provider: text("provider", { enum: ["openai", "comfyui"] }).notNull(),
  model: text("model").notNull(),
  status: text("status", { enum: ["processing", "completed", "failed", "canceled"] }).notNull().default("processing"),
  progress: integer("progress").notNull().default(0),
  stage: text("stage").notNull().default("Queued"),
  externalJobId: text("external_job_id"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  size: text("size").notNull().default("1024x1024"),
  quality: text("quality").notNull().default("high"),
  background: text("background").notNull().default("auto"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 8 }).notNull().default("0"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [index("image_generations_user_created_idx").on(table.userId, table.createdAt)]);

export const chatJobs = pgTable("chat_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  sourceMessageId: uuid("source_message_id").references(() => messages.id, { onDelete: "set null" }),
  status: text("status", { enum: ["running", "completed", "failed", "cancelled"] }).notNull().default("running"),
  stage: text("stage").notNull().default("Preparing"),
  providerResponseId: text("provider_response_id"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("chat_jobs_user_conversation_idx").on(table.userId, table.conversationId)]);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const requestRateWindows = pgTable("request_rate_windows", {
  key: text("key").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id,{onDelete:"cascade"}),
  hits: integer("hits").notNull().default(1),
  expiresAt: timestamp("expires_at",{withTimezone:true}).notNull(),
},table=>[index("request_rate_windows_expires_idx").on(table.expiresAt)]);

export const passwordResets = pgTable("password_resets", {
 id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}),
 tokenHash:text("token_hash").notNull().unique(), expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(), usedAt:timestamp("used_at",{withTimezone:true}), createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const authRateWindows = pgTable("auth_rate_windows",{key:text("key").primaryKey(),hits:integer("hits").notNull().default(1),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull()});
export const notificationCampaigns = pgTable("notification_campaigns",{
 id:uuid("id").defaultRandom().primaryKey(),createdBy:uuid("created_by").references(()=>users.id,{onDelete:"set null"}),kind:text("kind").notNull(),subject:text("subject").notNull(),body:text("body").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const notificationDeliveries = pgTable("notification_deliveries",{
 id:uuid("id").defaultRandom().primaryKey(),campaignId:uuid("campaign_id").notNull().references(()=>notificationCampaigns.id,{onDelete:"cascade"}),userId:uuid("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}),recipient:text("recipient").notNull(),status:text("status").notNull().default("queued"),encryptedPayload:text("encrypted_payload"),attempts:integer("attempts").notNull().default(0),nextAttemptAt:timestamp("next_attempt_at",{withTimezone:true}).notNull().defaultNow(),lockedAt:timestamp("locked_at",{withTimezone:true}),providerId:text("provider_id"),error:text("error"),sentAt:timestamp("sent_at",{withTimezone:true}),readAt:timestamp("read_at",{withTimezone:true}),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});

export const memoryDocuments = pgTable("memory_documents", {
 id:uuid("id").defaultRandom().primaryKey(),userId:uuid("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}),fileUrl:text("file_url").notNull(),name:text("name").notNull(),mimeType:text("mime_type").notNull(),bytes:bigint("bytes",{mode:"number"}).notNull(),binaryHash:text("binary_hash").notNull(),textHash:text("text_hash").notNull(),characters:integer("characters").notNull(),chunkCount:integer("chunk_count").notNull(),sourceConversationId:uuid("source_conversation_id").references(()=>conversations.id,{onDelete:"set null"}),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("memory_documents_binary_unique").on(t.userId,t.binaryHash),uniqueIndex("memory_documents_text_unique").on(t.userId,t.textHash)]);
export const memoryDocumentChunks = pgTable("memory_document_chunks", {
 id:uuid("id").defaultRandom().primaryKey(),documentId:uuid("document_id").notNull().references(()=>memoryDocuments.id,{onDelete:"cascade"}),userId:uuid("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}),ordinal:integer("ordinal").notNull(),encryptedText:text("encrypted_text").notNull(),contentHash:text("content_hash").notNull(),terms:text("terms").array().notNull(),
},t=>[index("memory_chunks_terms_idx").using("gin",t.terms),index("memory_chunks_user_idx").on(t.userId)]);
