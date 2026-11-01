import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { saveAvatarFile } from "@/lib/avatar-files";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const { id } = await context.params;
  const [target] = await getDb().select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "Không tìm thấy người dùng." }, { status: 404 });
  const candidate = (await request.formData()).get("avatar");
  if (!(candidate instanceof File)) return NextResponse.json({ error: "Chưa chọn tệp ảnh." }, { status: 400 });
  try {
    const avatarUrl = await saveAvatarFile(id, candidate, target.avatarUrl);
    await getDb().update(users).set({ avatarUrl, updatedAt: new Date() }).where(eq(users.id, id));
    return NextResponse.json({ avatarUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể lưu ảnh." }, { status: 400 });
  }
}
