import {NextResponse} from "next/server";
import {z} from "zod";
import {getCurrentUser} from "@/lib/auth";
import {localArtifactAction} from "@/lib/local-artifacts";
import {withChatFileCleanup} from "@/lib/chat-files";
import {enforceRateLimit} from "@/lib/rate-limit";
import {isStorageError,STORAGE_ERROR} from "@/lib/account-storage";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  if(!await enforceRateLimit(user.id))return NextResponse.json({error:"Please try again in one minute."},{status:429});
  const body=z.object({sourceMessageId:z.string().uuid(),format:z.enum(["docx","txt","md"]).default("docx")}).safeParse(await request.json().catch(()=>null));
  if(!body.success)return NextResponse.json({error:"Select a valid answer and format."},{status:400});
  const {id}=await context.params;
  try{
    return NextResponse.json(await withChatFileCleanup(()=>localArtifactAction({userId:user.id,conversationId:id,locale:user.locale,...body.data,prompt:user.locale==="vi"?`Xuất câu trả lời đã chọn ra ${body.data.format.toUpperCase()}`:`Export the selected answer as ${body.data.format.toUpperCase()}`})));
  }catch(error){
    if(isStorageError(error))return NextResponse.json({error:STORAGE_ERROR},{status:413});
    if(error instanceof Error&&error.message==="ARTIFACT_SOURCE_BLOCKED")return NextResponse.json({error:user.locale==="vi"?"Câu trả lời này đang báo thiếu dữ liệu. Hãy hoàn tất phân tích trước khi xuất.":"This answer reports missing data. Complete the analysis before exporting."},{status:422});
      if(error instanceof Error&&error.message==="ARTIFACT_BUSY")return NextResponse.json({error:"Another file export is running in this chat. Please retry shortly."},{status:409});
    const missing=error instanceof Error&&error.message==="ARTIFACT_SOURCE_NOT_FOUND";
    return NextResponse.json({error:missing?"Answer not found.":"Unable to export this answer. Its contents exceed the supported export size or the source file is unavailable."},{status:missing?404:422});
  }
}
