import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { reserveFile, releaseFile } from "@/lib/account-storage";

const avatarsDirectory = resolve(
  /* turbopackIgnore: true */ process.env.AVATARS_DIR ||
    join(process.cwd(), "storage", "avatars"),
);
const imageTypes: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function storedFileName(url: string | null | undefined) {
  const match = url?.match(
    /^\/api\/avatars\/([0-9a-f-]{36}\.(?:jpg|png|webp|gif))(?:\?.*)?$/i,
  );
  return match?.[1] ?? null;
}

export async function saveAvatarFile(
  userId: string,
  file: File,
  previousUrl?: string | null,
) {
  const extension = imageTypes[file.type];
  if (!extension) throw new Error("Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc GIF.");
  if (file.size <= 0 || file.size > 5 * 1024 * 1024)
    throw new Error("Ảnh đại diện tối đa 5MB.");
  const fileName = `${randomUUID()}${extension}`;
  const url = `/api/avatars/${fileName}`;
  await mkdir(avatarsDirectory, { recursive: true });
  await reserveFile(url, userId, file.size);
  try {
    await writeFile(join(/* turbopackIgnore: true */ avatarsDirectory, fileName), new Uint8Array(await file.arrayBuffer()));
  } catch (error) { await releaseFile(url); throw error; }
  await deleteAvatarFile(previousUrl);
  return `/api/avatars/${fileName}?v=${Date.now()}`;
}

export async function readAvatarFile(fileName: string) {
  if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/i.test(fileName)) return null;
  try {
    return await readFile(
      join(/* turbopackIgnore: true */ avatarsDirectory, basename(fileName)),
    );
  } catch {
    return null;
  }
}

export async function deleteAvatarFile(url: string | null | undefined) {
  const fileName = storedFileName(url);
  if (!fileName) return;
  await unlink(
    join(/* turbopackIgnore: true */ avatarsDirectory, basename(fileName)),
  ).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  await releaseFile(`/api/avatars/${fileName}`);
}

export function avatarMimeType(fileName: string) {
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  if (fileName.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}
