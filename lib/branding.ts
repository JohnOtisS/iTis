import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

export type BrandingSettings = {
  systemLogoUrl: string | null;
  chatLogoUrl: string | null;
};

export const defaultBranding: BrandingSettings = {
  systemLogoUrl: null,
  chatLogoUrl: null,
};

export function normalizeBranding(value: unknown): BrandingSettings {
  const candidate = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    systemLogoUrl: typeof candidate.systemLogoUrl === "string" ? candidate.systemLogoUrl : null,
    chatLogoUrl: typeof candidate.chatLogoUrl === "string" ? candidate.chatLogoUrl : null,
  };
}

export async function getBrandingSettings() {
  const [row] = await getDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "branding"))
    .limit(1);
  return normalizeBranding(row?.value);
}
