import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatJobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { cancelChatJob } from "@/lib/chat-jobs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return Response.json({error:"Unauthorized"},{status:401});
  const {id}=await context.params;
  const [job]=await getDb().select().from(chatJobs).where(and(eq(chatJobs.id,id),eq(chatJobs.userId,user.id)));
  if(!job)return Response.json({error:"Task not found"},{status:404});
  if(job.status==="running" && Date.now()-job.updatedAt.getTime()>15*60*1000){
    await cancelChatJob(id,user.id).catch(()=>{});
    return Response.json({job:{...job,status:"failed",error:"Task interrupted. Retry using the files already in this conversation."}},{headers:{"Cache-Control":"no-store"}});
  }
  return Response.json({job},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(_request:Request,context:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return Response.json({error:"Unauthorized"},{status:401});
  const {id}=await context.params;
  const job=await cancelChatJob(id,user.id);
  return Response.json({cancelled:Boolean(job)});
}
