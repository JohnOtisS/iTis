import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { deleteBrandAsset, saveBrandAsset } from "@/lib/brand-assets";
import { getBrandingSettings } from "@/lib/branding";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function saveSettings(value: Awaited<ReturnType<typeof getBrandingSettings>>) {
  await getDb()
    .insert(appSettings)
    .values({ key: "branding", value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "");
  const file = form.get("logo");
  if (!(file instanceof File))
    return NextResponse.json({ error: "Logo file is required." }, { status: 400 });
  try {
    const url = await saveBrandAsset(kind, file);
    const branding = await getBrandingSettings();
    const next = kind === "system"
      ? { ...branding, systemLogoUrl: url }
      : { ...branding, chatLogoUrl: url };
    await saveSettings(next);
    return NextResponse.json({ branding: next });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save logo." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const kind = new URL(request.url).searchParams.get("kind") ?? "";
  try {
    await deleteBrandAsset(kind);
    const branding = await getBrandingSettings();
    const next = kind === "system"
      ? { ...branding, systemLogoUrl: null }
      : { ...branding, chatLogoUrl: null };
    await saveSettings(next);
    return NextResponse.json({ branding: next });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to reset logo." },
      { status: 400 },
    );
  }
}
