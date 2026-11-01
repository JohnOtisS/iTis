import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { sql } from "drizzle-orm";
import { reserveFile, releaseFile } from "@/lib/account-storage";

export type ChatAttachment = {
  name: string;
  url: string;
  type?: string;
  size?: number;
  kind?: "input" | "output";
  version?: number;
  family?: string;
  sourceUrls?: string[];
};

const filesDirectory = resolve(/* turbopackIgnore: true */ process.env.GENERATED_FILES_DIR || join(process.cwd(), "storage", "files"));
const pendingFiles = new AsyncLocalStorage<string[]>();

export async function withChatFileCleanup<T>(operation: () => Promise<T>): Promise<T> {
  return pendingFiles.run([], async () => {
    try { return await operation(); }
    finally {
      // Only files created by this request are candidates; referenced files stay.
      for (const url of pendingFiles.getStore() ?? []) await deleteChatFile(url);
    }
  });
}

function cleanExtension(name: string) {
  const extension = extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

export function mimeFromName(name: string) {
  const extension = cleanExtension(name);
  const types: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".zip": "application/zip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return types[extension] || "application/octet-stream";
}

export async function saveChatFile(bytes: Uint8Array, originalName: string, type: string | undefined, kind: "input" | "output", userId: string): Promise<ChatAttachment> {
  await mkdir(filesDirectory, { recursive: true });
  const id = `${randomUUID()}${cleanExtension(originalName)}`;
  const url = `/api/files/${id}`;
  await reserveFile(url, userId, bytes.byteLength);
  try {
    await writeFile(/* turbopackIgnore: true */ join(filesDirectory, id), bytes);
  } catch (error) {
    await releaseFile(url);
    throw error;
  }
  pendingFiles.getStore()?.push(url);
  return {
    name: originalName.replace(/[\r\n]/g, " ").slice(0, 180) || `itis-file${cleanExtension(originalName)}`,
    url: `/api/files/${id}`,
    type: type || mimeFromName(originalName),
    size: bytes.byteLength,
    kind,
  };
}

export async function readChatFile(id: string) {
  if (!/^[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/i.test(id)) return null;
  try {
    return await readFile(/* turbopackIgnore: true */ join(filesDirectory, id));
  } catch {
    return null;
  }
}

export async function deleteChatFile(url: string) {
  const id = url.startsWith("/api/files/") ? url.slice("/api/files/".length) : "";
  if (!/^[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/i.test(id)) return;
  // A branch or another message may still reference this file.
  const [referenced] = await getDb().select({ id: messages.id }).from(messages)
    .where(sql`${messages.attachments} @> ${JSON.stringify([{ url }])}::jsonb`).limit(1);
  if (referenced) return;
  try {
    await unlink(/* turbopackIgnore: true */ join(filesDirectory, id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await releaseFile(url);
}
