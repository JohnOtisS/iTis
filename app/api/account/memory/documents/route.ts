import {getUploadLimits} from "@/lib/upload-limits";
import {uploadError} from "@/lib/upload-policy";
import {desc,eq} from "drizzle-orm";
import {NextResponse} from "next/server";
import {getDb} from "@/db";
import {memoryDocuments} from "@/db/schema";
import {getCurrentUser} from "@/lib/auth";
import {withChatFileCleanup} from "@/lib/chat-files";
import {documentMemoryNotice,uploadRememberedDocument} from "@/lib/memory-documents";
import {isStorageError} from "@/lib/account-storage";
import {enforceRateLimit} from "@/lib/rate-limit";
export const runtime="nodejs";
export async function GET(){const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const rows=await getDb().select({id:memoryDocuments.id,name:memoryDocuments.name,url:memoryDocuments.fileUrl,bytes:memoryDocuments.bytes,characters:memoryDocuments.characters,chunkCount:memoryDocuments.chunkCount,createdAt:memoryDocuments.createdAt}).from(memoryDocuments).where(eq(memoryDocuments.userId,user.id)).orderBy(desc(memoryDocuments.createdAt)).limit(200);return NextResponse.json({documents:rows},{headers:{"Cache-Control":"no-store"}});}
export async function POST(request:Request){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});if(!user.memoryEnabled)return NextResponse.json({error:"Personal memory is disabled / Bộ nhớ đã bị tắt"},{status:403});
 if(!await enforceRateLimit(user.id,"memory",10))return NextResponse.json({error:"Too many updates. Try again in a minute."},{status:429});
 const form=await request.formData();const files=form.getAll("files").filter((f):f is File=>f instanceof File&&f.size>0);
 const limits=await getUploadLimits();const invalid=uploadError(files,limits,user.locale==="vi");
 if(!files.length||invalid)return NextResponse.json({error:invalid??"Select at least one document.",uploadLimits:limits},{status:413});
 return withChatFileCleanup(async()=>{
 const results=[];
 for(const file of files){try{const result=await uploadRememberedDocument(user.id,file);results.push({name:file.name,status:result.status,id:result.document.id,notice:documentMemoryNotice([result],user.locale==="vi")});}catch(error){results.push({name:file.name,status:"failed",notice:isStorageError(error)?"Storage quota exceeded / Đã hết dung lượng":error instanceof Error?error.message:"Document could not be remembered"});}}
 return NextResponse.json({results,notice:results.map(r=>r.notice).join("\n")},{status:results.every(r=>r.status==="failed")?422:200});
 });
}
