import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });

  // One clock per account prevents concurrent tabs and devices counting the same interval.
  const now = sql`statement_timestamp()`;
  await getDb().update(users).set({
    activityPingAt: now,
    activeSeconds: sql`${users.activeSeconds} + case
      when ${users.activityPingAt} >= ${now} - interval '90 seconds'
      then floor(extract(epoch from ${now} - ${users.activityPingAt}))::bigint
      else 0 end`,
  }).where(and(
    eq(users.id, user.id),
    eq(users.isActive, true),
    or(isNull(users.accessExpiresAt), gt(users.accessExpiresAt, now)),
    or(isNull(users.activityPingAt), lte(users.activityPingAt, sql`${now} - interval '40 seconds'`)),
  ));
  return new Response(null, { status: 204 });
}
