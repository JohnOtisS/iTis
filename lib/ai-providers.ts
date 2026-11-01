export const LOCAL_AI_BASE_URL = (process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:1234/v1").replace(/\/$/, "");
export const LOCAL_AI_GENERAL_MODEL = process.env.LOCAL_AI_GENERAL_MODEL || "qwen/qwen3.5-9b";
export const LOCAL_AI_CODE_MODEL = process.env.LOCAL_AI_CODE_MODEL || "deepseek-coder-v2-lite-instruct";
export const LOCAL_EMBEDDING_MODEL = process.env.LOCAL_EMBEDDING_MODEL || "text-embedding-nomic-embed-text-v1.5";

type LocalAiStatus = { connected: boolean; models: string[]; baseUrl: string };
let localAiStatusCache: { value: LocalAiStatus; expiresAt: number } | null = null;
let localAiStatusRequest: Promise<LocalAiStatus> | null = null;

export function isCodeTask(prompt: string) {
  return /\b(code|coding|typescript|javascript|python|react|next\.?js|api|sql|docker|debug|bug|lỗi code|lập trình)\b/i.test(prompt);
}

export async function getLocalAiStatus() {
  if (localAiStatusCache && localAiStatusCache.expiresAt > Date.now()) return localAiStatusCache.value;
  if (localAiStatusRequest) return localAiStatusRequest;

  localAiStatusRequest = (async (): Promise<LocalAiStatus> => {
    try {
      const response = await fetch(`${LOCAL_AI_BASE_URL}/models`, {
        cache: "no-store",
        signal: AbortSignal.timeout(750),
      });
      if (!response.ok) throw new Error(`LM Studio HTTP ${response.status}`);
      const payload = await response.json() as { data?: Array<{ id?: string }> };
      const models = (payload.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
      return { connected: true, models, baseUrl: LOCAL_AI_BASE_URL };
    } catch {
      return { connected: false, models: [], baseUrl: LOCAL_AI_BASE_URL };
    }
  })();

  try {
    const value = await localAiStatusRequest;
    localAiStatusCache = { value, expiresAt: Date.now() + 10_000 };
    return value;
  } finally {
    localAiStatusRequest = null;
  }
}
