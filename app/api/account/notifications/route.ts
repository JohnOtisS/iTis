import {and,desc,eq,isNull} from "drizzle-orm";
import {NextResponse} from "next/server";
import {getDb} from "@/db";
import {notificationDeliveries,notificationCampaigns} from "@/db/schema";
import {getCurrentUser} from "@/lib/auth";
export const runtime="nodejs";
export async function GET(){const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const items=await getDb().select({id:notificationDeliveries.id,subject:notificationCampaigns.subject,body:notificationCampaigns.body,createdAt:notificationDeliveries.createdAt,readAt:notificationDeliveries.readAt}).from(notificationDeliveries).innerJoin(notificationCampaigns,eq(notificationCampaigns.id,notificationDeliveries.campaignId)).where(eq(notificationDeliveries.userId,user.id)).orderBy(desc(notificationDeliveries.createdAt)).limit(50);return NextResponse.json({items},{headers:{"Cache-Control":"no-store"}});}
export async function PATCH(){const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});await getDb().update(notificationDeliveries).set({readAt:new Date()}).where(and(eq(notificationDeliveries.userId,user.id),isNull(notificationDeliveries.readAt)));return NextResponse.json({ok:true});}
