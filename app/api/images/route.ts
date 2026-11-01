import { mkdir, writeFile, unlink } from "node:fs/promises";
import { getAccountStorage, reserveFile, releaseFile, STORAGE_ERROR } from "@/lib/account-storage";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { imageGenerations, usageEvents } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { registerImageJob, releaseImageJob } from "@/lib/image-jobs";
import { enhanceLocalImagePrompt } from "@/lib/image-prompt";
import { COMFYUI_BASE_URL, COMFYUI_CHECKPOINT, GENERATED_IMAGES_DIR } from "@/lib/image-providers";
import { effectiveImageProvider, getSystemProvider } from "@/lib/system-provider";
import { externalSafetyIdentifier } from "@/lib/privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageSchema = z.object({
  prompt: z.string().trim().min(3).max(32_000),
  mode: z.enum(["fast", "quality"]).default("quality"),
  size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).default("1024x1024"),
  quality: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  background: z.enum(["auto", "opaque", "transparent"]).default("auto"),
});

type ImageInput = z.infer<typeof imageSchema>;
type ImageProvider = "openai" | "comfyui";
type AppLocale = "en" | "vi";
type OpenAiImagePayload = {
  data?: Array<{ b64_json?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
};
type ProgressCallback = (progress: number, stage: string, externalJobId?: string) => Promise<void>;

function publicImage(record: typeof imageGenerations.$inferSelect) {
  return { ...record, estimatedCostUsd: Number(record.estimatedCostUsd), url: record.status === "completed" ? `/api/images/${record.id}/file` : null };
}

function combinedSignal(signal: AbortSignal, timeoutMs: number) {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.imageProvider === "disabled") return NextResponse.json({ error: user.locale === "vi" ? "Admin chưa bật quyền Studio ảnh cho tài khoản này." : "Image Studio is not enabled for this account." }, { status: 403 });
  const rows = await getDb().select().from(imageGenerations).where(eq(imageGenerations.userId, user.id)).orderBy(desc(imageGenerations.createdAt)).limit(60);
  return NextResponse.json({ images: rows.map(publicImage) }, { headers: { "Cache-Control": "no-store" } });
}

async function generateWithOpenAi(input: ImageInput, reference: File | null, signal: AbortSignal, onProgress: ProgressCallback, locale: AppLocale, safetyIdentifier: string) {
  const t = (english: string, vietnamese: string) => locale === "vi" ? vietnamese : english;
  const model = input.mode === "fast" ? "gpt-image-2.5-flare" : "gpt-image-2.5-sunburst";
  await onProgress(16, t("Sending request to OpenAI", "Đang gửi yêu cầu tới OpenAI"));
  let response: Response;
  if (reference) {
    const form = new FormData();
    form.set("model", model); form.set("prompt", input.prompt); form.set("image", reference, reference.name || "reference.png"); form.set("user", safetyIdentifier);
    form.set("size", input.size); form.set("quality", input.quality); form.set("background", input.background); form.set("output_format", "png");
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form, signal: combinedSignal(signal, 300_000),
    });
  } else {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: input.prompt, n: 1, size: input.size, quality: input.quality, background: input.background, output_format: "png", user: safetyIdentifier }),
      signal: combinedSignal(signal, 300_000),
    });
  }
  await onProgress(86, t("Finalizing image", "Đang hoàn thiện hình ảnh"));
  if (!response.ok) throw new Error(`OpenAI Image HTTP ${response.status}: ${await response.text()}`);
  const payload = await response.json() as OpenAiImagePayload;
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new Error(t("OpenAI returned no image data.", "OpenAI không trả về dữ liệu ảnh."));
  const usage = payload.usage;
  const textInput = usage?.input_tokens_details?.text_tokens ?? usage?.input_tokens ?? 0;
  const imageInput = usage?.input_tokens_details?.image_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cost = (textInput * 5 + imageInput * 8 + outputTokens * 30) / 1_000_000;
  return { bytes: Buffer.from(encoded, "base64"), model, inputTokens: usage?.input_tokens ?? textInput + imageInput, outputTokens, cost };
}

