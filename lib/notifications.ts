import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, notificationCampaigns, notificationDeliveries, passwordResets } from "@/db/schema";
import { encryptMemory } from "@/lib/memory";
import { tokenHash } from "@/lib/auth-security";

export async function emailSettings() {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, "email_notifications"));
  const v = (row?.value ?? {}) as { enabled?: boolean; welcomeEnabled?: boolean; sender?: string; senderName?: string };
  return { enabled: v.enabled ?? false, welcomeEnabled: v.welcomeEnabled ?? true, sender: v.sender ?? "", senderName: v.senderName ?? "iTis" };
}
export function publicUrl() {
  const url = new URL(process.env.ITIS_PUBLIC_URL || process.env.APP_URL || "http://localhost:5173");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("HTTPS public URL required");
  return url.origin;
}
export async function enqueueNotification(input: { createdBy?: string; kind: string; subject: string; body: string; recipients: Array<{ id: string; email: string }>; privateText?: string; email?: boolean }) {
  return getDb().transaction(async tx => {
    const [campaign] = await tx.insert(notificationCampaigns).values({ createdBy: input.createdBy, kind: input.kind, subject: input.subject, body: input.body }).returning();
    if (input.recipients.length) await tx.insert(notificationDeliveries).values(input.recipients.map(u => ({ campaignId: campaign.id, userId: u.id, recipient: u.email, status: input.email === false ? "in_app" : "queued", encryptedPayload: input.email === false ? null : encryptMemory(input.privateText ?? input.body) })));
    return { id: campaign.id, status: input.email === false ? "in_app" : "queued", recipients: input.recipients.length };
  });
}
export async function requestPasswordReset(user: { id: string; email: string }, createdBy?: string) {
  const token = randomBytes(32).toString("base64url");
  const url = `${publicUrl()}/reset-password#token=${token}`;
  await getDb().transaction(async tx => {
    await tx.delete(passwordResets).where(eq(passwordResets.userId, user.id));
    await tx.insert(passwordResets).values({ userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 30 * 60000) });
  });
  return enqueueNotification({ createdBy, kind: "password_reset", subject: "Reset your iTis password / Đặt lại mật khẩu", body: "A password reset was requested. The private link expires in 30 minutes.", privateText: `Reset your iTis password / Đặt lại mật khẩu iTis:\n${url}\nThis link expires in 30 minutes and can be used once. Ignore this email if you did not request it.`, recipients: [user] });
}
