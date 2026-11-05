import {authRateLimit,requestAddress} from "@/lib/auth-security";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { accountAccessExpired, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) {
    return NextResponse.json({ error: "Please enter your email and password." }, { status: 400 });
  }

  if(!await authRateLimit("login-ip:"+requestAddress(request),50)||!await authRateLimit("login-email:"+email,15))return NextResponse.json({error:"Too many attempts. Try again in 15 minutes."},{status:429});
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }
  if (accountAccessExpired(user.accessExpiresAt)) {
    return NextResponse.json({
      error: user.locale === "vi" ? "Tài khoản đã hết hạn. Hãy liên hệ quản trị viên để gia hạn." : "This account has expired. Contact your administrator to renew access.",
    }, { status: 403 });
  }

  if(!await createSession(user.id,user.passwordHash))return NextResponse.json({error:"Account or password changed. Please sign in again."},{status:401});
  return NextResponse.json({ ok: true });
}
