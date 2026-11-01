import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { usageEvents, users } from "@/db/schema";

// Re-check before an automatic paid correction: the first call may exhaust quota.
export async function assertContinuationBudget(userId: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.isActive) throw new Error("This account is no longer active.");
  const since = new Date(Date.now() - user.resetWindowHours * 3600000);
  const [used] = await db.select({
    total: sql<number>`coalesce(sum(${usageEvents.inputTokens}+${usageEvents.outputTokens}),0)`,
    cycle: sql<number>`coalesce(sum(case when ${usageEvents.createdAt} >= ${since} then ${usageEvents.inputTokens}+${usageEvents.outputTokens} else 0 end),0)`,
  }).from(usageEvents).where(eq(usageEvents.userId,userId));
  if ((!user.unlimited && Number(used.cycle) >= user.tokenLimit) || (!user.totalUnlimited && Number(used.total) >= user.totalTokenLimit))
    throw new Error("Token quota reached. No automatic paid correction was started. Contact an admin or retry after the cycle resets.");
}
