import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, cosineDistance, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { userMemories } from "@/db/schema";
import { LOCAL_AI_BASE_URL, LOCAL_EMBEDDING_MODEL } from "@/lib/ai-providers";
import { containsSecret } from "@/lib/privacy";

export type MemoryKind = "profile" | "preference" | "knowledge" | "instruction";

function encryptionKey() {
  const source = process.env.MEMORY_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!source) throw new Error("MEMORY_ENCRYPTION_KEY or SESSION_SECRET is required.");
  return createHash("sha256").update(source).digest();
}

export function encryptMemory(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptMemory(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Invalid encrypted memory.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function memoryHash(userId: string, content: string) {
  return createHash("sha256").update(`${userId}:${normalize(content).toLocaleLowerCase("en-US")}`).digest("hex");
}

export async function createLocalEmbedding(input: string, purpose: "query" | "document" = "document") {
  // Memory management in OpenAI mode must not wait for the inactive local stack.
  const { getSystemProvider } = await import("@/lib/system-provider");
  if (await getSystemProvider() !== "local") return null;
  try {
    const response = await fetch(`${LOCAL_AI_BASE_URL}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(1800),
      body: JSON.stringify({
        model: LOCAL_EMBEDDING_MODEL,
        input: `${purpose === "query" ? "search_query" : "search_document"}: ${normalize(input).slice(0, 6000)}`,
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const embedding = payload.data?.[0]?.embedding;
    return embedding?.length === 768 ? embedding : null;
  } catch {
    return null;
  }
}

export function inferMemoryCandidate(message: string): { content: string; kind: MemoryKind; confidence: number } | null {
  const content = normalize(message).slice(0, 1200);
  if (content.length < 8 || containsSecret(content)) return null;
  if (/^(?:đừng|không|do not|don't)\s+(?:ghi\s+)?(?:nhớ|remember)|(?:bạn|cậu|you).{0,15}(?:có nhớ|remember).{0,80}(?:không|\?)|^(?:do you|can you) remember/i.test(content)) return null;
  const explicit = /\b(?:remember|please remember|from now on)\b|(?:hãy |xin )?(?:ghi )?nhớ(?: rằng)?|ghi vào bộ nhớ|từ nay/i.test(content);
  const profile = /\b(?:my name is|i am|i work (?:at|for)|call me)\b|(?:tôi là|mình là|tôi làm (?:ở|tại|cho)|gọi tôi là)/i.test(content);
  const preference = /\b(?:i prefer|i like|always answer)\b|(?:tôi|mình) thích|luôn trả lời/i.test(content);
  const correction = /^(?:no[,! ]|actually[,! ]|không[,! ]|sai rồi|đính chính)/i.test(content);
  if (!explicit && !profile && !preference && !correction) return null;
  const cleaned = content
    .replace(/^(?:please\s+)?remember(?:\s+that)?\s*[:,.-]?\s*/i, "")
    .replace(/^(?:hãy\s+|xin\s+)?nhớ(?:\s+rằng)?\s*[:,.-]?\s*/i, "")
    .trim();
  return {
    content: cleaned || content,
    kind: profile ? "profile" : preference ? "preference" : explicit ? "instruction" : "knowledge",
    confidence: explicit ? 1 : correction ? 0.9 : 0.82,
  };
}

function keywords(value: string) {
  return new Set(normalize(value).toLocaleLowerCase("vi-VN").split(/[^\p{L}\p{N}]+/u).filter((item) => item.length > 2));
}

export async function retrieveUserMemories(userId: string, query: string, limit = 4) {
  const embedding = await createLocalEmbedding(query, "query");
  const semanticScores=new Map<string,number>();
  if (embedding) {
    try {
      const distance = cosineDistance(userMemories.embedding, embedding);
      const rows = await getDb().select({ memory: userMemories, distance })
        .from(userMemories)
        .where(and(eq(userMemories.userId, userId), eq(userMemories.active, true), isNotNull(userMemories.embedding), sql`${distance} < 0.48`))
        .orderBy(distance)
        .limit(limit);
      rows.forEach(row=>semanticScores.set(row.memory.id,1-Number(row.distance)));
    } catch {
      // Existing installations may be waiting for the pgvector migration; use the local fallback below.
    }
  }
  const rows = await getDb().select().from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.active, true)))
    .orderBy(desc(userMemories.importance), desc(userMemories.updatedAt)).limit(200);
  const queryWords = keywords(query);
  const selected=rows.map((row) => {
    const content = decryptMemory(row.encryptedContent);
    const memoryWords = keywords(content);
    const overlap = [...queryWords].filter((word) => memoryWords.has(word)).length;
    return { ...row, content, score: Math.max(semanticScores.get(row.id)??0,overlap / Math.max(1, Math.min(queryWords.size, memoryWords.size))) + (row.kind === "profile" || row.kind === "preference" ? 0.2 : 0) };
  }).filter((row) => row.score >= 0.18).sort((a, b) => b.score - a.score).slice(0, limit);
  if(selected.length)await getDb().update(userMemories).set({lastUsedAt:new Date()}).where(and(eq(userMemories.userId,userId),sql`${userMemories.id} in (${sql.join(selected.map(row=>sql`${row.id}`),sql`, `)})`));
  return selected;
}

export function formatMemoryContext(memories: Array<{ content: string; kind: string }>, locale: "en" | "vi") {
  if (!memories.length) return "";
  const title = locale === "vi" ? "Bộ nhớ cá nhân liên quan (chỉ dùng nếu phù hợp):" : "Relevant personal memory (use only when applicable):";
  return `${title}\n${memories.map((memory, index) => `${index + 1}. [${memory.kind}] ${memory.content.slice(0,1000)}`).join("\n").slice(0,3000)}`;
}

