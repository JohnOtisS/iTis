import {randomBytes,createHash} from "node:crypto";
import {eq} from "drizzle-orm";
import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {getDb} from "@/db";
import {appSettings} from "@/db/schema";
import {requireAdmin} from "@/lib/auth";
import {publicUrl} from "@/lib/notifications";
export const runtime="nodejs";
export async function GET(){
 try{await requireAdmin();}catch{return NextResponse.json({error:"Forbidden"},{status:403});}
 const [row]=await getDb().select().from(appSettings).where(eq(appSettings.key,"gmail_oauth"));const v=row?.value as {clientId?:string;clientSecret?:string}|undefined;
 if(!v?.clientId||!v.clientSecret)return NextResponse.json({error:"Configure Google OAuth client first."},{status:409});
 const state=randomBytes(32).toString("base64url"),verifier=randomBytes(48).toString("base64url");
 (await cookies()).set("itis_gmail_connect",JSON.stringify({state,verifier}),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/api/admin/email",maxAge:600});
 const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");url.search=new URLSearchParams({client_id:v.clientId,redirect_uri:publicUrl()+"/api/admin/email/callback",response_type:"code",scope:"openid email https://www.googleapis.com/auth/gmail.send",access_type:"offline",prompt:"consent",state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",login_hint:"otisdevsystem@gmail.com"}).toString();return NextResponse.redirect(url);
}
