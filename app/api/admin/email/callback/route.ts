import {eq} from "drizzle-orm";
import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {getDb} from "@/db";
import {appSettings} from "@/db/schema";
import {requireAdmin} from "@/lib/auth";
import {decryptMemory,encryptMemory} from "@/lib/memory";
import {emailSettings,publicUrl} from "@/lib/notifications";
export const runtime="nodejs";
export async function GET(request:Request){
 try{await requireAdmin();}catch{return NextResponse.json({error:"Forbidden"},{status:403});}
 const url=new URL(request.url),jar=await cookies();let state:{state?:string;verifier?:string}={};try{state=JSON.parse(jar.get("itis_gmail_connect")?.value??"{}");}catch{}
 jar.delete("itis_gmail_connect");
 if(!state.state||state.state!==url.searchParams.get("state")||!state.verifier||!url.searchParams.get("code"))return NextResponse.redirect(publicUrl()+"/admin?email=cancelled");
 try{
 const [row]=await getDb().select().from(appSettings).where(eq(appSettings.key,"gmail_oauth"));const config=row.value as {clientId:string;clientSecret:string};
 const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:decryptMemory(config.clientSecret),code:url.searchParams.get("code")!,code_verifier:state.verifier,grant_type:"authorization_code",redirect_uri:publicUrl()+"/api/admin/email/callback"}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error("Token exchange failed");const token=await response.json() as {access_token:string;refresh_token?:string;scope?:string};
 if(!token.refresh_token||!token.scope?.includes("https://www.googleapis.com/auth/gmail.send"))throw new Error("Missing send permission");
 const info=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});if(!info.ok)throw new Error("Identity check failed");const identity=await info.json() as {email?:string;email_verified?:boolean};if(!identity.email||!identity.email_verified)throw new Error("Verified sender required");
 await getDb().update(appSettings).set({value:{...config,refreshToken:encryptMemory(token.refresh_token)},updatedAt:new Date()}).where(eq(appSettings.key,"gmail_oauth"));
 const settings={...await emailSettings(),sender:identity.email,enabled:true};await getDb().insert(appSettings).values({key:"email_notifications",value:settings}).onConflictDoUpdate({target:appSettings.key,set:{value:settings,updatedAt:new Date()}});
 return NextResponse.redirect(publicUrl()+"/admin?email=connected");
 }catch{return NextResponse.redirect(publicUrl()+"/admin?email=failed");}
}
