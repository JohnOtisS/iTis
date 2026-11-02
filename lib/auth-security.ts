import { createHash } from "node:crypto";
import { sql, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { authRateWindows } from "@/db/schema";
export const tokenHash=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function authRateLimit(key:string,limit=5,windowMinutes=15){
 const bucket=Math.floor(Date.now()/(windowMinutes*60000));
 const [row]=await getDb().insert(authRateWindows).values({key:tokenHash(key)+":"+bucket,expiresAt:new Date((bucket+2)*windowMinutes*60000)}).onConflictDoUpdate({target:authRateWindows.key,set:{hits:sql`${authRateWindows.hits}+1`}}).returning({hits:authRateWindows.hits});
 if(row.hits===1)await getDb().delete(authRateWindows).where(lt(authRateWindows.expiresAt,new Date()));
 return row.hits<=limit;
}
export function requestAddress(request:Request){return request.headers.get("x-real-ip")||request.headers.get("x-forwarded-for")?.split(",")[0].trim()||"unknown";}