async function generateWithComfyUi(input: ImageInput, imageId: string, signal: AbortSignal, onProgress: ProgressCallback, locale: AppLocale) {
  const t = (english: string, vietnamese: string) => locale === "vi" ? vietnamese : english;
  await onProgress(5, t("Qwen is optimizing the prompt for the image model", "Qwen đang tối ưu và dịch prompt cho model ảnh"));
  const resolvedPrompt = await enhanceLocalImagePrompt(input.prompt, signal);
  await onProgress(8, t("Checking local ComfyUI", "Đang kiểm tra ComfyUI Local"));
  const objectInfo = await fetch(`${COMFYUI_BASE_URL}/object_info/CheckpointLoaderSimple`, { signal: combinedSignal(signal, 5_000) });
  if (!objectInfo.ok) throw new Error(t("ComfyUI is not ready.", "ComfyUI chưa sẵn sàng."));
  const info = await objectInfo.json() as { CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } } };
  const checkpoints = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  const checkpoint = COMFYUI_CHECKPOINT || checkpoints[0];
  if (!checkpoint) throw new Error(t("ComfyUI has no image checkpoint.", "ComfyUI chưa có checkpoint tạo ảnh."));
  const [width, height] = input.size === "1536x1024" ? [640, 448] : input.size === "1024x1536" ? [448, 640] : [512, 512];
  const qualitySteps = { low: 6, medium: 10, high: 14, xhigh: 18, max: 22 }[input.quality];
  const steps = input.mode === "fast" ? Math.min(qualitySteps, 8) : qualitySteps;
  const workflow = {
    "3": { class_type: "KSampler", inputs: { seed: Math.floor(Math.random() * 2_147_483_647), steps, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "5": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: resolvedPrompt.positive, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: resolvedPrompt.negative, clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: `itis/${imageId}`, images: ["8", 0] } },
  };
  await onProgress(12, t("Adding image to the local queue", "Đang đưa ảnh vào hàng đợi Local"));
  const queued = await fetch(`${COMFYUI_BASE_URL}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: `itis-${imageId}` }),
    signal: combinedSignal(signal, 10_000),
  });
  if (!queued.ok) {
    const details = await queued.text();
    throw new Error(t(`ComfyUI rejected the workflow: ${details}`, `ComfyUI từ chối workflow: ${details}`));
  }
  const { prompt_id: promptId } = await queued.json() as { prompt_id: string };
  await onProgress(18, t("Queued · generating image", "Đã vào hàng đợi · đang dựng ảnh"), promptId);
  let image: { filename: string; subfolder?: string; type?: string } | undefined;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (signal.aborted) throw new DOMException("Image generation canceled", "AbortError");
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new DOMException("Image generation canceled", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 1_000);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const historyResponse = await fetch(`${COMFYUI_BASE_URL}/history/${promptId}`, { cache: "no-store", signal });
    if (!historyResponse.ok) continue;
    const history = await historyResponse.json() as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>;
    image = history[promptId]?.outputs?.["9"]?.images?.[0];
    if (image) break;
    if (attempt % 3 === 0) await onProgress(Math.min(90, 20 + Math.floor(attempt / 3) * 2), t("Local AI is diffusing and rendering details", "Local AI đang khuếch tán và dựng chi tiết"), promptId);
  }
  if (!image) throw new Error(t("ComfyUI image generation timed out.", "ComfyUI tạo ảnh quá thời gian cho phép."));
  await onProgress(94, t("Downloading and saving result", "Đang tải và lưu kết quả"), promptId);
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output" });
  const fileResponse = await fetch(`${COMFYUI_BASE_URL}/view?${query}`, { signal });
  if (!fileResponse.ok) throw new Error(t("Unable to download the image from ComfyUI.", "Không tải được ảnh từ ComfyUI."));
  return { bytes: Buffer.from(await fileResponse.arrayBuffer()), model: checkpoint, inputTokens: 0, outputTokens: 0, cost: 0 };
}

async function processImageGeneration({ recordId, userId, provider, input, reference, controller, locale }: {
  recordId: string; userId: string; provider: ImageProvider; input: ImageInput; reference: File | null; controller: AbortController; locale: AppLocale;
}) {
  const t = (english: string, vietnamese: string) => locale === "vi" ? vietnamese : english;
  const onProgress: ProgressCallback = async (progress, stage, externalJobId) => {
    await getDb().update(imageGenerations).set({ progress, stage, ...(externalJobId ? { externalJobId } : {}) })
      .where(and(eq(imageGenerations.id, recordId), eq(imageGenerations.status, "processing")));
  };
  try {
    const generated = provider === "openai" ? await generateWithOpenAi(input, reference, controller.signal, onProgress, locale, externalSafetyIdentifier(userId)) : await generateWithComfyUi(input, recordId, controller.signal, onProgress, locale);
    if (controller.signal.aborted) throw new DOMException("Image generation canceled", "AbortError");
    const [active] = await getDb().select({ status: imageGenerations.status }).from(imageGenerations).where(eq(imageGenerations.id, recordId)).limit(1);
    if (active?.status !== "processing") return;
    // Provider work is billable even if saving the result later hits storage quota.
    await getDb().insert(usageEvents).values({ userId, model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, estimatedCostUsd: generated.cost.toFixed(8), routerReason: `image_${provider}` });
    await mkdir(GENERATED_IMAGES_DIR, { recursive: true });
    const fileName = `${recordId}.png`;
    const storageUrl = `/api/images/${recordId}/file`;
    await reserveFile(storageUrl, userId, generated.bytes.byteLength);
    try {
      await writeFile(`${GENERATED_IMAGES_DIR}/${fileName}`, generated.bytes);
    } catch (error) { await releaseFile(storageUrl); throw error; }
    await getDb().transaction(async (tx) => {
      const completed = await tx.update(imageGenerations).set({
        status: "completed", progress: 100, stage: t("Completed", "Hoàn thành"), fileName, mimeType: "image/png", model: generated.model,
        inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, estimatedCostUsd: generated.cost.toFixed(8), completedAt: new Date(),
      }).where(and(eq(imageGenerations.id, recordId), eq(imageGenerations.status, "processing"))).returning({ id: imageGenerations.id });
      if (!completed.length) {
        await unlink(`${GENERATED_IMAGES_DIR}/${fileName}`);
        await releaseFile(storageUrl);
        return;
      }
    });
  } catch (error) {
    const [current] = await getDb().select({ status: imageGenerations.status }).from(imageGenerations).where(eq(imageGenerations.id, recordId)).limit(1);
    if (current?.status === "canceled" || controller.signal.aborted || isAbortError(error)) return;
    const message = error instanceof Error ? error.message : t("Unable to generate image.", "Không thể tạo ảnh.");
    console.error("Image generation failed", error);
    await getDb().update(imageGenerations).set({ status: "failed", stage: t("Image generation failed", "Tạo ảnh thất bại"), error: message.slice(0, 1000), completedAt: new Date() })
      .where(and(eq(imageGenerations.id, recordId), eq(imageGenerations.status, "processing")));
  } finally {
    const [result] = await getDb().select({ status: imageGenerations.status }).from(imageGenerations).where(eq(imageGenerations.id, recordId)).limit(1);
    if (result?.status !== "completed") {
      await unlink(`${GENERATED_IMAGES_DIR}/${recordId}.png`).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      await releaseFile(`/api/images/${recordId}/file`);
    }
    releaseImageJob(recordId);
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You need to sign in." }, { status: 401 });
  const t = (english: string, vietnamese: string) => user.locale === "vi" ? vietnamese : english;
  const preferredProvider = effectiveImageProvider(await getSystemProvider(), user.imageProvider);
  if (preferredProvider === "disabled") return NextResponse.json({ error: t("Image generation is not enabled for this account.", "Admin chưa bật quyền tạo ảnh cho tài khoản này.") }, { status: 403 });
  const storage = await getAccountStorage(user.id);
  if (storage.usedBytes + 10 * 1024 ** 2 > storage.limitBytes) return NextResponse.json({ code: "STORAGE_LIMIT", error: STORAGE_ERROR }, { status: 413 });
  const form = await request.formData();
  const parsed = imageSchema.safeParse({ prompt: form.get("prompt"), mode: form.get("mode") || "quality", size: form.get("size") || "1024x1024", quality: form.get("quality") || "high", background: form.get("background") || "auto" });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? t("Invalid data.", "Dữ liệu không hợp lệ.") }, { status: 400 });
  const referenceValue = form.get("reference");
  const reference = referenceValue instanceof File && referenceValue.size > 0 ? referenceValue : null;
  if (reference && (!reference.type.startsWith("image/") || reference.size > 20 * 1024 * 1024)) return NextResponse.json({ error: t("The reference must be an image file up to 20MB.", "Ảnh tham chiếu phải là file ảnh tối đa 20MB.") }, { status: 400 });
  const provider: ImageProvider = preferredProvider;
  if (provider === "openai" && !process.env.OPENAI_API_KEY) return NextResponse.json({ error: t("OpenAI Image is unavailable because OPENAI_API_KEY is not configured on the server.", "OpenAI Image chưa sẵn sàng vì server chưa có OPENAI_API_KEY.") }, { status: 503 });
  if (provider === "comfyui" && reference) return NextResponse.json({ error: t("Reference image editing currently uses the OpenAI Image provider.", "Chỉnh sửa bằng ảnh tham chiếu hiện dùng luồng OpenAI Image.") }, { status: 400 });

  const protectedInput = parsed.data;

  const initialModel = provider === "openai" ? (protectedInput.mode === "fast" ? "gpt-image-2.5-flare" : "gpt-image-2.5-sunburst") : (COMFYUI_CHECKPOINT || "comfyui-checkpoint");
  const [record] = await getDb().insert(imageGenerations).values({
    userId: user.id, prompt: parsed.data.prompt, provider, model: initialModel, size: protectedInput.size, quality: protectedInput.quality,
    background: protectedInput.background, progress: 3, stage: t("Preparing image environment", "Đang chuẩn bị môi trường tạo ảnh"),
  }).returning();
  const controller = new AbortController();
  registerImageJob(record.id, controller);
  void processImageGeneration({ recordId: record.id, userId: user.id, provider, input: protectedInput, reference, controller, locale: user.locale });
  return NextResponse.json({ image: publicImage(record) }, { status: 202 });
}
