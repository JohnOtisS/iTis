import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { saveAvatarFile } from "@/lib/avatar-files";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const candidate = (await request.formData()).get("avatar");
  if (!(candidate instanceof File)) return NextResponse.json({ error: "Chưa chọn tệp ảnh." }, { status: 400 });
  try {
    const avatarUrl = await saveAvatarFile(user.id, candidate, user.avatarUrl);
    await getDb().update(users).set({ avatarUrl, updatedAt: new Date() }).where(eq(users.id, user.id));
    return NextResponse.json({ avatarUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể lưu ảnh." }, { status: 400 });
  }
}
