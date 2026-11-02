// Durable outbox: one recipient per call; never print message bodies or credentials.
import {Pool} from "pg";
import {createHash,createDecipheriv} from "node:crypto";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const key=()=>createHash("sha256").update(process.env.MEMORY_ENCRYPTION_KEY||process.env.SESSION_SECRET||"").digest();
function decrypt(value){const [v,iv,tag,data]=value.split(".");if(v!=="v1")throw new Error("Invalid encrypted payload");const cipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));cipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([cipher.update(Buffer.from(data,"base64url")),cipher.final()]).toString("utf8");}
const header=value=>String(value).replace(/[\r\n]/g," ");
const encoded=value=>`=?UTF-8?B?${Buffer.from(header(value)).toString("base64")}?=`;
async function work(){
 const settings=Object.fromEntries((await pool.query("select key,value from app_settings where key in ('gmail_oauth','email_notifications')")).rows.map(x=>[x.key,x.value]));
 const config=settings.gmail_oauth,mail=settings.email_notifications;
 if(!mail?.enabled||!mail.sender||!config?.refreshToken)return;
 // A crash after Gmail accepted a send has an uncertain result. Never auto-send duplicates.
 await pool.query("update notification_deliveries set status='unknown',encrypted_payload=null,error='Delivery interrupted; verify Sent mail before resending.',locked_at=null where status='sending' and locked_at<now()-interval '5 minutes'");
 await pool.query("delete from password_resets where expires_at<now()-interval '1 day'");
 let accessToken;
 for(let i=0;i<20;i++){
 const {rows:[job]}=await pool.query(`with candidate as (select d.id from notification_deliveries d join users u on u.id=d.user_id where d.status='queued' and d.next_attempt_at<=now() and u.is_active order by d.created_at for update of d skip locked limit 1) update notification_deliveries d set status='sending',locked_at=now(),attempts=attempts+1 from candidate c where d.id=c.id returning d.*`);
 if(!job)break;
 const {rows:[campaign]}=await pool.query("select * from notification_campaigns where id=$1",[job.campaign_id]);
 const sensitive=campaign.kind==='welcome'||campaign.kind==='password_reset';
 let sending=false;
 try{
 if(!accessToken){
 const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:decrypt(config.clientSecret),refresh_token:decrypt(config.refreshToken),grant_type:"refresh_token"}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error("Google authorization failed. Reconnect Gmail.");accessToken=(await response.json()).access_token;
 }
 if(sensitive&&Date.now()-new Date(job.created_at).getTime()>30*60000)throw new Error("Private email expired; issue a new invitation/reset.");
 const text=decrypt(job.encrypted_payload);
 const raw=[`From: ${encoded(mail.senderName||"iTis")} <${header(mail.sender)}>`,`To: ${header(job.recipient)}`,`Subject: ${encoded(campaign.subject)}`,`Message-ID: <${job.id}@itis.dansoft.vn>`,"MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",Buffer.from(text).toString("base64").match(/.{1,76}/g).join("\r\n")].join("\r\n");
 sending=true;
 const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({raw:Buffer.from(raw).toString("base64url")}),signal:AbortSignal.timeout(20000)});
 if(!response.ok){sending=false;throw new Error(`Gmail rejected message (HTTP ${response.status}).`);}
 const result=await response.json();await pool.query("update notification_deliveries set status='sent',sent_at=now(),provider_id=$2,encrypted_payload=null,error=null,locked_at=null where id=$1",[job.id,result.id]);
 console.log("Email accepted",job.id);
 }catch(error){
 const retry=!sending&&!sensitive&&job.attempts<3;
 await pool.query("update notification_deliveries set status=$2,error=$3,locked_at=null,next_attempt_at=now()+interval '2 minutes',encrypted_payload=case when $4 then null else encrypted_payload end where id=$1",[job.id,sending?'unknown':retry?'queued':'failed',sending?'Send result uncertain. Verify Sent mail before resending.':String(error.message).slice(0,200),sensitive||sending]);
 console.log("Email status",job.id,sending?'unknown':retry?'queued':'failed');
 }
 }
}
const client=await pool.connect();try{const {rows:[lock]}=await client.query("select pg_try_advisory_lock(72416209) locked");if(lock.locked)try{await work();}finally{await client.query("select pg_advisory_unlock(72416209)");}}finally{client.release();await pool.end();}
