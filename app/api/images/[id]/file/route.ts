import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { imageGenerations } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { GENERATED_IMAGES_DIR } from "@/lib/image-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.imageProvider === "disabled") return NextResponse.json({ error: "Studio ảnh đã bị tắt." }, { status: 403 });
  const { id } = await context.params;
  const [record] = await getDb().select().from(imageGenerations)
    .where(and(eq(imageGenerations.id, id), eq(imageGenerations.userId, user.id))).limit(1);
  if (!record?.fileName || record.status !== "completed") return NextResponse.json({ error: "Không tìm thấy ảnh." }, { status: 404 });
  try {
    const bytes = await readFile(join(GENERATED_IMAGES_DIR, basename(record.fileName)));
    return new Response(bytes, { headers: { "Content-Type": record.mimeType || "image/png", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return NextResponse.json({ error: "File ảnh không còn trên server." }, { status: 404 });
  }
}
