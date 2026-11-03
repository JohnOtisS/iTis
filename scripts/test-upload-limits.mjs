// Isolated test database only: temporarily changes global upload settings, then restores.
import nextEnv from "@next/env";nextEnv.loadEnvConfig(process.cwd());
import assert from "node:assert/strict";import {Pool} from "pg";import {randomUUID,createHash} from "node:crypto";
const p=new Pool({connectionString:process.env.DATABASE_URL});const origin=process.env.TEST_ORIGIN||"http://127.0.0.1:15174";
if(!process.env.DATABASE_URL?.endsWith('/itis_upload_qa'))throw new Error("Use the isolated itis_upload_qa database; this test edits global settings.");
const ids=[randomUUID(),randomUUID()],tokens=[randomUUID(),randomUUID()];const original=(await p.query("select value from app_settings where key='upload_limits'")).rows[0];
async function api(i,path,body,method=body?"PATCH":"GET"){return fetch(origin+path,{method,headers:{cookie:`itis_session=${tokens[i]}`,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});}
async function upload(path,sizes){const form=new FormData();form.set("prompt","Analyze files");sizes.forEach((size,i)=>form.append("files",new Blob([new Uint8Array(size)]),`qa-${i}.docx`));return fetch(origin+path,{method:"POST",headers:{cookie:`itis_session=${tokens[1]}`},body:form});}
try{
 for(let i=0;i<2;i++){await p.query("insert into users(id,email,name,password_hash,role,locale,total_token_limit,token_limit) values($1,$2,'Upload settings QA','not-a-login',$3,'vi',0,0)",[ids[i],ids[i]+"@qa.invalid",i?"standard":"admin"]);await p.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[ids[i],createHash('sha256').update(tokens[i]).digest('hex')]);}
 const limits={maxFileMb:1,maxTotalMb:1,maxFiles:2};
 assert.equal((await api(1,"/api/admin/settings",{uploadLimits:limits})).status,403);
 const saved=await api(0,"/api/admin/settings",{uploadLimits:limits});assert.equal(saved.status,200);assert.deepEqual((await saved.json()).settings.uploadLimits,limits);
 assert.deepEqual((await (await api(1,"/api/account")).json()).system.uploadLimits,limits);
 for(const path of ["/api/chat","/api/account/memory/documents"]){
  let r=await upload(path,[1048577]);assert.equal(r.status,413);assert.match((await r.json()).error,/qa-0.docx.*1 MB/);
  r=await upload(path,[600000,600000]);assert.equal(r.status,413);assert.match((await r.json()).error,/Tổng/);
  r=await upload(path,[1,1,1]);assert.equal(r.status,413);assert.match((await r.json()).error,/2 tệp/);
 }
 const boundary=await upload("/api/chat",[1048576]);assert.notEqual(boundary.status,413,"exact size must pass upload validation");assert.equal((await boundary.json()).code,"OPENAI_NOT_CONFIGURED");
 for(const uploadLimits of [{...limits,maxFileMb:51,maxTotalMb:51},{...limits,maxFileMb:2,maxTotalMb:1},{...limits,maxFiles:11},{...limits,maxFileMb:1.5}])assert.equal((await api(0,"/api/admin/settings",{uploadLimits})).status,400);
 assert.deepEqual((await (await api(0,"/api/admin/settings")).json()).settings.uploadLimits,limits);
 assert.equal((await api(1,"/api/account",{name:"Upload settings QA",email:ids[1]+"@qa.invalid",uploadLimits:{maxFileMb:50,maxTotalMb:50,maxFiles:10}})).status,200);
 assert.deepEqual((await (await api(0,"/api/admin/settings")).json()).settings.uploadLimits,limits);
 const higher={maxFileMb:30,maxTotalMb:50,maxFiles:10};assert.equal((await api(0,"/api/admin/settings",{uploadLimits:higher})).status,200);
 assert.deepEqual((await (await api(1,"/api/account")).json()).system.uploadLimits,higher);
 const after=await upload("/api/chat",[2*1048576]);assert.notEqual(after.status,413);assert.equal((await after.json()).code,"OPENAI_NOT_CONFIGURED");
 console.log("PASS admin-only settings, persist/readback, regular account propagation, size/total/count enforcement in Chat and Memory, exact boundary, increasing limits, invalid values and profile bypass rejection; no AI calls");
}finally{
 if(original)await p.query("insert into app_settings(key,value) values('upload_limits',$1::jsonb) on conflict(key) do update set value=excluded.value",[JSON.stringify(original.value)]);else await p.query("delete from app_settings where key='upload_limits'");
 await p.query("delete from users where id=any($1::uuid[])",[ids]);await p.end();
}
