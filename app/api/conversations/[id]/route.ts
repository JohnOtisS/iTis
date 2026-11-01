import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { deleteChatFile, type ChatAttachment } from "@/lib/chat-files";
import { isStorageError, STORAGE_ERROR } from "@/lib/account-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const [conversation] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
    .limit(1);
  if (!conversation)
    return NextResponse.json(
      { error: "Không tìm thấy cuộc trò chuyện." },
      { status: 404 },
    );
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));
  return NextResponse.json(
    { conversation, messages: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim().slice(0, 100);
  if (!title)
    return NextResponse.json(
      { error: "Tiêu đề không hợp lệ." },
      { status: 400 },
    );
  try {
  const [updated] = await getDb()
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
    .returning();
  if (!updated)
    return NextResponse.json(
      { error: "Không tìm thấy cuộc trò chuyện." },
      { status: 404 },
    );
  return NextResponse.json({ conversation: updated });
  } catch (error) {
    if (isStorageError(error)) return NextResponse.json({ code: "STORAGE_LIMIT", error: STORAGE_ERROR }, { status: 413 });
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const owned = and(
    eq(conversations.id, id),
    eq(conversations.userId, user.id),
  );
  const [conversation] = await getDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(owned)
    .limit(1);
  if (!conversation)
    return NextResponse.json(
      { error: "Không tìm thấy cuộc trò chuyện." },
      { status: 404 },
    );
  const attachmentRows = await getDb()
    .select({ attachments: messages.attachments })
    .from(messages)
    .where(eq(messages.conversationId, id));
  await getDb().delete(conversations).where(owned);
  await Promise.all(
    attachmentRows.flatMap((row) =>
      (row.attachments as ChatAttachment[]).map((file) =>
        deleteChatFile(file.url),
      ),
    ),
  );
  return NextResponse.json({ deleted: true });
}
