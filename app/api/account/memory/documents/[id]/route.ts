import {and,eq} from "drizzle-orm";
import {NextResponse} from "next/server";
import {getDb} from "@/db";
import {memoryDocuments} from "@/db/schema";
import {getCurrentUser} from "@/lib/auth";
import {deleteChatFile} from "@/lib/chat-files";
export const runtime="nodejs";
export async function DELETE(_request:Request,context:{params:Promise<{id:string}>}){const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const {id}=await context.params;if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:"Not found"},{status:404});const [doc]=await getDb().delete(memoryDocuments).where(and(eq(memoryDocuments.id,id),eq(memoryDocuments.userId,user.id))).returning();if(!doc)return NextResponse.json({error:"Not found"},{status:404});await deleteChatFile(doc.fileUrl);return NextResponse.json({deleted:true});}
