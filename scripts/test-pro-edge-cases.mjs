// Live HTTP tests with synthetic data; invokes the configured OpenAI account.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { Pool } from "pg";
const pool = new Pool({connectionString:process.env.DATABASE_URL});
const accounts = [0,1].map(()=>({id:randomUUID(),token:randomUUID()}));
const root = resolve("artifacts",`pro-edge-${new Date().toISOString().replace(/[:.]/g,"-")}`);
await mkdir(root,{recursive:true});
const report={cases:[],usage:[]};
async function api(user,path,options={}) { return fetch("http://127.0.0.1:5173"+path,{...options,headers:{cookie:`itis_session=${user.token}`,...options.headers},signal:AbortSignal.timeout(240000)}); }
async function chat(name,user,prompt,id,files=[]) {
  const body=new FormData();body.set("prompt",prompt);if(id)body.set("conversationId",id);
  for(const file of files)body.append("files",new Blob([file.bytes]),file.name);
  const started=Date.now();const response=await api(user,"/api/chat",{method:"POST",body});const data=await response.json();
  const record={name,status:response.status,seconds:(Date.now()-started)/1000,...data};report.cases.push(record);
  console.log(JSON.stringify({name,status:record.status,seconds:record.seconds,text:data.text,error:data.error}));
  assert.equal(response.status,200,JSON.stringify(data));
  for(const file of data.attachments??[]){const r=await api(user,file.url);assert.equal(r.status,200);await writeFile(resolve(root,`${name}-${basename(file.name)}`),new Uint8Array(await r.arrayBuffer()));}
  return data;
}
try {
  for(const user of accounts){await pool.query("INSERT INTO users(id,email,name,password_hash,locale) VALUES($1,$2,'Synthetic edge QA','no-login','vi')",[user.id,`${user.id}@edge.invalid`]);await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,createHash("sha256").update(user.token).digest("hex")]);}
  const [a,b]=accounts;
  // Quota guards must reject before making a paid request.
  await pool.query("UPDATE users SET token_limit=10,total_token_limit=100 WHERE id=$1",[b.id]);
  await pool.query("INSERT INTO usage_events(user_id,model,input_tokens,output_tokens,estimated_cost_usd) VALUES($1,'synthetic',10,0,0)",[b.id]);
  let r=await api(b,"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"Hello"})});assert.equal(r.status,429);assert.equal((await r.json()).code,"CYCLE_TOKEN_LIMIT");
  await pool.query("UPDATE usage_events SET created_at=now()-interval '6 hours',input_tokens=100 WHERE user_id=$1",[b.id]);
  r=await api(b,"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"Hello"})});assert.equal(r.status,429);assert.equal((await r.json()).code,"TOTAL_TOKEN_LIMIT");
  assert.equal(Number((await pool.query("SELECT count(*) n FROM usage_events WHERE user_id=$1",[b.id])).rows[0].n),1);
  report.cases.push({name:"quota-cycle-and-total-no-paid-call",passed:true});console.log("PASS: cycle/total quota guards; no additional usage.");
  r=await api(a,"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"x".repeat(150003)})});assert.equal(r.status,409);assert.equal((await r.json()).code,"CONVERSATION_LIMIT_REACHED");
  report.cases.push({name:"oversized-first-message",passed:true});
  const csv="Item,Qty,Price\nAlpha,3,19.99\nBeta,2,10.05\nRefund,-1,5.00\n";
  const calc=await chat("01-decimals-refund",a,"Tính thành tiền từng dòng từ Qty * Price trong CSV, gồm dòng hoàn tiền âm. Cộng subtotal, VAT 8% làm tròn half-up 2 chữ số sau dấu thập phân, rồi tính tổng thanh toán. Dùng Decimal để tránh sai số float. Nêu số chính xác, không xuất file.",null,[{name:"money.csv",bytes:csv}]);
  assert.match(calc.text,/75[.,]07/);assert.match(calc.text,/6[.,]01/);assert.match(calc.text,/81[.,]08/);assert.equal(calc.verification.passed,true);
  const updated=await chat("02-followup-excel",a,"Từ CSV vừa gửi, đổi Qty của Beta thành 3. Xuất file Excel XLSX có dữ liệu gốc đã sửa, công thức thành tiền, subtotal, VAT 8% làm tròn 2 chữ số và tổng thanh toán. Giữ dòng Refund âm. Công thức phải có cached values đúng. Nêu tổng sau sửa, không yêu cầu tải lại CSV.",calc.conversationId);
  assert.match(updated.text,/91[.,]93/);assert.ok(updated.attachments.some(f=>/\.xlsx$/i.test(f.name)));
  const source=await readFile(resolve("artifacts/office-performance-2026-11-01T16-10-05-109Z/01-word-create-JD_Backend_Developer_Junior_SOURCE-742.docx"));
  const pdf=await chat("03-word-to-pdf",a,"Chuyển Word đính kèm sang PDF, giữ nguyên nội dung tiếng Việt và mã SOURCE-742. Kiểm tra nội dung PDF đọc được, không viết lại JD. Xuất file PDF tải xuống.",null,[{name:"source.docx",bytes:source}]);
  assert.ok(pdf.attachments.some(f=>/\.pdf$/i.test(f.name)));
  const {rows:[long]}=await pool.query("INSERT INTO conversations(user_id,title) VALUES($1,'Long context edge QA') RETURNING id",[a.id]);
  for(let i=0;i<42;i++)await pool.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,$2,$3)",[long.id,i%2?"assistant":"user",i===8?"Đính chính: mã dự án Orchid cuối cùng là ORCHID-928; loại mã cũ ORCHID-111.":`Trao đổi giả lập ${i}. Hoàn tất tác vụ mẫu.`]);
  const recall=await chat("04-long-recall-correction",a,"Mã dự án Orchid cuối cùng sau đính chính là gì? Chỉ trả mã.",long.id);
  assert.match(recall.text,/ORCHID-928/);assert.doesNotMatch(recall.text,/ORCHID-111/);
  r=await api(b,`/api/conversations/${long.id}`);assert.equal(r.status,404);
  report.cases.push({name:"cross-account-history-isolation",passed:true});
} catch(error){report.error=String(error);process.exitCode=1;console.error(error);}
finally {
  report.usage=(await pool.query("SELECT model,input_tokens,output_tokens,tool_cost_usd,estimated_cost_usd,router_reason FROM usage_events WHERE user_id=$1 ORDER BY created_at",[accounts[0].id])).rows;
  await writeFile(resolve(root,"report.json"),JSON.stringify(report,null,2));
  for(const user of accounts)await api(user,"/api/conversations",{method:"DELETE"}).catch(()=>{});
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[accounts.map(u=>u.id)]);await pool.end();console.log("REPORT",root);
}
