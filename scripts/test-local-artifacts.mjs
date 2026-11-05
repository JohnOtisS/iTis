// No paid model calls. Start the test app with OPENAI_API_KEY='' to verify bypass.
import nextEnv from "@next/env";nextEnv.loadEnvConfig(process.cwd());
import {Pool} from "pg";
import {randomUUID,createHash} from "node:crypto";
import {mkdir,writeFile,unlink} from "node:fs/promises";
import {resolve,basename,join} from "node:path";
import {unzipSync,strFromU8,strToU8,zipSync} from "fflate";
import assert from "node:assert/strict";
const p=new Pool({connectionString:process.env.DATABASE_URL});
const origin=process.env.TEST_ORIGIN||"http://127.0.0.1:15174";
const ids=[randomUUID(),randomUUID()],tokens=[randomUUID(),randomUUID()],chat=randomUUID();
const source=randomUUID(),letter=randomUUID();const report=[];
async function api(i,path,body,method=body?"POST":"GET"){
  return fetch(origin+path,{method,headers:{"content-type":"application/json",cookie:`itis_session=${tokens[i]}`},...(body?{body:JSON.stringify(body)}:{})});
}
async function checked(path,body){const start=performance.now();const r=await api(0,path,body);const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.equal(d.usage.total_tokens,0);assert.equal(d.usage.calls,0);report.push({path,milliseconds:Math.round(performance.now()-start),tokens:d.usage.total_tokens,files:d.attachments.length,pipeline:d.pipeline});return d;}
try{
  for(let i=0;i<2;i++){
    await p.query("insert into users(id,email,name,password_hash,locale,total_token_limit,token_limit) values($1,$2,'Disposable artifact QA','not-a-login','vi',0,0)",[ids[i],ids[i]+"@qa.invalid"]);
    await p.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[ids[i],createHash('sha256').update(tokens[i]).digest('hex')]);
  }
  await p.query("insert into conversations(id,user_id,title) values($1,$2,'Disposable artifact QA')",[chat,ids[0]]);
  const plan="# KẾ HOẠCH QA-742\n\nNội dung đã chốt, giữ đúng số liệu và ngày tháng, không dùng nội dung của công văn.\n\n| Hạng mục | Số lượng |\n|---|---|\n| Alpha | 4 |\n| Beta | 9 |\n\nTổng ngân sách: 1.234.567 đồng.\n\nNgày thực hiện: 03/11/2026.";
  await p.query("insert into messages(id,conversation_id,role,content,model,token_count,created_at) values($1,$2,'assistant',$3,'gpt-6.1-sol',77,now()-interval '2 minutes')",[source,chat,plan]);
  await p.query("insert into messages(id,conversation_id,role,content,created_at) values($1,$2,'assistant',$3,now()-interval '1 minute')",[letter,chat,"# CÔNG VĂN QA-LETTER\n\n"+"Nội dung công văn khác với kế hoạch và không được chọn khi người dùng yêu cầu xuất kế hoạch. ".repeat(3)]);
  const first=await checked(`/api/conversations/${chat}/export`,{sourceMessageId:source,format:"docx"});
  assert.equal(first.text,"");assert.equal(first.attachments.length,1);
  const file=first.attachments[0];const download=await api(0,file.url);assert.equal(download.status,200);
  const bytes=new Uint8Array(await download.arrayBuffer());const xml=strFromU8(unzipSync(bytes)["word/document.xml"]);
  for(const token of ["KẾ HOẠCH QA-742","1.234.567","03/11/2026","Alpha","Beta"])assert.ok(xml.includes(token));
  assert.ok(!xml.includes("QA-LETTER"));
  await mkdir("artifacts/deployment",{recursive:true});await writeFile("artifacts/deployment/local-export-proof.docx",bytes);
  const repeated=await checked(`/api/conversations/${chat}/export`,{sourceMessageId:source,format:"docx"});assert.equal(repeated.attachments[0].url,file.url);
  const named=await checked("/api/chat",{conversationId:chat,prompt:"Xuất cái Kế hoạch phía trên ra bản Word"});assert.equal(named.attachments[0].url,file.url);
  const resent=await checked("/api/chat",{conversationId:chat,prompt:`Gửi lại file ${file.name}`});assert.equal(resent.attachments[0].url,file.url);
  for(const prompt of ["xuất bản W","xuất wodr","xuất wrod"]){const alias=await checked("/api/chat",{conversationId:chat,prompt});assert.equal(alias.attachments.length,1);assert.match(alias.attachments[0].name,/\.docx$/i);}
  const sheet=await checked(`/api/conversations/${chat}/export`,{sourceMessageId:letter,format:"docx"});assert.notEqual(sheet.attachments[0].url,file.url);
  const ambiguous=await checked("/api/chat",{conversationId:chat,prompt:"Gửi lại file Word"});assert.equal(ambiguous.attachments.length,0);assert.match(ambiguous.text,/tệp nào/);
  const markdown=await checked(`/api/conversations/${chat}/export`,{sourceMessageId:source,format:"md"});assert.equal(await (await api(0,markdown.attachments[0].url)).text(),plan);
  assert.equal((await api(1,`/api/conversations/${chat}/export`,{sourceMessageId:source})).status,404);
  assert.equal((await api(1,file.url)).status,404);
  assert.equal((await api(0,`/api/conversations/${chat}/export`,{sourceMessageId:randomUUID()})).status,404);
  assert.equal((await api(0,`/api/conversations/${chat}/export`,{sourceMessageId:source,format:"exe"})).status,400);
  const reloaded=await (await api(0,`/api/conversations/${chat}`)).json();
  const local=reloaded.messages.filter(m=>m.model==="iTis Files");assert.equal(local.length,10);assert.ok(local.every(m=>m.taskUsage.total_tokens===0));
  const usage=await p.query("select count(*)::int as count from usage_events where user_id=any($1::uuid[])",[ids]);assert.equal(usage.rows[0].count,0);
  const storage=await p.query("select count(*)::int as count from stored_files where user_id=$1",[ids[0]]);assert.equal(storage.rows[0].count,3,"repeated export must reuse storage");
  const long=randomUUID();await p.query("insert into messages(id,conversation_id,role,content) values($1,$2,'assistant',$3)",[long,chat,"x".repeat(6500)]);
  assert.equal((await api(0,`/api/conversations/${chat}/export`,{sourceMessageId:long})).status,422);
  const parts=unzipSync(bytes);parts["word/document.xml"]=strToU8(strFromU8(parts["word/document.xml"]).replace("1.234.567","9.876.543"));
  const changed=zipSync(parts);const newUrl=`/api/files/${randomUUID()}.docx`;
  const dir=resolve(process.env.GENERATED_FILES_DIR||join(process.cwd(),"storage/files"));
  await writeFile(join(dir,basename(newUrl)),changed);
  await p.query("insert into stored_files(url,user_id,bytes) values($1,$2,$3)",[newUrl,ids[0],changed.byteLength]);
  const base={...file};delete base.sourceMessageId;delete base.sourceContentHash;
  const v2={...base,url:newUrl,version:2};
  await p.query("insert into messages(conversation_id,role,content,attachments) values($1,'assistant','',$2::jsonb)",[chat,JSON.stringify([v2])]);
  const newest=await checked("/api/chat",{conversationId:chat,prompt:"Xuất lại Kế hoạch ra Word"});assert.equal(newest.attachments[0].url,newUrl,"natural export must preserve the latest edited version");
  const frozen=await checked(`/api/conversations/${chat}/export`,{sourceMessageId:source,format:"docx"});assert.equal(frozen.attachments[0].url,file.url,"exact source button must preserve the original snapshot");
  const branchSource=reloaded.messages.filter(m=>m.role==="user").at(-1);
  const branchResponse=await api(0,`/api/conversations/${chat}/branch`,{messageId:branchSource.id});assert.equal(branchResponse.status,201);
  const branch=(await branchResponse.json()).conversation;
  const branched=await (await api(0,`/api/conversations/${branch.id}`)).json();
  assert.ok(branched.messages.some(m=>m.model==="iTis Files"&&m.attachments.length&&m.taskUsage?.total_tokens===0),"branch must retain authoritative usage metadata");
  console.log("PASS zero AI calls even with exhausted token quota; exact source over latest file, repeat reuse, named source, resend, ambiguity, markdown, tenant isolation, invalid source/format, reload usage, oversized export rejection");
  console.log(JSON.stringify(report,null,2));
  await writeFile("artifacts/deployment/local-artifact-results.json",JSON.stringify(report,null,2));
}finally{
  const files=(await p.query("select url from stored_files where user_id=any($1::uuid[])",[ids])).rows;
  await p.query("delete from users where id=any($1::uuid[])",[ids]);
  const dir=resolve(process.env.GENERATED_FILES_DIR||join(process.cwd(),"storage/files"));
  for(const {url}of files)await unlink(join(dir,basename(url))).catch(()=>{});
  await p.end();
}
