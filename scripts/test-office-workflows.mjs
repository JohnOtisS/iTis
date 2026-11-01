// Synthetic end-to-end Office cases. Calls the configured OpenAI account.
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,basename} from "node:path";
import {Pool} from "pg";
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const user={id:randomUUID(),token:randomUUID()};
const root=resolve("artifacts",`office-performance-${new Date().toISOString().replace(/[:.]/g,"-")}`);
await mkdir(root,{recursive:true});
const report={cases:[],usage:[]};
async function api(path,options={}){return fetch("http://127.0.0.1:5173"+path,{...options,headers:{cookie:`itis_session=${user.token}`,...options.headers},signal:AbortSignal.timeout(300000)});}
async function run(name,prompt,files=[],id){
  const started=Date.now();const form=new FormData();form.set("prompt",prompt);if(id)form.set("conversationId",id);
  for(const file of files)form.append("files",new Blob([file.bytes]),file.name);
  const response=await api("/api/chat",{method:"POST",body:form});const data=await response.json();
  const record={name,status:response.status,seconds:Number(((Date.now()-started)/1000).toFixed(2)),...data};report.cases.push(record);
  console.log(JSON.stringify({name,status:response.status,seconds:record.seconds,pipeline:data.pipeline,model:data.model,text:data.text,error:data.error,files:data.attachments?.map(f=>({name:f.name,version:f.version}))}));
  assert.equal(response.status,200,JSON.stringify(data));
  for(const file of data.attachments??[]){const r=await api(file.url);assert.equal(r.status,200);const bytes=new Uint8Array(await r.arrayBuffer());await writeFile(resolve(root,`${name}-${basename(file.name)}`),bytes);}
  return data;
}
try{
  await pool.query("INSERT INTO users(id,email,name,password_hash,locale) VALUES($1,$2,'Office synthetic QA','not-a-real-login','vi')",[user.id,`${user.id}@office-test.invalid`]);
  await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[user.id,createHash("sha256").update(user.token).digest("hex")]);
  const first=await run("01-word-create","Tạo một bản JD vị trí Backend Developer junior chuyên nghiệp bằng tiếng Việt, gồm nhiệm vụ, yêu cầu, quyền lợi và cách ứng tuyển. Thông tin công ty chưa có để placeholder. Giữ mã tài liệu SOURCE-742. Xuất 1 file Word DOCX, trả lời ngắn.");
  assert.equal(first.pipeline,"fast_word_create");assert.equal(first.usage.tool_cost_usd,0);
  const original=(await api(first.attachments[0].url));const bytes=new Uint8Array(await original.arrayBuffer());
  const edited=await run("02-word-edit","Sửa file Word đính kèm: thay tất cả chữ Backend Developer thành Full-stack Developer. Giữ nguyên mã SOURCE-742, các nội dung khác, bố cục và định dạng. Xuất lại file Word DOCX.",[{name:"source.docx",bytes}]);
  assert.equal(edited.pipeline,"fast_word_edit");assert.equal(edited.usage.tool_cost_usd,0);
  const excel=await readFile(resolve("artifacts/chat-audit-2026-11-01T15-43-50-004Z/bao-cao.xlsx"));
  const sheet=await run("03-excel-analyze-edit","Phân tích file Excel đính kèm, đối chiếu các dòng Alpha, Beta, Gamma. Đổi số lượng Alpha từ 2 thành 4, giữ nguyên đơn giá, cập nhật công thức thành tiền, tổng và VAT 10%. Xuất lại XLSX hoàn chỉnh. Nêu tổng trước và sau sửa cùng sheet/ô nguồn, không bịa dữ liệu.",[{name:"orders.xlsx",bytes:excel}]);
  assert.ok(sheet.attachments.some(f=>f.name.endsWith(".xlsx")));assert.match(sheet.text,/957[., ]?000/);
  const deck=await run("04-powerpoint-create","Tạo file PowerPoint PPTX đúng 3 slide tiếng Việt hướng dẫn chuẩn bị hồ sơ xin việc IT Developer: 1 tổng quan, 2 CV và portfolio, 3 checklist phỏng vấn. Có mã QA-DECK-742 ở slide cuối. Bố cục rõ, chữ dễ đọc, không tạo ảnh. Xuất file tải xuống, trả lời ngắn.");
  assert.ok(deck.attachments.some(f=>f.name.endsWith(".pptx")));
}catch(error){report.error=String(error);process.exitCode=1;}
finally{
  const {rows}=await pool.query("SELECT router_reason,model,input_tokens,output_tokens,tool_cost_usd,estimated_cost_usd,tool_details FROM usage_events WHERE user_id=$1 ORDER BY created_at",[user.id]);report.usage=rows;
  await writeFile(resolve(root,"report.json"),JSON.stringify(report,null,2));
  await api("/api/conversations",{method:"DELETE"}).catch(()=>{});
  await pool.query("DELETE FROM users WHERE id=$1",[user.id]);await pool.end();
  console.log("REPORT",root);
}
