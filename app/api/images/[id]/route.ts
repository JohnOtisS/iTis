import { basename, join } from "node:path";
import { unlink } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { imageGenerations } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { GENERATED_IMAGES_DIR } from "@/lib/image-providers";
import { releaseFile } from "@/lib/account-storage";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.imageProvider === "disabled") return NextResponse.json({ error: "Studio ảnh đã bị tắt." }, { status: 403 });
  const { id } = await context.params;
  const [record] = await getDb().select().from(imageGenerations)
    .where(and(eq(imageGenerations.id, id), eq(imageGenerations.userId, user.id))).limit(1);
  if (!record) return NextResponse.json({ error: "Không tìm thấy ảnh." }, { status: 404 });
  if (record.fileName) await unlink(join(GENERATED_IMAGES_DIR, basename(record.fileName))).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  await releaseFile(`/api/images/${id}/file`);
  await getDb().delete(imageGenerations).where(eq(imageGenerations.id, id));
  return NextResponse.json({ deleted: true });
}
