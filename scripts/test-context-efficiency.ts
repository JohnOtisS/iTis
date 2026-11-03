import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../db";
import {users,conversations,messages} from "../db/schema";
import {buildChatContext} from "../lib/chat-context";
import {eq} from "drizzle-orm";
const db=getDb();const uid=randomUUID(),cid=randomUUID();
try{
  await db.insert(users).values({id:uid,email:uid+"@qa.invalid",name:"Context efficiency QA",passwordHash:"not-a-login"});
  await db.insert(conversations).values({id:cid,userId:uid,title:"Context fixture"});
  for(let i=0;i<28;i++)await db.insert(messages).values({conversationId:cid,role:i%2?"assistant":"user",content:`${i===4?"Agreed critical reference QA-REF-742 must retain 175 units. ":""}Record ${i}: `+"Background unrelated paragraph. ".repeat(90),createdAt:new Date(Date.now()-60000+i*1000)});
  const query="Check file with reference QA-REF-742";
  await db.insert(messages).values({conversationId:cid,role:"user",content:query});
  const full=await buildChatContext(cid,query,100000);
  const compact=await buildChatContext(cid,query,100000,{compact:true});
  assert.ok(compact.estimatedTokens<full.estimatedTokens);
  assert.equal(compact.history.at(-1)?.content,query);
  assert.match(compact.contextNote,/QA-REF-742/);
  console.log(JSON.stringify({case:"same-history document context",fullEstimatedTokens:full.estimatedTokens,compactEstimatedTokens:compact.estimatedTokens,reductionPercent:Math.round((1-compact.estimatedTokens/full.estimatedTokens)*100),retainedReference:true}));
}finally{
  await db.delete(users).where(eq(users.id,uid));
  await globalThis.__itisPostgresPool?.end();
}
