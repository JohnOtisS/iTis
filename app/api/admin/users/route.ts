import bcrypt from "bcryptjs";
import { asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { appSettings, usageEvents, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { emailSettings,enqueueNotification,publicUrl } from "@/lib/notifications";
import { defaultRoleLimits, normalizeRolePlan } from "@/lib/quota-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(200),
  sendWelcome: z.boolean().default(true),
  role: z.enum(["admin", "plus", "standard"]).default("standard"),
  tokenLimit: z.number().int().min(0).max(1_000_000_000).optional(),
  unlimited: z.boolean().optional(),
  totalTokenLimit: z
    .number()
    .int()
    .min(0)
    .max(100_000_000_000)
    .optional(),
  totalUnlimited: z.boolean().optional(),
  storageLimitBytes: z.number().int().min(0).max(1024 ** 4).default(2 * 1024 ** 3),
  resetWindowHours: z.number().int().min(1).max(168).optional(),
  aiProvider: z.enum(["openai", "local"]).default("local"),
  imageProvider: z.enum(["openai", "comfyui", "disabled"]).default("disabled"),
});

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      role: users.role,
      tokenLimit: users.tokenLimit,
      unlimited: users.unlimited,
      totalTokenLimit: users.totalTokenLimit,
      totalUnlimited: users.totalUnlimited,
      storageLimitBytes: users.storageLimitBytes,
      storageUsedBytes: sql<number>`itis_history_bytes(${users.id}) + coalesce((select sum(bytes) from stored_files where user_id = ${users.id}), 0)`,
      resetWindowHours: users.resetWindowHours,
      aiProvider: users.aiProvider,
      imageProvider: users.imageProvider,
      memoryEnabled: users.memoryEnabled,
      autoMemory: users.autoMemory,
      isActive: users.isActive,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      usedTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`,
    })
    .from(users)
    .leftJoin(usageEvents, eq(usageEvents.userId, users.id))
    .groupBy(users.id)
    .orderBy(asc(users.createdAt));
  return NextResponse.json(
    {
      users: rows.map((row) => ({
        ...row,
        usedTokens: Number(row.usedTokens),
        costUsd: Number(row.costUsd),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = createUserSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  const value = parsed.data;
  const rows = await getDb().select().from(appSettings);
  const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const plan = normalizeRolePlan((settings.role_limits as Record<string, unknown> | undefined)?.[value.role], defaultRoleLimits[value.role]);
  const reset = Number((settings.token_reset as { windowHours?: number } | undefined)?.windowHours ?? 5);
  const passwordHash = await bcrypt.hash(value.password, 12);
  try {
    const [created] = await getDb()
      .insert(users)
      .values({
        email: value.email.toLowerCase(),
        name: value.name,
        passwordHash,
        role: value.role,
        tokenLimit: value.tokenLimit ?? plan.cycleTokens,
        unlimited: value.unlimited ?? plan.cycleUnlimited,
        totalTokenLimit: value.totalTokenLimit ?? plan.totalTokens,
        totalUnlimited: value.totalUnlimited ?? plan.totalUnlimited,
        storageLimitBytes: value.storageLimitBytes,
        resetWindowHours: value.resetWindowHours ?? reset,
        aiProvider: value.aiProvider,
      imageProvider: value.imageProvider,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        tokenLimit: users.tokenLimit,
        unlimited: users.unlimited,
        totalTokenLimit: users.totalTokenLimit,
        totalUnlimited: users.totalUnlimited,
      });
    let emailStatus="disabled";
    try{const mail=await emailSettings();if(value.sendWelcome&&mail.welcomeEnabled&&mail.enabled){await enqueueNotification({kind:"welcome",subject:"Welcome to iTis / Chào mừng đến iTis",body:"Your iTis account has been created. Check your email for sign-in details.",privateText:`Welcome to iTis, ${created.name}!\nSign in: ${publicUrl()}/login\nEmail: ${created.email}\nInitial password: ${value.password}\nPlease change this password in Account > Password after signing in.`,recipients:[created]});emailStatus="queued";}}catch{emailStatus="failed";}
    return NextResponse.json({ user: created,emailStatus }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Email đã tồn tại." }, { status: 409 });
  }
}
