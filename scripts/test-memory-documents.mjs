// Isolated disposable accounts, synthetic Office/PDF/text fixtures. No emails sent.
import nextEnv from "@next/env";nextEnv.loadEnvConfig(process.cwd());
import {Pool} from "pg";import {randomUUID,createHash} from "node:crypto";import {zipSync,strToU8} from "fflate";import assert from "node:assert/strict";
const pool=new Pool({connectionString:process.env.DATABASE_URL});const origin=process.env.TEST_ORIGIN||"http://127.0.0.1:15174";
const accounts=[0,1,2].map(()=>({id:randomUUID(),token:randomUUID()}));const cases=[];
const auth=i=>({cookie:`itis_session=${accounts[i].token}`});
async function api(i,path,body,method=body?"POST":"GET"){return fetch(origin+path,{method,headers:{...auth(i),...(!(body instanceof FormData)?{"content-type":"application/json"}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});}
async function upload(i,name,bytes){const form=new FormData();form.append("files",new Blob([bytes]),name);const r=await api(i,"/api/account/memory/documents",form);return {http:r.status,...await r.json()};}
async function docs(i){return (await (await api(i,"/api/account/memory/documents")).json()).documents;}
function pdf(text=""){
 const stream=`BT /F1 12 Tf 60 700 Td (${text}) Tj ET`;
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let data="%PDF-1.4\n",offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=Buffer.byteLength(data);data+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(data);
}
try{
 for(let i=0;i<3;i++){await pool.query("insert into users(id,email,name,password_hash,locale,role) values($1,$2,'Disposable document memory QA','no-login','vi',$3)",[accounts[i].id,accounts[i].id+"@memory-docs.invalid",i===0?"admin":"standard"]);await pool.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[accounts[i].id,createHash("sha256").update(accounts[i].token).digest("hex")]);}
 const text="Internal approval procedure: expense code LOTUS-742, two reviewers required.";
 let r=await upload(1,"procedure.txt",Buffer.from(text));assert.equal(r.results[0].status,"saved",JSON.stringify(r));const first=r.results[0].id;
 const filesBefore=Number((await pool.query("select count(*) n from stored_files where user_id=$1",[accounts[1].id])).rows[0].n);
 r=await upload(1,"renamed.txt",Buffer.from(text));assert.equal(r.results[0].status,"duplicate");
 const word=zipSync({"[Content_Types].xml":strToU8('<Types/>'),"word/document.xml":strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)});
 r=await upload(1,"same-content.docx",word);assert.equal(r.results[0].status,"duplicate",JSON.stringify(r));assert.equal((await docs(1)).length,1);assert.equal(Number((await pool.query("select count(*) n from stored_files where user_id=$1",[accounts[1].id])).rows[0].n),filesBefore);cases.push("binary and cross-format text deduplication without extra storage");
 const excel=zipSync({"[Content_Types].xml":strToU8('<Types/>'),"xl/workbook.xml":strToU8('<workbook/>'),"xl/worksheets/sheet1.xml":strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue ORCHID-882</t></is></c><c r="B1"><v>742</v></c></row></sheetData></worksheet>')});
 r=await upload(1,"revenue.xlsx",excel);assert.equal(r.results[0].status,"saved",JSON.stringify(r));
 r=await upload(1,"operations.pdf",pdf("Maintenance reference CEDAR-119. Inspect equipment every Friday."));assert.equal(r.results[0].status,"saved",JSON.stringify(r));
 r=await upload(1,"blank-scan.pdf",pdf());assert.equal(r.http,422);assert.equal(r.results[0].status,"failed");assert.equal((await docs(1)).length,3);cases.push("DOCX/XLSX/PDF extraction and honest rejection of PDFs without text");
 assert.equal((await docs(2)).length,0);const firstDoc=(await docs(1)).find(d=>d.id===first);assert.equal((await fetch(origin+firstDoc.url)).status,401);assert.equal((await api(2,firstDoc.url)).status,404);assert.equal((await api(2,`/api/account/memory/documents/${first}`,undefined,"DELETE")).status,404);cases.push("account isolation and protected original downloads");
 const form=new FormData();form.append("prompt","ghi nhớ file này");form.append("files",new Blob(["Payroll procedure: reference PINE-202; approval requires two signatures."]),"payroll-procedure.txt");
 let response=await api(1,"/api/chat",form);let data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.model,"iTis Memory");assert.equal(data.usage.total_tokens,0);assert.match(data.text,/Đã ghi nhớ/);const conversation=data.conversationId;
 response=await api(1,"/api/chat",{conversationId:conversation,prompt:"ghi nhớ file vừa gửi"});data=await response.json();assert.match(data.text,/Không lưu trùng/);cases.push("chat file memory, follow-up reference and duplicate notice with zero model tokens");
 response=await api(1,"/api/chat",{prompt:"Mã tham chiếu của quy trình Payroll và số chữ ký phê duyệt là gì? Chỉ nêu dữ liệu đã nhớ."});data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.match(data.text,/PINE-202/);assert.match(data.text,/two|2|hai/i);cases.push("relevant document recall across chat sessions");
 const retained=(await docs(1)).find(d=>d.name==="payroll-procedure.txt");assert.equal((await api(1,`/api/conversations/${conversation}`,undefined,"DELETE")).status,200);assert.equal((await api(1,retained.url)).status,200);
 assert.equal((await api(1,`/api/account/memory/documents/${retained.id}`,undefined,"DELETE")).status,200);assert.equal((await api(1,retained.url)).status,404);cases.push("remembered files survive chat deletion and are removed after forgetting");
 await pool.query("update users set storage_limit_bytes=0 where id=$1",[accounts[2].id]);r=await upload(2,"quota.txt",Buffer.from("New quota test unique ZINNIA-883."));assert.equal(r.http,422);assert.equal((await docs(2)).length,0);assert.equal(Number((await pool.query("select count(*) n from stored_files where user_id=$1",[accounts[2].id])).rows[0].n),0);cases.push("storage quota and failed-upload cleanup");
 await pool.query("update users set memory_enabled=false where id=$1",[accounts[1].id]);assert.equal((await upload(1,"disabled.txt",Buffer.from("Disabled update"))).http,403);assert.equal((await api(1,"/api/chat",{prompt:"ghi nhớ file này"})).status,403);cases.push("administrator memory disable enforced");
 console.log(JSON.stringify({passed:true,cases},null,2));
}finally{
 for(const u of accounts.slice(1))await api(0,`/api/admin/users/${u.id}`,undefined,"DELETE").catch(()=>{});
 await pool.query("delete from users where id=any($1::uuid[])",[accounts.map(a=>a.id)]);await pool.end();
}
