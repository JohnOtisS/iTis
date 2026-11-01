export const GENERATED_IMAGES_DIR = process.env.GENERATED_IMAGES_DIR || "/app/storage/generated";
export const COMFYUI_BASE_URL = (process.env.COMFYUI_BASE_URL || "http://host.docker.internal:8188").replace(/\/$/, "");
export const COMFYUI_CHECKPOINT = process.env.COMFYUI_CHECKPOINT || "";

type ComfyUiStatus = { connected: boolean; baseUrl: string };
let comfyUiStatusCache: { value: ComfyUiStatus; expiresAt: number } | null = null;
let comfyUiStatusRequest: Promise<ComfyUiStatus> | null = null;

export async function getComfyUiStatus() {
  if (comfyUiStatusCache && comfyUiStatusCache.expiresAt > Date.now()) return comfyUiStatusCache.value;
  if (comfyUiStatusRequest) return comfyUiStatusRequest;

  comfyUiStatusRequest = (async (): Promise<ComfyUiStatus> => {
    try {
      const response = await fetch(`${COMFYUI_BASE_URL}/system_stats`, {
        cache: "no-store",
        signal: AbortSignal.timeout(500),
      });
      if (!response.ok) throw new Error(`ComfyUI HTTP ${response.status}`);
      return { connected: true, baseUrl: COMFYUI_BASE_URL };
    } catch {
      return { connected: false, baseUrl: COMFYUI_BASE_URL };
    }
  })();

  try {
    const value = await comfyUiStatusRequest;
    comfyUiStatusCache = { value, expiresAt: Date.now() + 10_000 };
    return value;
  } finally {
    comfyUiStatusRequest = null;
  }
}
