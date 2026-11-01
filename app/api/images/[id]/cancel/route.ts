import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { imageGenerations } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { abortImageJob } from "@/lib/image-jobs";
import { COMFYUI_BASE_URL } from "@/lib/image-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You need to sign in." }, { status: 401 });
  const t = (english: string, vietnamese: string) => user.locale === "vi" ? vietnamese : english;
  if (user.imageProvider === "disabled") return NextResponse.json({ error: t("Image Studio is disabled.", "Studio ảnh đã bị tắt.") }, { status: 403 });
  const { id } = await context.params;
  const [record] = await getDb().select().from(imageGenerations)
    .where(and(eq(imageGenerations.id, id), eq(imageGenerations.userId, user.id))).limit(1);
  if (!record) return NextResponse.json({ error: t("Image job not found.", "Không tìm thấy job tạo ảnh.") }, { status: 404 });
  if (record.status !== "processing") return NextResponse.json({ ok: true, status: record.status });

  await getDb().update(imageGenerations).set({ status: "canceled", stage: t("Canceled by request", "Đã dừng theo yêu cầu"), completedAt: new Date() })
    .where(and(eq(imageGenerations.id, id), eq(imageGenerations.userId, user.id), eq(imageGenerations.status, "processing")));
  abortImageJob(id);

  if (record.provider === "comfyui" && record.externalJobId) {
    await Promise.allSettled([
      fetch(`${COMFYUI_BASE_URL}/queue`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: [record.externalJobId] }), signal: AbortSignal.timeout(3_000),
      }),
      fetch(`${COMFYUI_BASE_URL}/interrupt`, { method: "POST", signal: AbortSignal.timeout(3_000) }),
    ]);
  }

  return NextResponse.json({ ok: true, status: "canceled" });
}
