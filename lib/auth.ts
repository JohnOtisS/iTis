import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, or, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "itis_session";
const SESSION_DAYS = 30;

export type AppUser = {
  id: string;
  email: string;
  name: string;
  locale: "en" | "vi";
  avatarUrl: string | null;
  role: "admin" | "plus" | "standard";
  tokenLimit: number;
  unlimited: boolean;
  totalTokenLimit: number;
  totalUnlimited: boolean;
  storageLimitBytes: number;
  resetWindowHours: number;
  aiProvider: "openai" | "local";
  imageProvider: "openai" | "comfyui" | "disabled";
  memoryEnabled: boolean;
  autoMemory: boolean;
  allowMultipleSessions: boolean;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await getDb()
    .select({
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        locale: users.locale,
        avatarUrl: users.avatarUrl,
        role: users.role,
        tokenLimit: users.tokenLimit,
        unlimited: users.unlimited,
        totalTokenLimit: users.totalTokenLimit,
        totalUnlimited: users.totalUnlimited,
        storageLimitBytes: users.storageLimitBytes,
        resetWindowHours: users.resetWindowHours,
        aiProvider: users.aiProvider,
        imageProvider: users.imageProvider,
        memoryEnabled: users.memoryEnabled,
        autoMemory: users.autoMemory,
        allowMultipleSessions: users.allowMultipleSessions,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.tokenHash, hashToken(token)),
      gt(sessions.expiresAt, new Date()),
      eq(users.isActive, true),
    ))
    .limit(1);

  const user = rows[0]?.user as AppUser | undefined;
  if(user) await getDb().update(users).set({lastSeenAt:new Date()}).where(and(eq(users.id,user.id),or(isNull(users.lastSeenAt),lt(users.lastSeenAt,new Date(Date.now()-60000)))));
  return user ?? null;
}

export async function requireCurrentUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}

export async function currentSessionHash() {
  const token=(await cookies()).get(SESSION_COOKIE)?.value;
  return token?hashToken(token):null;
}

export async function createSession(userId: string, expectedPasswordHash?: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const created=await getDb().transaction(async tx=>{
    // Serialize logins with policy/password changes, including concurrent logins.
    const [owner]=await tx.select().from(users).where(eq(users.id,userId)).for("update");
    if(!owner?.isActive||(expectedPasswordHash&&owner.passwordHash!==expectedPasswordHash))return false;
    if(!owner.allowMultipleSessions)await tx.delete(sessions).where(eq(sessions.userId,userId));
    await tx.insert(sessions).values({userId,tokenHash:hashToken(token),expiresAt});
    return true;
  });
  if(!created)return false;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.SESSION_COOKIE_SECURE === "false" ? false : process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return true;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", expires: new Date(0) });
}
