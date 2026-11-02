import {eq} from "drizzle-orm";
import {NextResponse} from "next/server";
import {z} from "zod";
import {getDb} from "@/db";
import {users} from "@/db/schema";
import {authRateLimit,requestAddress} from "@/lib/auth-security";
import {requestPasswordReset,emailSettings} from "@/lib/notifications";
export const runtime="nodejs";
export async function POST(request:Request){
 const parsed=z.object({email:z.string().trim().email().max(254)}).safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"Enter a valid email address."},{status:400});
 const email=parsed.data.email.toLowerCase();
 if(!await authRateLimit("reset-ip:"+requestAddress(request),20)||!await authRateLimit("reset-email:"+email,3))return NextResponse.json({error:"Too many requests. Please try again later."},{status:429});
 const [user]=await getDb().select().from(users).where(eq(users.email,email));
 if(user?.isActive&&(await emailSettings()).enabled)await requestPasswordReset(user);
 return NextResponse.json({ok:true,message:"If an active account matches, a reset link will be emailed shortly."});
}
