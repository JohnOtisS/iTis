import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { avatarMimeType, readAvatarFile } from "@/lib/avatar-files";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { file } = await context.params;
  const bytes = await readAvatarFile(file);
  if (!bytes) return NextResponse.json({ error: "Không tìm thấy ảnh đại diện." }, { status: 404 });
  return new Response(bytes, { headers: { "Content-Type": avatarMimeType(file), "Cache-Control": "private, max-age=86400" } });
}
