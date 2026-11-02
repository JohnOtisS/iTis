import {and,desc,eq,inArray,sql} from "drizzle-orm";
import {NextResponse} from "next/server";
import {z} from "zod";
import {getDb} from "@/db";
import {appSettings,users,notificationCampaigns,notificationDeliveries} from "@/db/schema";
import {requireAdmin} from "@/lib/auth";
import {encryptMemory} from "@/lib/memory";
import {emailSettings,enqueueNotification,publicUrl,requestPasswordReset} from "@/lib/notifications";
import {authRateLimit} from "@/lib/auth-security";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 try{await requireAdmin();}catch{return NextResponse.json({error:"Forbidden"},{status:403});}
 const settings=await emailSettings();
 const [oauth]=await getDb().select().from(appSettings).where(eq(appSettings.key,"gmail_oauth"));
 const config=(oauth?.value??{}) as {refreshToken?:string;clientId?:string};
 const history=await getDb().select({id:notificationDeliveries.id,campaignId:notificationDeliveries.campaignId,userId:notificationDeliveries.userId,recipient:notificationDeliveries.recipient,status:notificationDeliveries.status,attempts:notificationDeliveries.attempts,error:notificationDeliveries.error,sentAt:notificationDeliveries.sentAt,readAt:notificationDeliveries.readAt,createdAt:notificationDeliveries.createdAt,kind:notificationCampaigns.kind,subject:notificationCampaigns.subject,body:notificationCampaigns.body}).from(notificationDeliveries).innerJoin(notificationCampaigns,eq(notificationCampaigns.id,notificationDeliveries.campaignId)).orderBy(desc(notificationDeliveries.createdAt)).limit(200);
 const totals=await getDb().select({status:notificationDeliveries.status,count:sql<number>`count(*)`}).from(notificationDeliveries).groupBy(notificationDeliveries.status);
 return NextResponse.json({settings,connected:Boolean(config.refreshToken),clientConfigured:Boolean(config.clientId),callbackUrl:publicUrl()+"/api/admin/email/callback",history,totals},{headers:{"Cache-Control":"no-store"}});
}
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("settings"),enabled:z.boolean(),welcomeEnabled:z.boolean(),senderName:z.string().trim().min(1).max(80),clientId:z.string().max(300).optional(),clientSecret:z.string().max(300).optional()}),
 z.object({action:z.literal("send"),subject:z.string().trim().min(1).max(180),body:z.string().trim().min(1).max(10000),audience:z.enum(["all","standard","plus","admin","selected","test"]),userIds:z.array(z.string().uuid()).max(500).optional(),email:z.boolean().default(true)}),
 z.object({action:z.literal("reset"),userId:z.string().uuid()}),
 z.object({action:z.literal("retry"),deliveryId:z.string().uuid()}),
]);
export async function POST(request:Request){
 let admin;try{admin=await requireAdmin();}catch{return NextResponse.json({error:"Forbidden"},{status:403});}
 if(!await authRateLimit("notify-admin:"+admin.id,20,1))return NextResponse.json({error:"Please wait before sending more notifications."},{status:429});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Invalid notification data."},{status:400});
 const v=parsed.data;const db=getDb();
 if(v.action==="settings"){
 const settings=await emailSettings();
 await db.insert(appSettings).values({key:"email_notifications",value:{...settings,enabled:v.enabled,welcomeEnabled:v.welcomeEnabled,senderName:v.senderName}}).onConflictDoUpdate({target:appSettings.key,set:{value:{...settings,enabled:v.enabled,welcomeEnabled:v.welcomeEnabled,senderName:v.senderName},updatedAt:new Date()}});
 if(v.clientId&&v.clientSecret){await db.insert(appSettings).values({key:"gmail_oauth",value:{clientId:v.clientId,clientSecret:encryptMemory(v.clientSecret)}}).onConflictDoUpdate({target:appSettings.key,set:{value:{clientId:v.clientId,clientSecret:encryptMemory(v.clientSecret)},updatedAt:new Date()}});}
 return NextResponse.json({ok:true});
 }
 const settings=await emailSettings();
 if(v.action==="reset"){
 if(!settings.enabled)return NextResponse.json({error:"Enable and connect email first."},{status:409});
 const [user]=await db.select().from(users).where(and(eq(users.id,v.userId),eq(users.isActive,true)));if(!user)return NextResponse.json({error:"Account not found or disabled."},{status:404});
 return NextResponse.json(await requestPasswordReset(user,admin.id));
 }
 if(v.action==="retry"){
 const [row]=await db.update(notificationDeliveries).set({status:"queued",error:null,attempts:0,nextAttemptAt:new Date(),lockedAt:null}).where(and(eq(notificationDeliveries.id,v.deliveryId),eq(notificationDeliveries.status,"failed"),sql`${notificationDeliveries.encryptedPayload} is not null`)).returning({id:notificationDeliveries.id});
 return NextResponse.json(row?{ok:true}:{error:"Cannot retry. Create a new reset link or notification."},{status:row?200:409});
 }
 if(v.email&&!settings.enabled)return NextResponse.json({error:"Email is disabled. Connect Gmail and enable sending first."},{status:409});
 const filter=v.audience==="test"?eq(users.id,admin.id):v.audience==="selected"?inArray(users.id,v.userIds??[]):v.audience==="all"?undefined:eq(users.role,v.audience);
 const recipients=await db.select({id:users.id,email:users.email}).from(users).where(and(eq(users.isActive,true),filter)).limit(500);
 if(!recipients.length)return NextResponse.json({error:"No active recipients selected."},{status:400});
 return NextResponse.json(await enqueueNotification({createdBy:admin.id,kind:"announcement",subject:v.subject,body:v.body,recipients:v.audience==="test"&&settings.sender?recipients.map(u=>({...u,email:settings.sender})):recipients,email:v.email}),{status:202});
}
