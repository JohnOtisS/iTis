// End-to-end regression suite. Uses synthetic accounts and real OpenAI calls.
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {Pool} from "pg";
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const users=[0,1].map(()=>({id:randomUUID(),token:randomUUID()}));
const origin="http://127.0.0.1:5173";
async function api(user,path,options={}){return fetch(origin+path,{...options,headers:{cookie:`itis_session=${user.token}`,...options.headers},signal:AbortSignal.timeout(180000)});}
async function send(user,prompt,id,files){
  const body=new FormData();body.set("prompt",prompt);if(id)body.set("conversationId",id);
  for(const file of files??[])body.append("files",new Blob([file.content],{type:"text/csv"}),file.name);
  const response=await api(user,"/api/chat",{method:"POST",body});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
}
try{
  for(const user of users){await pool.query("INSERT INTO users(id,email,name,password_hash,locale) VALUES($1,$2,'PRO QA','not-a-real-login','vi')",[user.id,`${user.id}@pro-test.invalid`]);await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,createHash("sha256").update(user.token).digest("hex")]);}
  const [a,b]=users;
  const first=await send(a,"Liệt kê tên mặt hàng trong tài liệu đính kèm.",null,[{name:"qa-items.csv",content:"Item,Qty,Price\nAlpha,2,120\nBeta,3,80\n"}]);
  assert.match(first.text,/Alpha/);assert.match(first.text,/Beta/);
  let {rows:[cached]}=await pool.query("SELECT sf.extracted_text,sf.provider_file_id FROM stored_files sf WHERE sf.user_id=$1",[a.id]);
  assert.ok(cached.extracted_text.includes("Alpha"));assert.equal(cached.provider_file_id,null,"plain reading should not upload a new provider file");
  const second=await send(a,"Nhắc lại tên mặt hàng trong file này.",first.conversationId);
  assert.match(second.text,/Alpha/);
  const {rows:[usage]}=await pool.query("SELECT coalesce(sum(tool_cost_usd),0) AS tools FROM usage_events WHERE user_id=$1",[a.id]);
  assert.equal(Number(usage.tools),0,"text-only document Q&A should not pay for a container");
  console.log("PASS: document retrieval without continuation keywords, cached extraction, no container charge for simple reads.");
  const body=new FormData();body.set("conversationId",first.conversationId);body.set("prompt","Tính tổng thành tiền từ Qty và Price trong file, đối chiếu từng dòng. Không xuất file.");
  const calc=await api(a,"/api/chat",{method:"POST",headers:{accept:"application/x-ndjson"},body});
  assert.equal(calc.status,200);const events=(await calc.text()).trim().split("\n").map(JSON.parse);
  const done=events.find(e=>e.type==="done");assert.ok(done,JSON.stringify(events));assert.ok(events.some(e=>e.type==="progress"));assert.equal(done.verification.passed,true);assert.equal(done.attachments.length,0);assert.match(done.text,/480/);
  assert.equal(done.usage.tool_cost_usd,.03);
  console.log("PASS: streamed calculation progress, tool validation and 1 GiB container cost.");
  const stopBody=new FormData();stopBody.set("conversationId",first.conversationId);stopBody.set("prompt","Tạo file Excel XLSX gồm 10000 dòng dữ liệu giả, tính công thức và kiểm tra tất cả tổng trước khi xuất.");
  const active=await api(a,"/api/chat",{method:"POST",headers:{accept:"application/x-ndjson"},body:stopBody});
  const reader=active.body.getReader();const decoder=new TextDecoder();let buffer="",jobId;
  while(!jobId){const {value,done}=await reader.read();assert.equal(done,false);buffer+=decoder.decode(value,{stream:true});for(const line of buffer.split("\n").filter(Boolean)){try{const e=JSON.parse(line);jobId??=e.jobId;}catch{}}}
  const denied=await api(b,`/api/chat/jobs/${jobId}`);assert.equal(denied.status,404);
  for(let i=0;i<40;i++){const status=await (await api(a,`/api/chat/jobs/${jobId}`)).json();if(status.job.providerResponseId)break;await new Promise(r=>setTimeout(r,250));}
  const stop=await api(a,`/api/chat/jobs/${jobId}`,{method:"POST"});assert.equal(stop.status,200);assert.equal((await stop.json()).cancelled,true);
  while(!(await reader.read()).done){/* drain terminal error/progress */}
  const status=await (await api(a,`/api/chat/jobs/${jobId}`)).json();assert.equal(status.job.status,"cancelled");assert.equal(status.job.result,null);
  console.log("PASS: account-isolated job status, real provider cancellation, no files published after stop.");
  const image=new FormData();image.set("prompt","Vẽ một bức tranh phong cảnh thiên nhiên");const routed=await api(a,"/api/chat",{method:"POST",body:image});assert.equal(routed.status,422);assert.equal((await routed.json()).code,"USE_IMAGE_STUDIO");
  console.log("PASS: image generation stays in Image Studio.");
}finally{
  for(const user of users)await api(user,"/api/conversations",{method:"DELETE"}).catch(()=>{});
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[users.map(u=>u.id)]);await pool.end();
}
