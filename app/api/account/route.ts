import {getUploadLimits} from "@/lib/upload-limits";
import { and, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { appSettings, usageEvents, userMemories, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  getLocalAiStatus,
  LOCAL_AI_CODE_MODEL,
  LOCAL_AI_GENERAL_MODEL,
} from "@/lib/ai-providers";
import { getComfyUiStatus } from "@/lib/image-providers";
import {
  effectiveImageProvider,
  getSystemProvider,
} from "@/lib/system-provider";
import { z } from "zod";
import { getBrandingSettings } from "@/lib/branding";
import { getAccountStorage } from "@/lib/account-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email(),
  locale: z.enum(["en", "vi"]).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [systemProvider, [conversationLimitSetting], branding,uploadLimits] = await Promise.all([
    getSystemProvider(),
    getDb()
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "conversation_limits"))
      .limit(1),
    getBrandingSettings(),
    getUploadLimits(),
  ]);
  // The inactive local stack must never delay OpenAI accounts.
  const [localAi, comfyUi] =
    systemProvider === "local"
      ? await Promise.all([getLocalAiStatus(), getComfyUiStatus()])
      : [
          { connected: false, models: [] as string[], baseUrl: "" },
          { connected: false, baseUrl: "" },
        ];
  const maxContextTokens = Number(
    (
      conversationLimitSetting?.value as
        | { maxContextTokens?: number }
        | undefined
    )?.maxContextTokens ?? 50_000,
  );
  const since = new Date(Date.now() - user.resetWindowHours * 60 * 60 * 1000);
  const [[memoryStats], [usage]] = await Promise.all([getDb().select({ count: sql<number>`count(*)` }).from(userMemories).where(and(eq(userMemories.userId, user.id), eq(userMemories.active, true))), getDb()
    .select({
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`,
      requests: sql<number>`count(*)`,
      toolCostUsd: sql<string>`coalesce(sum(${usageEvents.toolCostUsd}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${usageEvents.cachedTokens}), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(${usageEvents.reasoningTokens}), 0)`,
    })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.userId, user.id), gte(usageEvents.createdAt, since)),
    )]);
  const [lifetimeUsage] = await getDb()
    .select({
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`,
      requests: sql<number>`count(*)`,
      toolCostUsd: sql<string>`coalesce(sum(${usageEvents.toolCostUsd}), 0)`,
    })
    .from(usageEvents)
    .where(eq(usageEvents.userId, user.id));
  const byModel = await getDb()
    .select({
      model: usageEvents.model,
      tokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`,
    })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.userId, user.id), gte(usageEvents.createdAt, since)),
    )
    .groupBy(usageEvents.model);
  const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const daily = await getDb()
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt}), 'YYYY-MM-DD')`,
      tokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, user.id),
        gte(usageEvents.createdAt, sevenDaysAgo),
      ),
    )
    .groupBy(sql`date_trunc('day', ${usageEvents.createdAt})`)
    .orderBy(sql`date_trunc('day', ${usageEvents.createdAt})`);

  const used = Number(usage.inputTokens) + Number(usage.outputTokens);
  const totalUsed =
    Number(lifetimeUsage.inputTokens) + Number(lifetimeUsage.outputTokens);
  return NextResponse.json(
    {
      user: {
        ...user,
        aiProvider: systemProvider,
        imageProvider: effectiveImageProvider(
          systemProvider,
          user.imageProvider,
        ),
      },
      system: {
        aiEnvironment: systemProvider,
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        localAiConnected: localAi.connected,
        localModels: localAi.models,
        localGeneralModel: LOCAL_AI_GENERAL_MODEL,
        localCodeModel: LOCAL_AI_CODE_MODEL,
        comfyUiConnected: comfyUi.connected,
        localStatusChecked: systemProvider === "local",
        maxContextTokens,
        uploadLimits,
        branding,
        database: "postgresql",
        cache: "redis",
      },
      usage: {
        used,
        remaining: user.unlimited ? null : Math.max(0, user.tokenLimit - used),
        limit: user.tokenLimit,
        unlimited: user.unlimited,
        totalUsed,
        totalRemaining: user.totalUnlimited
          ? null
          : Math.max(0, user.totalTokenLimit - totalUsed),
        totalLimit: user.totalTokenLimit,
        totalUnlimited: user.totalUnlimited,
        lifetimeCostUsd: Number(lifetimeUsage.costUsd),
        lifetimeToolCostUsd: Number(lifetimeUsage.toolCostUsd),
        lifetimeModelCostUsd: Number(lifetimeUsage.costUsd)-Number(lifetimeUsage.toolCostUsd),
        cachedTokens: Number(usage.cachedTokens),
        reasoningTokens: Number(usage.reasoningTokens),
        lifetimeRequests: Number(lifetimeUsage.requests),
        costUsd: Number(usage.costUsd),
        requests: Number(usage.requests),
        resetsAt: new Date(
          since.getTime() + user.resetWindowHours * 60 * 60 * 1000,
        ).toISOString(),
        byModel: byModel.map((item) => ({
          model: item.model,
          tokens: Number(item.tokens),
          costUsd: Number(item.costUsd),
        })),
        daily: daily.map((item) => ({
          day: item.day,
          tokens: Number(item.tokens),
        })),
      },
      memory: { count: Number(memoryStats?.count ?? 0) },
      storage: await getAccountStorage(user.id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const t = (english: string, vietnamese: string) => user.locale === "vi" ? vietnamese : english;
  const parsed = profileSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || t("Invalid data.", "Dữ liệu không hợp lệ.") },
      { status: 400 },
    );
  try {
    const [updated] = await getDb()
      .update(users)
      .set({
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        ...(parsed.data.locale ? { locale: parsed.data.locale } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        locale: users.locale,
        avatarUrl: users.avatarUrl,
        role: users.role,
      });
    return NextResponse.json({ user: updated });
  } catch {
    return NextResponse.json(
      { error: t("This email is already used by another account.", "Email đã được tài khoản khác sử dụng.") },
      { status: 409 },
    );
  }
}
