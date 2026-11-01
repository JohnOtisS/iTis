import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { deleteChatFile, type ChatAttachment } from "@/lib/chat-files";
import { isStorageError, STORAGE_ERROR } from "@/lib/account-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const pattern = `%${query}%`;
  const rows = await getDb()
    .select({
      id: conversations.id,
      title: conversations.title,
      contextTokens: conversations.contextTokens,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(and(
      eq(conversations.userId, user.id),
      query
        ? or(
            ilike(conversations.title, pattern),
            sql<boolean>`exists (
              select 1 from ${messages} search_messages
              where search_messages.conversation_id = ${conversations.id}
                and search_messages.content ilike ${pattern}
            )`,
          )
        : undefined,
    ))
    .orderBy(desc(conversations.updatedAt))
    .limit(50);
  return NextResponse.json(
    { conversations: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { title?: string };
  const title = body.title?.trim().slice(0, 100) || (user.locale === "vi" ? "Chat mới" : "New chat");
  try {
  const [created] = await getDb()
    .insert(conversations)
    .values({ userId: user.id, title })
    .returning();
  return NextResponse.json(
    { conversation: created, messages: [] },
    { status: 201 },
  );
  } catch (error) {
    if (isStorageError(error)) return NextResponse.json({ code: "STORAGE_LIMIT", error: STORAGE_ERROR }, { status: 413 });
    throw error;
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const attachmentRows = await getDb()
    .select({ attachments: messages.attachments })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.userId, user.id));
  const deleted = await getDb()
    .delete(conversations)
    .where(eq(conversations.userId, user.id))
    .returning({ id: conversations.id });
  await Promise.all(
    attachmentRows.flatMap((row) =>
      (row.attachments as ChatAttachment[]).map((file) =>
        deleteChatFile(file.url),
      ),
    ),
  );
  return NextResponse.json({ deleted: deleted.length });
}
