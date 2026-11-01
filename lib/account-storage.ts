import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { storedFiles, users } from "@/db/schema";

export const GIB = 1024 ** 3;
export const STORAGE_ERROR = "Storage quota exceeded. Delete old chats/files or ask an admin to increase your storage limit. / Đã hết dung lượng. Hãy xóa chat/tệp cũ hoặc nhờ admin tăng giới hạn.";

export async function getAccountStorage(userId: string) {
  const [row] = await getDb().select({
    limitBytes: users.storageLimitBytes,
    historyBytes: sql<number>`itis_history_bytes(${users.id})`,
    fileBytes: sql<number>`coalesce((select sum(bytes) from stored_files where user_id = ${users.id}), 0)`,
  }).from(users).where(eq(users.id, userId));
  if (!row) throw new Error("Account not found");
  const historyBytes = Number(row.historyBytes);
  const fileBytes = Number(row.fileBytes);
  return { limitBytes: Number(row.limitBytes), historyBytes, fileBytes, usedBytes: historyBytes + fileBytes };
}

// The database trigger locks the account row, so concurrent requests cannot
// independently claim the same remaining capacity. Reserve before writing disk.
export async function reserveFile(url: string, userId: string, bytes: number) {
  try {
    await getDb().insert(storedFiles).values({ url, userId, bytes });
  } catch (error) {
    if (isStorageError(error)) throw new Error(STORAGE_ERROR);
    throw error;
  }
}

export async function releaseFile(url: string) {
  await getDb().delete(storedFiles).where(eq(storedFiles.url, url));
}

export function isStorageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /storage quota exceeded/i.test(error.message) || (error.cause ? isStorageError(error.cause) : false);
}
