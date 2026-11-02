import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {getDb} from "../db";
import {userMemories,users,requestRateWindows} from "../db/schema";
import {applyMemoryPlan,MemoryConflict} from "../lib/memory-consolidation";
import {encryptMemory,memoryHash,inferMemoryCandidate} from "../lib/memory";
import {databaseRateLimit,enforceRateLimit} from "../lib/rate-limit";
import {getRedis} from "../lib/redis";
const db=getDb();const ids=[randomUUID(),randomUUID()];
try{
  for(const id of ids)await db.insert(users).values({id,email:`${id}@memory-data.invalid`,name:"Synthetic data QA",passwordHash:"no-login"});
  const [a,b]=ids;
  const [row]=await db.insert(userMemories).values({userId:a,contentHash:memoryHash(a,"Tên gọi: Ngọc"),encryptedContent:encryptMemory("Tên gọi: Ngọc"),kind:"profile"}).returning();
  const update={action:"update" as const,targetId:row.id,kind:"profile" as const,content:"Tên gọi: Lan",question:""};
  await assert.rejects(applyMemoryPlan({userId:b,snapshots:[row],plan:{operations:[update]}}),MemoryConflict);
  const result=await applyMemoryPlan({userId:a,snapshots:[row],plan:{operations:[update]}});assert.equal(result.changed,1);
  await assert.rejects(applyMemoryPlan({userId:a,snapshots:[row],plan:{operations:[{...update,content:"Tên gọi: Mai"}]}}),MemoryConflict);
  await assert.rejects(applyMemoryPlan({userId:a,snapshots:[],expectedVersion:0,plan:{operations:[{action:"add",targetId:null,kind:"knowledge",content:"Stale extraction must not reappear after forgetting",question:""}]}}),MemoryConflict);
  const [latest]=await db.select().from(userMemories).where(eq(userMemories.id,row.id));
  const conflict=await applyMemoryPlan({userId:a,snapshots:[latest],plan:{operations:[{action:"add",targetId:null,kind:"knowledge",content:"Must not be partially committed",question:""},{action:"conflict",targetId:latest.id,kind:"profile",content:"",question:"Which name?"}]}});assert.equal(conflict.changed,0);
  assert.equal((await db.select().from(userMemories).where(eq(userMemories.userId,a))).length,1);
  assert.equal(latest.revisions.length,1);assert.ok(latest.encryptedContent.startsWith('v1.'));assert.ok(latest.revisions[0].encryptedContent.startsWith('v1.'));
  const counts=await Promise.all(Array.from({length:32},()=>databaseRateLimit(a,"chat",30)));assert.equal(counts.filter(Boolean).length,30);
  assert.equal(await databaseRateLimit(b,"chat",30),true);
  assert.equal((await db.select().from(requestRateWindows).where(eq(requestRateWindows.userId,a)))[0].hits,32);
  const realRedis=getRedis();
  if(realRedis){
    assert.equal(await enforceRateLimit(b,"memory",2),true);assert.equal(await enforceRateLimit(b,"memory",2),true);assert.equal(await enforceRateLimit(b,"memory",2),false);
    const keys=await realRedis.keys(`itis:rate:memory:${b}:*`);for(const key of keys)assert.ok((await realRedis.ttl(key))>0);
    if(keys.length)await realRedis.del(...keys);realRedis.disconnect();globalThis.__itisRedis=undefined;
  }
  process.env.REDIS_URL="redis://127.0.0.1:1";
  assert.equal(await enforceRateLimit(a,"memory",2),true);assert.equal(await enforceRateLimit(a,"memory",2),true);assert.equal(await enforceRateLimit(a,"memory",2),false);
  assert.equal(inferMemoryCandidate("Tôi muốn tạo file Word"),null);assert.equal(inferMemoryCandidate("Bạn có nhớ tôi không?"),null);
  console.log("PASS: encrypted revisions, ownership, stale-write rejection, conflict atomicity; 32 concurrent DB counters, Redis TTL, Redis-outage fallback, account isolation.");
}finally{
  globalThis.__itisRedis?.disconnect();await db.delete(users).where(eq(users.id,ids[0]));await db.delete(users).where(eq(users.id,ids[1]));await globalThis.__itisPostgresPool?.end();
}
