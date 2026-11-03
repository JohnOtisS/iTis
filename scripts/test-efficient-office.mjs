// Paid OpenAI smoke tests, isolated synthetic data; all generated files are checked.
import nextEnv from "@next/env";nextEnv.loadEnvConfig(process.cwd());
import {Pool} from "pg";import {randomUUID,createHash} from "node:crypto";
import {mkdir,writeFile,unlink} from "node:fs/promises";import {resolve,join,basename} from "node:path";
import {unzipSync,strFromU8} from "fflate";import assert from "node:assert/strict";
const p=new Pool({connectionString:process.env.DATABASE_URL});const id=randomUUID(),token=randomUUID();
const origin=process.env.TEST_ORIGIN||"http://127.0.0.1:15174";const report=[];
async function api(path,options={}){return fetch(origin+path,{...options,headers:{cookie:`itis_session=${token}`,...options.headers},signal:AbortSignal.timeout(240000)});}
async function run(name,prompt,files=[],conversationId){
 const f=new FormData();f.set("prompt",prompt);if(conversationId)f.set("conversationId",conversationId);
 for(const file of files)f.append("files",new Blob([file.bytes]),file.name);
 const start=performance.now();const r=await api("/api/chat",{method:"POST",body:f});const d=await r.json();
 assert.equal(r.status,200,JSON.stringify(d));assert.ok(d.messageId,"durable message ID must be returned");
 const outputs=[];
 for(const file of d.attachments??[]){const download=await api(file.url);assert.equal(download.status,200);const bytes=new Uint8Array(await download.arrayBuffer());outputs.push({file,bytes,zip:unzipSync(bytes)});await writeFile(`artifacts/deployment/efficient-${name}-${basename(file.name)}`,bytes);}
 const stored=await (await api(`/api/conversations/${d.conversationId}`)).json();
 const answer=stored.messages.find(m=>m.id===d.messageId);assert.equal(answer.taskUsage.total_tokens,d.usage.total_tokens);assert.equal(answer.taskUsage.output_tokens,d.usage.output_tokens);assert.ok(d.usage.reasoning_tokens<=d.usage.output_tokens);
 report.push({name,seconds:Number(((performance.now()-start)/1000).toFixed(2)),model:d.model,pipeline:d.pipeline,usage:d.usage,files:outputs.map(o=>o.file.name)});
 console.log(JSON.stringify(report.at(-1)));
 return {d,outputs};
}
try{
 await mkdir("artifacts/deployment",{recursive:true});
 await p.query("insert into users(id,email,name,password_hash,locale,unlimited,total_unlimited) values($1,$2,'Disposable Office efficiency QA','not-a-login','vi',true,true)",[id,id+"@qa.invalid"]);
 await p.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[id,createHash("sha256").update(token).digest("hex")]);
 const word=await run("word","Tạo một file Word DOCX checklist bàn giao IT gồm đúng 4 mục kiểm tra. Giữ mã QA-WORD-742, để thông tin chưa biết trong [ngoặc]. Chỉ tạo file, không giải thích.");
 assert.equal(word.d.pipeline,"fast_word_create");assert.equal(word.d.usage.tool_cost_usd,0);assert.ok(strFromU8(word.outputs[0].zip['word/document.xml']).includes('QA-WORD-742'));
 const edit=await run("edit","Sửa file Word: thay chính xác QA-WORD-742 thành QA-WORD-943 ở 1 vị trí, giữ nguyên nội dung còn lại. Xuất file Word.",[{name:"checklist.docx",bytes:word.outputs[0].bytes}]);
 assert.equal(edit.d.pipeline,"fast_word_edit");const edited=strFromU8(edit.outputs[0].zip['word/document.xml']);assert.ok(edited.includes('QA-WORD-943'));assert.ok(!edited.includes('QA-WORD-742'));
 const excel=await run("excel","CSV nguồn có Alpha Qty=2 UnitPrice=50 và Beta Qty=3 UnitPrice=25. Đọc file đính kèm, đổi Qty của Alpha thành 4; tạo Excel XLSX có cột Amount với công thức Qty*UnitPrice và tổng có công thức SUM. Giữ đúng dữ liệu Beta. Tính cache công thức để mở bằng data_only vẫn thấy tổng 275. Kiểm tra độc lập. Trả file, chỉ báo nếu có lỗi.",[{name:"orders.csv",bytes:new TextEncoder().encode("Item,Qty,UnitPrice\nAlpha,2,50\nBeta,3,25\n")}]);
 assert.ok(excel.outputs.some(o=>o.file.name.endsWith('.xlsx')));
 const sheet=excel.outputs.find(o=>o.file.name.endsWith('.xlsx'));const sheetXml=Object.entries(sheet.zip).filter(([n])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).map(([,b])=>strFromU8(b)).join('');assert.match(sheetXml,/<v>275(?:\.0)?<\/v>/);assert.match(sheetXml,/<f[ >]/);
 const slides=await run("slides","Tạo PowerPoint PPTX đúng 3 slide tiếng Việt checklist onboarding nhân viên IT: tài khoản, thiết bị, an toàn dữ liệu. Đặt mã QA-DECK-742 trên slide cuối. Không tạo ảnh. Chỉ trả file tải xuống, không viết lại nội dung trên chat.");
 const deck=slides.outputs.find(o=>o.file.name.endsWith('.pptx'));assert.ok(deck);const slideParts=Object.entries(deck.zip).filter(([n])=>/^ppt\/slides\/slide\d+\.xml$/.test(n));assert.equal(slideParts.length,3);assert.ok(slideParts.some(([,b])=>strFromU8(b).includes('QA-DECK-742')));
 console.log("PASS paid Word create/edit, Excel verified total/formula caches, 3-slide PPTX, authoritative usage survives reload");
}catch(error){console.error(String(error));process.exitCode=1;}
finally{
 const files=(await p.query("select url from stored_files where user_id=$1",[id])).rows;
 await writeFile("artifacts/deployment/efficient-office-results.json",JSON.stringify(report,null,2));
 await p.query("delete from users where id=$1",[id]);
 const dir=resolve(process.env.GENERATED_FILES_DIR||join(process.cwd(),"storage/files"));
 for(const {url}of files)await unlink(join(dir,basename(url))).catch(()=>{});await p.end();
}
