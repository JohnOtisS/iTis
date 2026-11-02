// Synthetic HTTP cases with real configured model calls. Never run on real user data.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const accounts=[0,1].map(()=>({id:randomUUID(),token:randomUUID()}));
const root=resolve("artifacts",`memory-consolidation-${new Date().toISOString().replace(/[:.]/g,"-")}`);await mkdir(root,{recursive:true});
const report={cases:[],usage:[]};
const origin="http://127.0.0.1:5173";
async function api(user,path,options={}){return fetch(origin+path,{...options,headers:{cookie:`itis_session=${user.token}`,...options.headers},signal:AbortSignal.timeout(60000)});}
async function memories(user){const r=await api(user,"/api/account/memory");assert.equal(r.status,200);return (await r.json()).memories;}
async function chat(name,user,prompt,conversationId){const started=Date.now();const r=await api(user,"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt,conversationId})});const data=await r.json();report.cases.push({name,seconds:(Date.now()-started)/1000,status:r.status,...data});console.log(JSON.stringify({name,status:r.status,text:data.text,memory:data.memory?.status,changed:data.memory?.changed}));assert.equal(r.status,200,JSON.stringify(data));return data;}
async function patch(user,id,body){return api(user,`/api/account/memory/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}
try{
  for(const user of accounts){await pool.query("INSERT INTO users(id,email,name,password_hash,locale) VALUES($1,$2,'Synthetic memory QA','no-login','en')",[user.id,`${user.id}@memory-qa.invalid`]);await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,createHash('sha256').update(user.token).digest('hex')]);}
  const [a,b]=accounts;
  const first=await chat("01-save-filtered-facts",a,"Hãy ghi nhớ: Gọi tôi là Ngọc. Tôi thích câu trả lời ngắn gọn. Riêng báo cáo kế toán phải đầy đủ số liệu và có bảng. Đây là sở thích lâu dài, không phải yêu cầu tạo file.");assert.equal(first.memory.status,"saved");
  let stored=await memories(a);assert.ok(stored.length>=2&&stored.length<=3);assert.ok(stored.every(m=>m.content.length<650));assert.match(stored.map(m=>m.content).join(' '),/Ngọc/);
  const count=stored.length;
  const repeated=await chat("02-semantic-dedup",a,"Hãy ghi nhớ: tôi muốn được gọi là Ngọc; câu trả lời thường ngày ngắn, riêng báo cáo kế toán cần đủ số liệu và trình bày bảng.");assert.equal(repeated.memory.changed,0);assert.equal((await memories(a)).length,count);
  const correction=await chat("03-explicit-correction",a,"Từ nay đổi tên gọi của tôi từ Ngọc thành Lan. Hãy cập nhật bộ nhớ, giữ nguyên các sở thích trả lời và báo cáo kế toán.");assert.equal(correction.memory.status,"saved");
  stored=await memories(a);const nameMemory=stored.find(m=>/Lan/.test(m.content));assert.ok(nameMemory);assert.ok(nameMemory.canUndo);assert.ok(!stored.some(m=>/Ngọc/.test(m.content)));assert.equal(stored.length,count);
  const beforeConflict=stored.map(m=>({id:m.id,content:m.content}));
  const conflict=await chat("04-ambiguous-conflict",a,"Hãy ghi nhớ: Tên gọi của tôi là Hương.");assert.equal(conflict.memory.status,"conflict");assert.deepEqual((await memories(a)).map(m=>({id:m.id,content:m.content})),beforeConflict);
  const recall=await chat("05-cross-chat-recall",a,"Tên gọi của tôi là gì và tôi muốn báo cáo kế toán trình bày thế nào? Trả lời ngắn.");assert.match(recall.text,/Lan/);assert.match(recall.text,/bảng/);
  assert.equal((await patch(b,nameMemory.id,{content:"Owned by another account"})).status,404);
  assert.equal((await patch(b,nameMemory.id,{undo:true})).status,404);
  assert.equal((await api(b,`/api/account/memory/${nameMemory.id}`,{method:"DELETE"})).status,404);
  assert.equal((await memories(b)).length,0);
  assert.equal((await patch(a,nameMemory.id,{undo:true})).status,200);assert.ok((await memories(a)).some(m=>/Ngọc/.test(m.content)));
  assert.equal((await patch(a,nameMemory.id,{content:"Tên gọi: Mai."})).status,200);assert.ok((await memories(a)).some(m=>/Mai/.test(m.content)));
  assert.equal((await patch(a,nameMemory.id,{undo:true})).status,200);assert.ok((await memories(a)).some(m=>/Ngọc/.test(m.content)));
  report.cases.push({name:"06-edit-undo-and-account-isolation",passed:true});
  const pending=await chat("06b-pending-conflict",a,"Hãy ghi nhớ: tên gọi của tôi là Hương.");assert.equal(pending.memory.status,"conflict");
  const confirmed=await chat("06c-confirm-conflict",a,"Hãy thay thông tin cũ bằng Hương nhé.",pending.conversationId);assert.equal(confirmed.memory.status,"saved");assert.ok((await memories(a)).some(m=>/Hương/.test(m.content)));
  const history=await (await api(a,`/api/conversations/${first.conversationId}`)).json();assert.ok(history.messages.some(m=>m.memoryNotice));
  assert.equal((await api(a,`/api/conversations/${first.conversationId}`,{method:"DELETE"})).status,200);
  assert.equal((await patch(a,nameMemory.id,{undo:true})).status,200);assert.ok((await memories(a)).some(m=>/Ngọc/.test(m.content)));
  report.cases.push({name:"06d-undo-after-source-chat-deleted",passed:true});
  // An ordinary document request does not trigger memory extraction.
  const beforeUsage=Number((await pool.query("SELECT count(*) n FROM usage_events WHERE user_id=$1 AND router_reason='memory_consolidation'",[a.id])).rows[0].n);
  const ordinary=await chat("07-no-task-pollution",a,"Tôi muốn bạn liệt kê 2 bước chuẩn bị tài liệu. Chỉ trả lời 2 gạch đầu dòng.");assert.ok(ordinary.text);
  const afterUsage=Number((await pool.query("SELECT count(*) n FROM usage_events WHERE user_id=$1 AND router_reason='memory_consolidation'",[a.id])).rows[0].n);assert.equal(afterUsage,beforeUsage);
  await pool.query("UPDATE users SET auto_memory=false WHERE id=$1",[a.id]);
  const explicit=await chat("08-explicit-with-auto-off",a,"Hãy ghi nhớ lâu dài: quy trình duyệt chi phí của tôi có mã LOTUS-742.");assert.equal(explicit.memory.status,"saved");
  await pool.query("UPDATE users SET memory_enabled=false WHERE id=$1",[a.id]);
  const disabled=await chat("09-admin-disabled",a,"Hãy ghi nhớ: tên gọi của tôi là KhôngĐượcLưu.");assert.equal(disabled.memory.status,"skipped");assert.ok(!(await memories(a)).some(m=>/KhôngĐượcLưu/.test(m.content)));
  assert.equal((await patch(a,nameMemory.id,{content:"Blocked"})).status,403);
  await pool.query("UPDATE users SET memory_enabled=true WHERE id=$1",[a.id]);
  report.cases.push({name:"10-persisted-notice",passed:true});
}catch(error){report.error=String(error);process.exitCode=1;console.error(error);}
finally{
  report.usage=(await pool.query("SELECT model,router_reason,input_tokens,output_tokens,estimated_cost_usd FROM usage_events WHERE user_id=ANY($1::uuid[]) ORDER BY created_at",[accounts.map(a=>a.id)])).rows;
  await writeFile(resolve(root,"report.json"),JSON.stringify(report,null,2));
  for(const user of accounts)await api(user,"/api/conversations",{method:"DELETE"}).catch(()=>{});
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[accounts.map(a=>a.id)]);await pool.end();console.log("REPORT",root);
}
