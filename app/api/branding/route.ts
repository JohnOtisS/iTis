import { NextResponse } from "next/server";
import { getBrandingSettings } from "@/lib/branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { branding: await getBrandingSettings() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
