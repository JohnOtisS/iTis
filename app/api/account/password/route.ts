import bcrypt from "bcryptjs";
import {eq} from "drizzle-orm";
import {NextResponse} from "next/server";
import {z} from "zod";
import {getDb} from "@/db";
import {users,sessions,passwordResets} from "@/db/schema";
import {getCurrentUser,createSession} from "@/lib/auth";
import {authRateLimit} from "@/lib/auth-security";
export const runtime="nodejs";
export async function POST(request:Request){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 if(!await authRateLimit("password:"+user.id))return NextResponse.json({error:"Too many attempts. Try again in 15 minutes."},{status:429});
 const data=z.object({currentPassword:z.string().max(200),newPassword:z.string().min(12).max(200)}).safeParse(await request.json().catch(()=>null));
 if(!data.success)return NextResponse.json({error:"Use a new password of 12–200 characters."},{status:400});
 const [current]=await getDb().select().from(users).where(eq(users.id,user.id));
 if(!await bcrypt.compare(data.data.currentPassword,current.passwordHash))return NextResponse.json({error:"Current password is incorrect."},{status:400});
 const hash=await bcrypt.hash(data.data.newPassword,12);
 const changed=await getDb().transaction(async tx=>{
 const [locked]=await tx.select().from(users).where(eq(users.id,user.id)).for("update");
 if(locked.passwordHash!==current.passwordHash)return false;
 await tx.update(users).set({passwordHash:hash,updatedAt:new Date()}).where(eq(users.id,user.id));
 await tx.delete(sessions).where(eq(sessions.userId,user.id));await tx.delete(passwordResets).where(eq(passwordResets.userId,user.id));return true;
 });
 if(!changed)return NextResponse.json({error:"Password changed elsewhere. Please sign in again."},{status:409});
 if(!await createSession(user.id,hash))return NextResponse.json({error:"Password changed elsewhere. Please sign in again."},{status:401});return NextResponse.json({ok:true});
}
