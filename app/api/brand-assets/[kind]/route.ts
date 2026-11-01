import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readBrandAsset } from "@/lib/brand-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const asset = await readBrandAsset(kind);
  if (asset) {
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "no-store",
      },
    });
  }
  if (kind === "system" || kind === "chat") {
    const fallback = await readFile(join(process.cwd(), "public", "favicon.svg"));
    return new Response(new Uint8Array(fallback), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response("Not found", { status: 404 });
}
