import bcrypt from "bcryptjs";
import {and,eq,gt,isNull} from "drizzle-orm";
import {NextResponse} from "next/server";
import {z} from "zod";
import {getDb} from "@/db";
import {users,sessions,passwordResets} from "@/db/schema";
import {authRateLimit,requestAddress,tokenHash} from "@/lib/auth-security";
export const runtime="nodejs";
export async function POST(request:Request){
 if(!await authRateLimit("reset-use:"+requestAddress(request),20))return NextResponse.json({error:"Too many attempts."},{status:429});
 const data=z.object({token:z.string().min(40).max(100),password:z.string().min(12).max(200)}).safeParse(await request.json().catch(()=>null));
 if(!data.success)return NextResponse.json({error:"Invalid link or password. Use at least 12 characters."},{status:400});
 const token=tokenHash(data.data.token);
 const [found]=await getDb().select().from(passwordResets).where(eq(passwordResets.tokenHash,token));
 if(!found)return NextResponse.json({error:"This reset link is invalid or expired."},{status:400});
 const hash=await bcrypt.hash(data.data.password,12);
 const ok=await getDb().transaction(async tx=>{
 const [user]=await tx.select().from(users).where(eq(users.id,found.userId)).for("update");if(!user?.isActive)return false;
 const [used]=await tx.update(passwordResets).set({usedAt:new Date()}).where(and(eq(passwordResets.tokenHash,token),isNull(passwordResets.usedAt),gt(passwordResets.expiresAt,new Date()))).returning();
 if(!used)return false;
 await tx.update(users).set({passwordHash:hash,updatedAt:new Date()}).where(eq(users.id,user.id));await tx.delete(sessions).where(eq(sessions.userId,user.id));await tx.delete(passwordResets).where(eq(passwordResets.userId,user.id));return true;
 });
 return NextResponse.json(ok?{ok:true}:{error:"This reset link is invalid or expired."},{status:ok?200:400});
}
