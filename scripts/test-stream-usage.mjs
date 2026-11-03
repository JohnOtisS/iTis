// One paid, small OpenAI streaming case using a disposable account.
import nextEnv from "@next/env";nextEnv.loadEnvConfig(process.cwd());
import {Pool} from "pg";import {randomUUID,createHash} from "node:crypto";import assert from "node:assert/strict";
const p=new Pool({connectionString:process.env.DATABASE_URL});const id=randomUUID(),token=randomUUID();
const origin=process.env.TEST_ORIGIN||"http://127.0.0.1:15174";
async function stream(prompt){
 const r=await fetch(origin+"/api/chat",{method:"POST",headers:{cookie:`itis_session=${token}`,"content-type":"application/json",accept:"application/x-ndjson"},body:JSON.stringify({prompt}),signal:AbortSignal.timeout(90000)});
 assert.equal(r.status,200,await r.clone().text());return (await r.text()).trim().split("\n").map(s=>JSON.parse(s));
}
try{
 await p.query("insert into users(id,email,name,password_hash,locale,unlimited,total_unlimited) values($1,$2,'Disposable streaming QA','not-a-login','vi',true,true)",[id,id+"@qa.invalid"]);
 await p.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[id,createHash("sha256").update(token).digest("hex")]);
 const events=await stream("Trả lời duy nhất STREAM-742.");const done=events.find(e=>e.type==="done");assert.ok(done?.messageId);assert.equal(done.usage.usage_complete,true);assert.match(done.text,/STREAM-742/);
 const row=(await p.query("select task_usage from messages where id=$1",[done.messageId])).rows[0];assert.equal(row.task_usage.total_tokens,done.usage.total_tokens);
 console.log("PASS streaming answer has permanent message ID and identical total usage after reload");
 const usage=(await p.query("select input_tokens,output_tokens,tool_details,router_reason from usage_events where user_id=$1 order by created_at",[id])).rows;
 assert.equal(usage.length,1);assert.ok(usage[0].input_tokens>0);assert.ok(usage[0].output_tokens>0);assert.equal(usage[0].tool_details.usageAvailable,true);
 console.log("PASS completed stream records provider input/output usage exactly once");
}finally{await p.query("delete from users where id=$1",[id]);await p.end();}
