import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { appSettings, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { defaultBranding, normalizeBranding } from "@/lib/branding";
import { defaultRoleLimits, normalizeRolePlan } from "@/lib/quota-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rolePlan = z.object({
  cycleTokens: z.number().int().min(0).max(1_000_000_000),
  cycleUnlimited: z.boolean(),
  totalTokens: z.number().int().min(0).max(100_000_000_000),
  totalUnlimited: z.boolean(),
});
const settingsSchema = z.object({
  aiEnvironment: z.object({ provider: z.enum(["local", "openai"]) }).optional(),
  roleLimits: z
    .object({
      standard: rolePlan,
      plus: rolePlan,
      admin: rolePlan,
    })
    .optional(),
  tokenReset: z
    .object({ windowHours: z.number().int().min(1).max(168) })
    .optional(),
  modelRouter: z
    .object({
      lunaPercent: z.number().int().min(0).max(100),
      solPercent: z.number().int().min(0).max(100),
      enabled: z.boolean(),
    })
    .refine(
      (value) => value.lunaPercent + value.solPercent === 100,
      "Tổng phân bổ phải bằng 100%.",
    )
    .optional(),
  chatLimits: z
    .object({
      maxContextTokens: z.number().int().min(1000).max(1_000_000),
    })
    .optional(),
  branding: z
    .object({
      systemLogoUrl: z.string().nullable(),
      chatLogoUrl: z.string().nullable(),
    })
    .optional(),
});

const defaults = {
  aiEnvironment: { provider: "openai" as const },
  roleLimits: defaultRoleLimits,
  tokenReset: { windowHours: 5 },
  modelRouter: { lunaPercent: 80, solPercent: 20, enabled: true },
  chatLimits: { maxContextTokens: 50000 },
  branding: defaultBranding,
};

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await getDb()
    .select()
    .from(appSettings)
    .where(
      inArray(appSettings.key, [
        "ai_environment",
        "role_limits",
        "token_reset",
        "model_router",
        "conversation_limits",
        "branding",
      ]),
    );
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const storedRoleLimits = (
    map.role_limits && typeof map.role_limits === "object"
      ? map.role_limits
      : {}
  ) as Record<string, unknown>;
  return NextResponse.json(
    {
      settings: {
        aiEnvironment: map.ai_environment ?? defaults.aiEnvironment,
        roleLimits: {
          standard: normalizeRolePlan(
            storedRoleLimits.standard,
            defaults.roleLimits.standard,
          ),
          plus: normalizeRolePlan(
            storedRoleLimits.plus,
            defaults.roleLimits.plus,
          ),
          admin: normalizeRolePlan(
            storedRoleLimits.admin,
            defaults.roleLimits.admin,
          ),
        },
        tokenReset: map.token_reset ?? defaults.tokenReset,
        modelRouter: map.model_router ?? defaults.modelRouter,
        chatLimits: map.conversation_limits ?? defaults.chatLimits,
        branding: normalizeBranding(map.branding),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  const entries: Array<{ key: string; value: unknown }> = [];
  if (parsed.data.aiEnvironment)
    entries.push({ key: "ai_environment", value: parsed.data.aiEnvironment });
  if (parsed.data.roleLimits)
    entries.push({ key: "role_limits", value: parsed.data.roleLimits });
  if (parsed.data.tokenReset)
    entries.push({ key: "token_reset", value: parsed.data.tokenReset });
  if (parsed.data.modelRouter)
    entries.push({ key: "model_router", value: parsed.data.modelRouter });
  if (parsed.data.chatLimits)
    entries.push({ key: "conversation_limits", value: parsed.data.chatLimits });
  if (parsed.data.branding)
    entries.push({ key: "branding", value: parsed.data.branding });
  await getDb().transaction(async (tx) => {
    // Serialize plan saves and retain explicit per-account overrides.
    const [previous] = await tx.select().from(appSettings).where(eq(appSettings.key, "role_limits")).for("update");
    const previousPlans = (previous?.value ?? {}) as Record<string, unknown>;
    for (const entry of entries) {
      await tx
        .insert(appSettings)
        .values(entry)
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: entry.value, updatedAt: new Date() },
        });
    }
    if (parsed.data.roleLimits) {
      for (const role of ["standard", "plus", "admin"] as const) {
        const plan = parsed.data.roleLimits[role];
        const old = normalizeRolePlan(previousPlans[role], defaultRoleLimits[role]);
        await tx
          .update(users)
          .set({
            tokenLimit: plan.cycleTokens,
            unlimited: plan.cycleUnlimited,
            totalTokenLimit: plan.totalTokens,
            totalUnlimited: plan.totalUnlimited,
            updatedAt: new Date(),
          })
          .where(and(eq(users.role, role), eq(users.tokenLimit, old.cycleTokens), eq(users.unlimited, old.cycleUnlimited), eq(users.totalTokenLimit, old.totalTokens), eq(users.totalUnlimited, old.totalUnlimited)));
      }
    }
    if (parsed.data.tokenReset) {
      await tx
        .update(users)
        .set({
          resetWindowHours: parsed.data.tokenReset.windowHours,
          updatedAt: new Date(),
        });
    }
  });
  return GET();
}
