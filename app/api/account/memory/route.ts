import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { userMemories, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { decryptMemory } from "@/lib/memory";
import { consolidateUserMemory } from "@/lib/memory-consolidation";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  content: z.string().trim().min(3).max(2000),
  kind: z.enum(["profile", "preference", "knowledge", "instruction"]).default("knowledge"),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await getDb().select().from(userMemories)
    .where(and(eq(userMemories.userId, user.id), eq(userMemories.active, true)))
    .orderBy(desc(userMemories.importance), desc(userMemories.updatedAt)).limit(200);
  return NextResponse.json({
    settings: {
      memoryEnabled: user.memoryEnabled,
      autoMemory: user.autoMemory,
    },
    memories: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      content: decryptMemory(row.encryptedContent),
      confidence: Number(row.confidence),
      sourceConversationId: row.sourceConversationId,
      sourceMessageId: row.sourceMessageId,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      canUndo: row.revisions.length > 0,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.memoryEnabled) return NextResponse.json({ error: user.locale === "vi" ? "Admin đã tắt bộ nhớ cá nhân cho tài khoản này." : "Personal memory is disabled by your administrator." }, { status: 403 });
  if(!await enforceRateLimit(user.id,"memory",10))return NextResponse.json({error:user.locale==="vi"?"Bạn cập nhật bộ nhớ quá nhanh. Hãy chờ một phút.":"Too many memory updates. Try again in one minute."},{status:429});
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const result = await consolidateUserMemory({userId:user.id,message:parsed.data.content,locale:user.locale,manual:true});
  if(result.status==="failed"||result.status==="conflict")return NextResponse.json({error:result.notice,...result},{status:result.status==="conflict"?409:503});
  return NextResponse.json({ok:true,...result},{status:result.changed?201:200});
}

export async function PATCH() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: user.locale === "vi" ? "Chỉ admin được thay đổi thiết lập bộ nhớ trong Admin > Users." : "Memory settings can only be changed by an administrator in Admin > Users." }, { status: 403 });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await getDb().transaction(async tx=>{
    const [owner]=await tx.select().from(users).where(eq(users.id,user.id)).for("update");
    const deleted=await tx.delete(userMemories).where(eq(userMemories.userId,user.id)).returning({id:userMemories.id});
    if(owner)await tx.update(users).set({memoryVersion:owner.memoryVersion+1}).where(eq(users.id,user.id));
    return deleted;
  });
  return NextResponse.json({ deleted: result.length });
}
