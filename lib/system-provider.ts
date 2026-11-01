import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

export type SystemProvider = "local" | "openai";

export async function getSystemProvider(): Promise<SystemProvider> {
  const [row] = await getDb().select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "ai_environment"))
    .limit(1);
  const provider = (row?.value as { provider?: unknown } | undefined)?.provider;
  return provider === "local" ? "local" : "openai";
}

export function effectiveImageProvider(
  systemProvider: SystemProvider,
  userPreference: "openai" | "comfyui" | "disabled",
) {
  if (userPreference === "disabled") return "disabled" as const;
  return systemProvider === "openai" ? "openai" as const : "comfyui" as const;
}
