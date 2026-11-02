import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { conversations, messages, userMemories, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { encryptMemory, memoryHash } from "@/lib/memory";
import { memoryRevision } from "@/lib/memory-consolidation";
import { containsSecret } from "@/lib/privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  content: z.string().trim().min(3).max(2000).optional(),
  kind: z.enum(["profile", "preference", "knowledge", "instruction"]).optional(),
  undo: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.memoryEnabled) return NextResponse.json({error:"Personal memory is disabled by your administrator."},{status:403});
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { id } = await context.params;
  const content = parsed.data.content?.replace(/\s+/g, " ").trim();
  if (content && containsSecret(content)) return NextResponse.json({ error: "Secrets and credentials are never stored in memory." }, { status: 400 });
  if(!content&&!parsed.data.kind&&!parsed.data.undo)return NextResponse.json({error:"No memory change supplied."},{status:400});
  if(parsed.data.undo&&(content||parsed.data.kind))return NextResponse.json({error:"Undo cannot include other edits."},{status:400});
  try {
  const updated=await getDb().transaction(async tx=>{
    const [owner]=await tx.select().from(users).where(eq(users.id,user.id)).for("update");
    if(!owner?.memoryEnabled)throw new Error("MEMORY_DISABLED");
    const [row]=await tx.select().from(userMemories).where(and(eq(userMemories.id,id),eq(userMemories.userId,user.id)));
    if(!row)return null;
    const prior=row.revisions.at(-1);
    if(parsed.data.undo&&!prior)throw new Error("NO_REVISION");
    const update=parsed.data.undo?{...prior!,revisions:row.revisions.slice(0,-1)}:{encryptedContent:content?encryptMemory(content):row.encryptedContent,contentHash:content?memoryHash(user.id,content):row.contentHash,kind:parsed.data.kind??row.kind,sourceConversationId:null,sourceMessageId:null,revisions:[...row.revisions,memoryRevision(row)].slice(-5)};
    // Revision provenance may reference a chat the user has since deleted.
    if(update.sourceConversationId){const [source]=await tx.select({id:conversations.id}).from(conversations).where(and(eq(conversations.id,update.sourceConversationId),eq(conversations.userId,user.id)));if(!source){update.sourceConversationId=null;update.sourceMessageId=null;}}
    if(update.sourceMessageId){const [source]=await tx.select({id:messages.id}).from(messages).where(and(eq(messages.id,update.sourceMessageId),eq(messages.conversationId,update.sourceConversationId!)));if(!source)update.sourceMessageId=null;}
    const duplicate=await tx.select({id:userMemories.id}).from(userMemories).where(and(eq(userMemories.userId,user.id),eq(userMemories.contentHash,update.contentHash)));
    if(duplicate.some(other=>other.id!==id))throw new Error("DUPLICATE_MEMORY");
    const [saved]=await tx.update(userMemories).set({encryptedContent:update.encryptedContent,contentHash:update.contentHash,kind:update.kind,sourceConversationId:update.sourceConversationId,sourceMessageId:update.sourceMessageId,revisions:update.revisions,embedding:null,updatedAt:new Date()}).where(and(eq(userMemories.id,id),eq(userMemories.userId,user.id))).returning({id:userMemories.id});
    await tx.update(users).set({memoryVersion:owner.memoryVersion+1}).where(eq(users.id,user.id));
    return saved;
  });
  if (!updated) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
  }catch(error){
    const code=error instanceof Error?error.message:"";
    if(code==="MEMORY_DISABLED")return NextResponse.json({error:"Personal memory is disabled by your administrator."},{status:403});
    if(["NO_REVISION","DUPLICATE_MEMORY"].includes(code))return NextResponse.json({error:code==="NO_REVISION"?"No earlier version to restore.":"This information already exists in another memory."},{status:409});
    throw error;
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const deleted=await getDb().transaction(async tx=>{
    const [owner]=await tx.select().from(users).where(eq(users.id,user.id)).for("update");
    const [row] = await tx.delete(userMemories)
    .where(and(eq(userMemories.id, id), eq(userMemories.userId, user.id))).returning({ id: userMemories.id });
    if(row&&owner)await tx.update(users).set({memoryVersion:owner.memoryVersion+1}).where(eq(users.id,user.id));
    return row;
  });
  if (!deleted) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

