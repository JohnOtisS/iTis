// Shared by admin UI and server. Total allocations do not renew automatically.
export const defaultRoleLimits = {
  standard: { cycleTokens: 100_000, cycleUnlimited: false, totalTokens: 1_000_000, totalUnlimited: false },
  plus: { cycleTokens: 250_000, cycleUnlimited: false, totalTokens: 3_000_000, totalUnlimited: false },
  admin: { cycleTokens: 2_000_000, cycleUnlimited: true, totalTokens: 0, totalUnlimited: true },
};
export type RolePlan = typeof defaultRoleLimits.standard;
export function normalizeRolePlan(value: unknown, fallback: RolePlan): RolePlan {
  const plan = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const integer = (value: unknown, fallback: number, max: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : fallback;
  return {
    cycleTokens: integer(plan.cycleTokens ?? plan.tokens, fallback.cycleTokens, 1_000_000_000),
    cycleUnlimited: typeof (plan.cycleUnlimited ?? plan.unlimited) === "boolean" ? Boolean(plan.cycleUnlimited ?? plan.unlimited) : fallback.cycleUnlimited,
    totalTokens: integer(plan.totalTokens, fallback.totalTokens, 100_000_000_000),
    totalUnlimited: typeof plan.totalUnlimited === "boolean" ? plan.totalUnlimited : fallback.totalUnlimited,
  };
}
