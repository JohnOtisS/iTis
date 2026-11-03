import {eq} from "drizzle-orm";
import {getDb} from "@/db";
import {appSettings} from "@/db/schema";
import {normalizeUploadLimits} from "@/lib/upload-policy";
export async function getUploadLimits(){
  const [row]=await getDb().select({value:appSettings.value}).from(appSettings).where(eq(appSettings.key,"upload_limits"));
  return normalizeUploadLimits(row?.value);
}
