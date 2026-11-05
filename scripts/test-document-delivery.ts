// Isolated database only. Default uses a deterministic provider fake; --live makes one paid QA call.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {getDb} from "../db";
import {users,conversations,messages,chatJobs} from "../db/schema";
import {saveChatFile,deleteChatFile} from "../lib/chat-files";
import {buildWord,readEditableWord} from "../lib/word-fast";
import {startChatJob} from "../lib/chat-jobs";
import {localArtifactAction} from "../lib/local-artifacts";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {basename,join} from "node:path";

async function main(){
  assert.ok(process.env.DATABASE_URL?.endsWith('/itis_document_qa'),"Use isolated itis_document_qa database");
  const live=process.argv.includes('--live'),db=getDb(),uid=randomUUID(),chat=randomUUID();
  const originalFetch=globalThis.fetch;const tracked:Array<{name:string;url:string}>=[];
  const word=(text:string)=>buildWord({filename:"qa.docx",title:"QA",summary:"",blocks:[{type:"paragraph",text,rows:[]}]});
  const names=["Orders.docx","Adjustments.csv","Rules.docx"];
  const final=word("ORDER-QA-705: Alpha 3 x 100 = 300; Beta 2 x 200 = 400; total quantity 5; total 700.");
  let incomplete=false;let missing=false;let uploaded=0;const downloads:string[]=[];let repairs=0;
  const json=(value:unknown)=>Response.json(value);
  try{
    await db.insert(users).values({id:uid,email:uid+'@qa.invalid',name:"Disposable document QA",passwordHash:"not-a-login",locale:"vi",unlimited:true,totalUnlimited:true});
    await db.insert(conversations).values({id:chat,userId:uid,title:"Disposable document QA"});
    const inputs=[word("Orders: Alpha quantity 2 unit price 100; Beta quantity 3 unit price 200."),new TextEncoder().encode("Item,Adjustment,UnitPrice\nAlpha,1,100\nBeta,-1,200"),word("Rules: apply adjustments to original quantities. Do not add cancelled units. Include ORDER-QA-705 in the final Word.")];
    for(let i=0;i<inputs.length;i++)tracked.push(await saveChatFile(inputs[i],names[i],undefined,"input",uid));
    const prompt="Phân tích và đối chiếu cả 3 tài liệu. Tính số lượng ròng và thành tiền từng mặt hàng sau điều chỉnh, tổng số lượng và tổng tiền. Giữ mã ORDER-QA-705. Xuất bản W duy nhất, không PDF hay text phụ. Không chép nội dung tài liệu vào chat.";
    const [userMessage]=await db.insert(messages).values({conversationId:chat,role:"user",content:prompt,attachments:tracked}).returning();
    const input={userId:uid,conversationId:chat,sourceMessageId:userMessage.id,prompt,systemPrompt:"Be concise, accurate; read the supplied originals. Do not invent data.",history:[{role:"user",content:prompt}],documents:[...tracked],catalog:[...tracked],artifact:true,compute:true,webSearch:false,model:"gpt-6.1-sol",locale:"vi" as const};
    if(!live)globalThis.fetch=async(url,options)=>{
      const target=String(url);
      if(target.endsWith('/v1/files'))return json({id:`file-${++uploaded}`});
      if(target.endsWith('/v1/responses')){
        const body=JSON.parse(String(options?.body));
        if(JSON.stringify(body.input).includes('"input_image"')){
          assert.ok(!body.tools?.some((t:{type:string})=>t.type==="code_interpreter"),"image understanding must not send images as document files");
          return json({id:`resp-image-${randomUUID()}`,status:"completed",usage:{input_tokens:30,output_tokens:10},output:[{type:"message",content:[{type:"output_text",text:"Image QA: 42"}]}]});
        }
        if(body.previous_response_id)repairs++;
        else assert.match(body.input[0].content,/Deliver ONLY these requested output formats: \.docx/);
        return json({id:`resp-${randomUUID()}`,status:incomplete?"incomplete":"completed",incomplete_details:incomplete?{reason:"max_output_tokens"}:undefined,usage:{input_tokens:120,output_tokens:40},output:[{type:"code_interpreter_call",container_id:"container-qa"},{type:"message",content:[{type:"output_text",text:"[Word](sandbox:/mnt/data/final.docx)",annotations:[{type:"container_file_citation",filename:"final.docx",container_id:"container-qa",file_id:"final"},{type:"container_file_citation",filename:"preview.pdf",container_id:"container-qa",file_id:"preview"}]}]}]});
      }
      if(target.includes('/files?'))return json({data:[{id:"final",path:"/mnt/data/final.docx",source:"assistant"},{id:"preview",path:"/mnt/data/preview.pdf",source:"assistant"},{id:"ocr",path:"/mnt/data/ocr.txt",source:"assistant"},{id:"check",path:"/mnt/data/itis-validation.json",source:"assistant"}]});
      if(target.endsWith('/files/check/content'))return json({checks:[{name:"independent totals",passed:true}],sources:missing?[names[0]]:names});
      if(target.endsWith('/files/final/content')){downloads.push('docx');return new Response(new Uint8Array(final).buffer);}
      if(target.includes('/files/preview/')||target.includes('/files/ocr/'))throw new Error('Unrequested intermediate must not be downloaded');
      if(options?.method==='DELETE')return json({deleted:true});
      throw new Error('Unexpected fake request: '+target);
    };
    const started=performance.now();const response=await startChatJob(input,false);const result=await response.json() as {attachments:Array<{name:string;url:string}>;text:string;usage:unknown};
    assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.attachments.length,1);assert.match(result.attachments[0].name,/\.docx$/i);
    const bytes=await readFile(join(process.env.GENERATED_FILES_DIR!,basename(result.attachments[0].url)));
    const text=readEditableWord(bytes).text;
    for(const marker of ['ORDER-QA-705','Alpha','Beta','700'])assert.ok(text.includes(marker),marker);
    if(!live){assert.equal(uploaded,3);assert.equal(repairs,0);assert.equal(result.text,"");assert.ok(downloads.length>0);}
    await mkdir('artifacts/document-qa',{recursive:true});await writeFile(`artifacts/document-qa/${live?'live':'mock'}-verified.docx`,bytes);
    console.log(JSON.stringify({mode:live?'live':'fake',seconds:Math.round((performance.now()-started)/100)/10,files:result.attachments.map((f:{name:string})=>f.name),usage:result.usage,verifiedMarkers:true}));
    // An unanswered document request must not export an older unrelated answer.
    await db.insert(messages).values({conversationId:chat,role:'user',content:'Tham mưu biên bản họp mới',createdAt:new Date(Date.now()+1000)});
    assert.equal(await localArtifactAction({userId:uid,conversationId:chat,prompt:'xuất bản W',locale:'vi'}),null);
    if(!live){
      incomplete=true;
      const recovered=await startChatJob({...input,sourceMessageId:null},false);assert.equal(recovered.status,200,"verified files must survive a provider text limit");assert.equal(repairs,0,"do not repay to regenerate verified outputs");incomplete=false;
      const image=await saveChatFile(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'),'qa.png','image/png','input',uid);tracked.push(image);
      const vision=await startChatJob({...input,sourceMessageId:null,prompt:'Đọc nội dung trong ảnh',documents:[image],catalog:[image],artifact:false,compute:false},false);assert.equal(vision.status,200);assert.equal((await vision.json() as {text:string}).text,'Image QA: 42');
      missing=true;
      const second=await startChatJob({...input,sourceMessageId:null},false);assert.equal(second.status,502);
      const [job]=await db.select().from(chatJobs).where(eq(chatJobs.id,(await second.json() as {jobId:string}).jobId));assert.equal(job.status,'failed');assert.match(job.error!,/Missing sources/);assert.equal(repairs,1);
      console.log('PASS exact DOCX-only delivery, intermediate filtering before download, all-source coverage, one bounded repair, durable failed job, no stale answer export');
    }
  }finally{
    globalThis.fetch=originalFetch;
    const attachments=(await db.select({attachments:messages.attachments}).from(messages).where(eq(messages.conversationId,chat))).flatMap(m=>m.attachments);
    await db.delete(users).where(eq(users.id,uid));
    for(const f of [...tracked,...attachments])await deleteChatFile(f.url);
    await globalThis.__itisPostgresPool?.end();
  }
}
void main();
