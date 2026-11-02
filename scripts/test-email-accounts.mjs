// Isolated synthetic accounts only. No messages are sent to real recipients.
import nextEnv from "@next/env";nextEnv.loadEnvConfig(process.cwd());
import {Pool} from "pg";import {randomUUID,createHash,randomBytes} from "node:crypto";import bcrypt from "bcryptjs";import assert from "node:assert/strict";
const pool=new Pool({connectionString:process.env.DATABASE_URL});const origin=process.env.TEST_ORIGIN||"http://127.0.0.1:15174";
const ids=[randomUUID(),randomUUID()];const tokens=[randomUUID(),randomUUID()];const password=randomBytes(16).toString("hex"),next=randomBytes(16).toString("hex");let campaign;
const hash=v=>createHash("sha256").update(v).digest("hex");
async function api(i,path,body,method=body?"POST":"GET"){return fetch(origin+path,{method,headers:{"content-type":"application/json",...(i===null?{}:{cookie:`itis_session=${tokens[i]}`})},...(body?{body:JSON.stringify(body)}:{})});}
try{
 for(let i=0;i<2;i++){await pool.query("insert into users(id,email,name,password_hash,role) values($1,$2,'Disposable email QA',$3,$4)",[ids[i],ids[i]+"@qa.invalid",await bcrypt.hash(password,12),i===0?"admin":"standard"]);await pool.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[ids[i],hash(tokens[i])]);}
 assert.equal((await api(1,"/api/admin/notifications")).status,403);
 let r=await api(0,"/api/admin/notifications",{action:"send",subject:"Synthetic notification QA",body:"Line one\nLine two",audience:"selected",userIds:[ids[1]],email:false});assert.equal(r.status,202);campaign=(await r.json()).id;
 let d=await (await api(1,"/api/account/notifications")).json();assert.equal(d.items.length,1);assert.equal(d.items[0].body,"Line one\nLine two");assert.equal((await (await api(0,"/api/account/notifications")).json()).items.length,0);
 assert.equal((await api(1,"/api/account/notifications",{},"PATCH")).status,200);d=await (await api(1,"/api/account/notifications")).json();assert.ok(d.items[0].readAt);console.log("PASS notification ownership, formatting and read state");
 assert.equal((await api(1,"/api/account/password",{currentPassword:"wrong",newPassword:next})).status,400);
 assert.equal((await api(1,"/api/account/password",{currentPassword:password,newPassword:next})).status,200);
 assert.equal((await api(1,"/api/account/notifications")).status,401);console.log("PASS password change and old session revocation");
 const reset=randomBytes(32).toString("base64url");await pool.query("insert into password_resets(user_id,token_hash,expires_at) values($1,$2,now()+interval '30 minutes')",[ids[1],hash(reset)]);
 const [a,b]=await Promise.all([api(null,"/api/auth/reset-password",{token:reset,password}),api(null,"/api/auth/reset-password",{token:reset,password})]);assert.deepEqual([a.status,b.status].sort(),[200,400]);assert.equal((await api(null,"/api/auth/reset-password",{token:reset,password:next})).status,400);
 const expired=randomBytes(32).toString("base64url");await pool.query("insert into password_resets(user_id,token_hash,expires_at) values($1,$2,now()-interval '1 minute')",[ids[1],hash(expired)]);assert.equal((await api(null,"/api/auth/reset-password",{token:expired,password:next})).status,400);console.log("PASS reset expiry, one-time use and concurrent replay rejection");
 assert.ok((await pool.query("select last_seen_at from users where id=$1",[ids[1]])).rows[0].last_seen_at);console.log("PASS last activity persisted");
 const unknown=await api(null,"/api/auth/forgot-password",{email:randomUUID()+"@qa.invalid"});assert.equal(unknown.status,200);assert.match((await unknown.json()).message,/If an active account/);console.log("PASS generic reset response");
}finally{if(campaign)await pool.query("delete from notification_campaigns where id=$1",[campaign]);await pool.query("delete from users where id=any($1::uuid[])",[ids]);await pool.end();}
