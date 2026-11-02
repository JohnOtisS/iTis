import { lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { requestRateWindows } from "@/db/schema";
import { getRedis } from "@/lib/redis";

// Redis counters are temporary. PostgreSQL is the shared fallback, never an
// in-process Map whose limits disappear when another server handles a request.
export async function databaseRateLimit(userId:string,scope:"chat"|"memory",limit:number,now=Date.now()){
  const bucket=Math.floor(now/60000);
  const db=getDb();
  const [counter]=await db.insert(requestRateWindows).values({key:`${scope}:${userId}:${bucket}`,userId,hits:1,expiresAt:new Date((bucket+2)*60000)})
    .onConflictDoUpdate({target:requestRateWindows.key,set:{hits:sql`${requestRateWindows.hits}+1`}}).returning({hits:requestRateWindows.hits});
  if(counter.hits===1)await db.delete(requestRateWindows).where(lt(requestRateWindows.expiresAt,new Date(now-10*60000)));
  return counter.hits<=limit;
}
export async function enforceRateLimit(userId:string,scope:"chat"|"memory"="chat",limit=30){
  const redis=getRedis();
  if(redis)try{
    if(redis.status==="wait")await redis.connect();
    const key=`itis:rate:${scope}:${userId}:${Math.floor(Date.now()/60000)}`;
    const count=await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],90) end; return n",1,key);
    return Number(count)<=limit;
  }catch{/* Do not silently disable admission limits when Redis is unavailable. */}
  return databaseRateLimit(userId,scope,limit);
}
