import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) {
    return NextResponse.json({ error: "Please enter your email and password." }, { status: 400 });
  }

  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
