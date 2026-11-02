import bcrypt from "bcryptjs";
import { basename, join } from "node:path";
import { unlink } from "node:fs/promises";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { conversations, imageGenerations, messages, usageEvents, users, sessions } from "@/db/schema";
import { requireAdmin, currentSessionHash } from "@/lib/auth";
import { deleteAvatarFile } from "@/lib/avatar-files";
import { deleteChatFile, type ChatAttachment } from "@/lib/chat-files";
import { abortImageJob } from "@/lib/image-jobs";
import { GENERATED_IMAGES_DIR } from "@/lib/image-providers";

export const runtime = "nodejs";

const updateSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().trim().min(2).max(100).optional(),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(["admin", "plus", "standard"]).optional(),
  tokenLimit: z.number().int().min(0).max(1_000_000_000).optional(),
  unlimited: z.boolean().optional(),
  totalTokenLimit: z.number().int().min(0).max(100_000_000_000).optional(),
  totalUnlimited: z.boolean().optional(),
  storageLimitBytes: z.number().int().min(0).max(1024 ** 4).optional(),
  resetWindowHours: z.number().int().min(1).max(168).optional(),
  aiProvider: z.enum(["openai", "local"]).optional(),
  imageProvider: z.enum(["openai", "comfyui", "disabled"]).optional(),
  memoryEnabled: z.boolean().optional(),
  autoMemory: z.boolean().optional(),
  isActive: z.boolean().optional(),
  allowMultipleSessions: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let admin;
  try {
    admin=await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  const { id } = await context.params;
  const { password, ...rest } = parsed.data;
  const values = {
    ...rest,
    ...(rest.email ? { email: rest.email.toLowerCase() } : {}),
    ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
    ...(rest.memoryEnabled!==undefined||rest.autoMemory!==undefined?{memoryVersion:sql`${users.memoryVersion}+1`}:{}),
    updatedAt: new Date(),
  };
  try {
    const keepCurrentHash=admin.id===id?await currentSessionHash():null;
    const updated=await getDb().transaction(async tx=>{
      const [owner]=await tx.select({id:users.id}).from(users).where(eq(users.id,id)).for("update");
      if(!owner)return null;
      const [updated]=await tx.update(users)
      .set(values)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        tokenLimit: users.tokenLimit,
        unlimited: users.unlimited,
        totalTokenLimit: users.totalTokenLimit,
        totalUnlimited: users.totalUnlimited,
        isActive: users.isActive,
        allowMultipleSessions: users.allowMultipleSessions,
      });
      if(password||rest.isActive===false)await tx.delete(sessions).where(eq(sessions.userId,id));
      else if(rest.allowMultipleSessions===false){
        const [current]=keepCurrentHash?await tx.select({id:sessions.id}).from(sessions).where(and(eq(sessions.userId,id),eq(sessions.tokenHash,keepCurrentHash),gt(sessions.expiresAt,new Date()))).limit(1):[];
        const [latest]=current?[current]:await tx.select({id:sessions.id}).from(sessions).where(and(eq(sessions.userId,id),gt(sessions.expiresAt,new Date()))).orderBy(desc(sessions.createdAt),desc(sessions.id)).limit(1);
        await tx.delete(sessions).where(and(eq(sessions.userId,id),latest?ne(sessions.id,latest.id):undefined));
      }
      return updated;
    });
    if (!updated)
      return NextResponse.json(
        { error: "Không tìm thấy người dùng." },
        { status: 404 },
      );
    return NextResponse.json({ user: updated });
  } catch {
    return NextResponse.json(
      { error: "Email đã được tài khoản khác sử dụng." },
      { status: 409 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (id === admin.id) {
    return NextResponse.json(
      { error: "You cannot delete the account you are currently signed in with." },
      { status: 400 },
    );
  }

  const db = getDb();
  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  if (target.role === "admin") {
    const [adminCount] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, "admin"));
    if ((adminCount?.value ?? 0) <= 1) {
      return NextResponse.json(
        { error: "The last administrator account cannot be deleted." },
        { status: 400 },
      );
    }
  }

  const rememberedFiles=await db.execute(sql`select file_url from memory_documents where user_id=${id}`);
  const [attachmentRows, imageRows, usageSummary] = await Promise.all([
    db
      .select({ attachments: messages.attachments })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.userId, id)),
    db
      .select({ id: imageGenerations.id, fileName: imageGenerations.fileName })
      .from(imageGenerations)
      .where(eq(imageGenerations.userId, id)),
    db
      .select({
        tokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)::bigint`,
        cost: sql<string>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`,
      })
      .from(usageEvents)
      .where(eq(usageEvents.userId, id)),
  ]);

  imageRows.forEach((image) => abortImageJob(image.id));

  const [deleted] = await db.transaction(async (tx) =>
    tx
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id }),
  );
  if (!deleted) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  await Promise.all([
    deleteAvatarFile(target.avatarUrl),
    ...rememberedFiles.rows.map(row=>deleteChatFile(String(row.file_url))),
    ...attachmentRows.flatMap((row) =>
      (row.attachments as ChatAttachment[]).map((file) => deleteChatFile(file.url)),
    ),
    ...imageRows
      .filter((image): image is typeof image & { fileName: string } => Boolean(image.fileName))
      .map((image) =>
        unlink(join(GENERATED_IMAGES_DIR, basename(image.fileName))).catch(() => undefined),
      ),
  ]);

  return NextResponse.json({
    deleted: true,
    removed: {
      email: target.email,
      tokens: Number(usageSummary[0]?.tokens ?? 0),
      costUsd: Number(usageSummary[0]?.cost ?? 0),
      attachmentMessages: attachmentRows.length,
      images: imageRows.length,
    },
  });
}
