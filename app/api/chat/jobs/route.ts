import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "@/db";
import { chatJobs, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const user=await getCurrentUser();if(!user)return Response.json({error:"Unauthorized"},{status:401});
  const conversationId=new URL(request.url).searchParams.get("conversationId");
  if(!conversationId)return Response.json({jobs:[]});
  const jobs=await getDb().select({...getTableColumns(chatJobs),sourcePrompt:messages.content}).from(chatJobs).leftJoin(messages,eq(chatJobs.sourceMessageId,messages.id)).where(and(eq(chatJobs.userId,user.id),eq(chatJobs.conversationId,conversationId))).orderBy(desc(chatJobs.createdAt)).limit(5);
  return Response.json({jobs},{headers:{"Cache-Control":"no-store"}});
}
