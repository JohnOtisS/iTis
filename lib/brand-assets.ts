import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

export type BrandAssetKind = "system" | "chat";

const brandDirectory = resolve(
  /* turbopackIgnore: true */ process.env.BRAND_ASSETS_DIR ||
    join(process.cwd(), "storage", "branding"),
);

const imageTypes: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const mimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function isBrandKind(value: string): value is BrandAssetKind {
  return value === "system" || value === "chat";
}

async function removeExisting(kind: BrandAssetKind) {
  await mkdir(brandDirectory, { recursive: true });
  const files = await readdir(brandDirectory);
  await Promise.all(
    files
      .filter((file) => file.startsWith(`${kind}.`))
      .map((file) => unlink(join(brandDirectory, file)).catch(() => undefined)),
  );
}

export async function saveBrandAsset(kind: string, file: File) {
  if (!isBrandKind(kind)) throw new Error("Invalid logo type.");
  const extension = imageTypes[file.type];
  if (!extension) throw new Error("Only JPG, PNG, WebP, or GIF images are supported.");
  if (file.size <= 0 || file.size > 5 * 1024 * 1024)
    throw new Error("Logo image must be 5MB or smaller.");
  await removeExisting(kind);
  await writeFile(
    join(/* turbopackIgnore: true */ brandDirectory, `${kind}${extension}`),
    new Uint8Array(await file.arrayBuffer()),
  );
  return `/api/brand-assets/${kind}?v=${Date.now()}`;
}

export async function deleteBrandAsset(kind: string) {
  if (!isBrandKind(kind)) throw new Error("Invalid logo type.");
  await removeExisting(kind);
}

export async function readBrandAsset(kind: string) {
  if (!isBrandKind(kind)) return null;
  try {
    const files = await readdir(brandDirectory);
    const fileName = files.find((file) => file.startsWith(`${kind}.`));
    if (!fileName) return null;
    const extension = extname(fileName).toLowerCase();
    return {
      bytes: await readFile(join(/* turbopackIgnore: true */ brandDirectory, fileName)),
      contentType: mimeTypes[extension] ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}
