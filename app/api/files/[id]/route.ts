import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { mimeFromName, readChatFile, type ChatAttachment } from "@/lib/chat-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const url = `/api/files/${id}`;
  const [row] = await getDb().select({ attachments: messages.attachments }).from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, user.id), sql`${messages.attachments} @> ${JSON.stringify([{ url }])}::jsonb`))
    .limit(1);
  const attachment = (row?.attachments as ChatAttachment[] | undefined)?.find((item) => item.url === url);
  if (!attachment) return NextResponse.json({ error: "Không tìm thấy tệp." }, { status: 404 });
  const bytes = await readChatFile(id);
  if (!bytes) return NextResponse.json({ error: "Tệp không còn trên máy chủ." }, { status: 404 });
  const safeName = attachment.name.replace(/["\\\r\n]/g, "_");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": attachment.type || mimeFromName(attachment.name),
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
