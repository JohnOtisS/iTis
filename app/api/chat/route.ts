import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { usageEvents } from "@/db/schema";
type ApiPayload={output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>;usage?:{input_tokens?:number;output_tokens?:number;total_tokens?:number;input_tokens_details?:{cached_tokens?:number};output_tokens_details?:{reasoning_tokens?:number}}};
export async function POST(request:Request){
  const user=process.env.NODE_ENV==="development"?{userId:"demo",email:"demo@itis.ai"}:await getChatGPTUser();
  if(!user)return NextResponse.json({error:"Bạn cần đăng nhập"},{status:401});
  const body=await request.json() as {prompt?:string}; const prompt=body.prompt?.trim();
  if(!prompt)return NextResponse.json({error:"Thiếu nội dung"},{status:400});
  const model=/excel|báo cáo|powerpoint|code|phân tích|nhiều file|reasoning|chính xác/i.test(prompt)?"gpt-6.1-sol":"gpt-6-luna"; const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey){const complex=model==="gpt-6.1-sol";return NextResponse.json({text:complex?"Mình đã định tuyến yêu cầu này sang GPT-6.1 Sol vì nó cần phân tích sâu. Đây là chế độ demo của iTis; sau khi Admin thêm OPENAI_API_KEY, câu trả lời thật từ OpenAI Responses API sẽ xuất hiện tại đây.":"Mình đã xử lý yêu cầu này bằng GPT-6 Luna để tối ưu tốc độ và chi phí. Đây là chế độ demo của iTis; Admin chỉ cần thêm OPENAI_API_KEY để bật câu trả lời thật.",model,demo:true,usage:{input_tokens:Math.ceil(prompt.length/3),output_tokens:complex?318:96,total_tokens:Math.ceil(prompt.length/3)+(complex?318:96)}})}
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,safety_identifier:user.userId,reasoning:{effort:model==="gpt-6.1-sol"?"medium":"low"},input:[{role:"system",content:"Bạn là iTis, trợ lý AI chuyên nghiệp, rõ ràng và hữu ích. Trả lời bằng tiếng Việt trừ khi người dùng yêu cầu khác."},{role:"user",content:prompt}]})});
  if(!response.ok)return NextResponse.json({error:"OpenAI API không khả dụng"},{status:502}); const data=await response.json() as ApiPayload;
  const usage=data.usage; const input=usage?.input_tokens??0,cached=usage?.input_tokens_details?.cached_tokens??0,output=usage?.output_tokens??0;
  const prices=model==="gpt-6.1-sol"?{input:2,cached:.1,output:10}:{input:.1,cached:.01,output:.5};
  const estimatedCostUsd=((input-cached)*prices.input+cached*prices.cached+output*prices.output)/1_000_000;
  try{await getDb().insert(usageEvents).values({id:crypto.randomUUID(),userId:user.userId,requestId:response.headers.get("x-request-id"),model,inputTokens:input,cachedTokens:cached,reasoningTokens:usage?.output_tokens_details?.reasoning_tokens??0,outputTokens:output,estimatedCostUsd,routerReason:model==="gpt-6.1-sol"?"complex_task":"efficient_task",createdAt:new Date()})}catch{}
  const text=data.output_text??data.output?.flatMap(item=>item.content??[]).filter(item=>item.type==="output_text").map(item=>item.text??"").join("\n")??"";
  return NextResponse.json({text,model,usage,estimated_cost_usd:estimatedCostUsd,demo:false});
}
