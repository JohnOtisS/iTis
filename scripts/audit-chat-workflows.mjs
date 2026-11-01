import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";

// Real provider calls, synthetic data only. Run explicitly, never in CI.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const base = "http://127.0.0.1:5173";
const output = resolve("artifacts", `chat-audit-${new Date().toISOString().replace(/[:.]/g,"-")}`);
await mkdir(output, { recursive: true });
const accounts = [0, 1].map(() => ({ id: randomUUID(), token: randomUUID() }));
const report = { startedAt: new Date().toISOString(), cases: [], usage: [] };
async function api(account, path, options={}) {
  return fetch(`${base}${path}`, { ...options, headers: { cookie: `itis_session=${account.token}`, ...options.headers }, signal: AbortSignal.timeout(240000) });
}
async function chat(name, account, prompt, conversationId, files, stream=false) {
  const started = Date.now();
  let options;
  if (files) {
    const form = new FormData(); form.set("prompt", prompt);
    if (conversationId) form.set("conversationId", conversationId);
    for (const file of files) form.append("files", new Blob([file.data], { type: file.type }), file.name);
    options = { method:"POST", body:form };
  } else options = { method:"POST", headers:{"content-type":"application/json", ...(stream ? { accept:"application/x-ndjson" } : {})}, body:JSON.stringify({prompt,conversationId}) };
  const response = await api(account,"/api/chat",options);
  const raw = await response.text();
  let data;
  if (stream && response.ok && response.headers.get("content-type")?.includes("ndjson")) {
    const events = raw.trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));
    data = { ...events.findLast(event=>event.type==="done"), events:events.map(({type})=>type), streamError:events.find(event=>event.type==="error") };
  } else { try { data=JSON.parse(raw); } catch { data={error:raw.slice(0,500)}; } }
  const result={name,status:response.status,elapsedMs:Date.now()-started,...data};
  report.cases.push(result);
  console.log(JSON.stringify({name,status:result.status,model:result.model,seconds:Math.round(result.elapsedMs/1000),text:result.text?.slice(0,260),error:result.error,files:result.attachments?.map(f=>f.name)}));
  return result;
}
try {
  for (const account of accounts) {
    await pool.query(`INSERT INTO users(id,email,name,password_hash,role,locale,privacy_mode,allow_openai_files,memory_enabled,auto_memory,token_limit,total_token_limit)
      VALUES($1,$2,'Synthetic QA','no-real-login','standard','vi','strict',false,true,true,250000,3000000)`, [account.id,`${account.id}@qa.invalid`]);
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[account.id,createHash("sha256").update(account.token).digest("hex")]);
  }
  const [a,b]=accounts;
  await chat("01-stream-basic",a,"Một hộp có 12 món, bán 5 món rồi nhập thêm 8 món. Còn bao nhiêu? Chỉ trả số.",null,null,true);
  const first=await chat("01b-json-basic",a,"Một hộp có 12 món, bán 5 món rồi nhập thêm 8 món. Còn bao nhiêu? Chỉ trả số.");
  if (!first.text || first.status!==200) throw new Error("Basic provider request failed; stop paid tests.");
  await chat("02-follow-up",a,"Nếu chia đều số còn lại vào 3 hộp thì mỗi hộp bao nhiêu món? Chỉ trả số.",first.conversationId);
  await chat("03-auto-memory",a,"Hãy nhớ: quy trình HanhTinh của tôi có mã xác nhận SEN-XANH-742. Khi tôi hỏi mã quy trình HanhTinh hãy trả đúng mã này. Trả lời đã nhớ ngắn gọn.");
  await chat("04-memory-across-chats",a,"Mã xác nhận quy trình HanhTinh của tôi là gì? Chỉ trả mã nếu biết, không biết thì nói không biết.");
  await chat("05-other-account-isolation",b,"Mã xác nhận quy trình HanhTinh của tôi là gì? Chỉ trả mã nếu biết, không biết thì nói không biết.");
  const csv={name:"synthetic-orders.csv",type:"text/csv",data:"Item,Quantity,UnitPrice\nAlpha,2,120000\nBeta,3,80000\nGamma,1,150000\n"};
  const analyze=await chat("06-csv-analysis",a,"Phân tích dữ liệu trong file đính kèm: tính thành tiền từng dòng, tổng tiền, VAT giả định 10% và tổng sau VAT. Chỉ trả bảng và tổng, nêu rõ dòng dữ liệu. Đây là dữ liệu giả để test.",null,[csv]);
  const docs=await chat("07-generate-four-formats",a,"Từ file CSV tôi vừa gửi, tạo và đính kèm đủ 4 file tải xuống: bao-cao.xlsx có công thức thành tiền/tổng/VAT 10%; bao-cao.docx báo cáo tiếng Việt ngắn; bao-cao.pdf cùng nội dung; bao-cao.pptx gồm đúng 2 slide tóm tắt. Giữ nguyên dữ liệu 3 dòng, tổng trước VAT 630000, VAT 63000, tổng 693000. Kiểm tra số liệu và đủ 4 file, không tạo ảnh. Trả lời rất ngắn kèm đủ 4 link.",analyze.conversationId);
  for (const file of docs.attachments ?? []) {
    const response=await api(a,file.url);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(response.ok) await writeFile(resolve(output,basename(file.name)),bytes);
    report.cases.push({name:`download:${file.name}`,status:response.status,bytes:bytes.length,signature:Buffer.from(bytes.slice(0,8)).toString("hex")});
    const denied=await api(b,file.url);
    report.cases.push({name:`cross-account-download:${file.name}`,status:denied.status});
  }
  const edited=await chat("08-edit-previous-files",a,"Sửa file Excel vừa tạo: đổi số lượng Alpha từ 2 thành 4, giữ nguyên đơn giá, cập nhật các công thức và xuất lại một file XLSX mới để tải xuống. Không yêu cầu upload lại. Trả lời ngắn, nêu tổng sau VAT.",analyze.conversationId);
  for(const file of edited.attachments ?? []) {
    const response=await api(a,file.url);
    if(response.ok) await writeFile(resolve(output,basename(file.name)),new Uint8Array(await response.arrayBuffer()));
  }
  const {rows:[long]}=await pool.query("INSERT INTO conversations(user_id,title) VALUES($1,'Synthetic long-context test') RETURNING id",[a.id]);
  await pool.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'user','Mã phiên này là MAY-TIM-928. Chỉ giữ trong phiên, không ghi bộ nhớ cá nhân.')",[long.id]);
  for(let i=0;i<34;i++) await pool.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,$2,$3)",[long.id,i%2?"assistant":"user",`Trao đổi bổ sung ${i+1}: hoàn tất mục ví dụ.`]);
  await chat("09-recall-before-last-30-messages",a,"Mã phiên được cung cấp trong tin nhắn đầu của cuộc trò chuyện này là gì? Không biết thì nói không biết.",long.id);
  const memories=await api(a,"/api/account/memory");
  report.memories=await memories.json();
} catch(error) { report.failure=String(error); console.log("AUDIT STOP:",report.failure); }
finally {
  const {rows}=await pool.query("SELECT model,sum(input_tokens)::bigint AS input,sum(output_tokens)::bigint AS output,sum(cached_tokens)::bigint AS cached,sum(estimated_cost_usd-tool_cost_usd) AS modelCostUsd,sum(tool_cost_usd) AS toolCostUsd,sum(estimated_cost_usd) AS totalCostUsd,count(*) AS requests FROM usage_events WHERE user_id=ANY($1::uuid[]) GROUP BY model",[accounts.map(a=>a.id)]);
  report.usage=rows;
  report.finishedAt=new Date().toISOString();
  // Only synthetic accounts created above are removed, including their files.
  for(const account of accounts) await api(account,"/api/conversations",{method:"DELETE"}).catch(()=>{});
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[accounts.map(a=>a.id)]);
  await pool.end();
  await writeFile(resolve(output,"report.json"),JSON.stringify(report,null,2));
  console.log("REPORT",output);
  console.log("USAGE",JSON.stringify(rows));
}
