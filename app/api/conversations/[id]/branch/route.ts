import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { deleteChatFile, readChatFile, saveChatFile, type ChatAttachment } from "@/lib/chat-files";
import { isStorageError, STORAGE_ERROR } from "@/lib/account-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function duplicateAttachments(files: ChatAttachment[], userId: string, createdFiles: ChatAttachment[]) {
  const copies: ChatAttachment[] = [];
  for (const file of files) {
    const id = file.url.startsWith("/api/files/") ? file.url.slice("/api/files/".length) : "";
    const bytes = id ? await readChatFile(id) : null;
    if (!bytes) continue;
    const copy = await saveChatFile(bytes, file.name, file.type, file.kind ?? "input", userId);
    createdFiles.push(copy);
    copies.push(copy);
  }
  return copies;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { messageId?: string };
  if (!body.messageId) return NextResponse.json({ error: "messageId is required" }, { status: 400 });

  const [source] = await getDb().select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, user.id))).limit(1);
  if (!source) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  const sourceMessages = await getDb().select().from(messages)
    .where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt));
  const sourceIndex = sourceMessages.findIndex((message) => message.id === body.messageId && message.role === "user");
  if (sourceIndex < 0) return NextResponse.json({ error: "User message not found" }, { status: 404 });

  const prefix = sourceMessages.slice(0, sourceIndex);
  const copied = [] as Array<typeof messages.$inferInsert>;
  const createdFiles: ChatAttachment[] = [];
  try {
  for (const message of prefix) {
    copied.push({
      conversationId: "",
      role: message.role,
      content: message.content,
      model: message.model,
      tokenCount: message.tokenCount,
      taskUsage: message.taskUsage,
      attachments: await duplicateAttachments(message.attachments as ChatAttachment[], user.id, createdFiles),
      createdAt: message.createdAt,
    });
  }
  const contextTokens = prefix.reduce((sum, message) => sum + message.tokenCount, 0);
  const [branch] = await getDb().transaction(async (tx) => {
    const [created] = await tx.insert(conversations).values({
      userId: user.id,
      title: `${source.title} ${user.locale === "vi" ? "(nhánh)" : "(branch)"}`.slice(0, 100),
      contextTokens,
    }).returning();
    if (copied.length) {
      await tx.insert(messages).values(copied.map((message) => ({ ...message, conversationId: created.id })));
    }
    return [created];
  });
  return NextResponse.json({ conversation: branch }, { status: 201 });
  } catch (error) {
    await Promise.all(createdFiles.map((file) => deleteChatFile(file.url)));
    if (isStorageError(error)) return NextResponse.json({ code: "STORAGE_LIMIT", error: STORAGE_ERROR }, { status: 413 });
    throw error;
  }
}
