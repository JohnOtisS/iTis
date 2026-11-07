// Isolated database only. Default uses a deterministic provider fake; --live makes one paid QA call.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {getDb} from "../db";
import {users,conversations,messages,chatJobs} from "../db/schema";
import {saveChatFile,deleteChatFile} from "../lib/chat-files";
import {buildWord,readEditableWord} from "../lib/word-fast";
import {startChatJob} from "../lib/chat-jobs";
import {readChatEvents} from "../lib/chat-stream";
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
  let incomplete=false;let missing=false;let uploaded=0;const downloads:string[]=[];let repairs=0;let livePosts=0;let dropStream=false;let terminalResponse:Record<string,unknown>|undefined;
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
        if(JSON.stringify(body.input).includes("REALTIME-QA")){
          assert.equal(body.stream,true);livePosts++;
          terminalResponse={id:`resp-realtime-${randomUUID()}`,status:"completed",usage:{input_tokens:10,output_tokens:20},output:[{type:"message",content:[{type:"output_text",text:"Tiếng Việt: kết quả QA."}]}]};
          const data=terminalResponse;
          return new Response(new ReadableStream<Uint8Array>({async start(c){const send=(event:unknown)=>c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));
            send({type:"response.created",response:{id:data.id,status:"in_progress"}});
            send({type:"response.reasoning_text.delta",delta:"PRIVATE REASONING MUST NOT LEAK"});
            send({type:"response.output_text.delta",delta:"Tiếng Việt: "});
            await new Promise(resolve=>setTimeout(resolve,40));
            if(!dropStream){send({type:"response.output_text.delta",delta:"kết quả QA."});send({type:"response.completed",response:data});}
            c.close();}}),{headers:{"Content-Type":"text/event-stream"}});
        }
        if(JSON.stringify(body.input).includes('"input_image"')){
          assert.ok(!body.tools?.some((t:{type:string})=>t.type==="code_interpreter"),"image understanding must not send images as document files");
          return json({id:`resp-image-${randomUUID()}`,status:"completed",usage:{input_tokens:30,output_tokens:10},output:[{type:"message",content:[{type:"output_text",text:"Image QA: 42"}]}]});
        }
        if(body.previous_response_id)repairs++;
        else assert.match(body.input[0].content,/Deliver ONLY these requested output formats: \.docx/);
        return json({id:`resp-${randomUUID()}`,status:incomplete?"incomplete":"completed",incomplete_details:incomplete?{reason:"max_output_tokens"}:undefined,usage:{input_tokens:120,output_tokens:40},output:[{type:"code_interpreter_call",container_id:"container-qa"},{type:"message",content:[{type:"output_text",text:"[Word](sandbox:/mnt/data/final.docx)",annotations:[{type:"container_file_citation",filename:"final.docx",container_id:"container-qa",file_id:"final"},{type:"container_file_citation",filename:"preview.pdf",container_id:"container-qa",file_id:"preview"}]}]}]});
      }
      if(target.includes('/responses/resp-realtime-')&&options?.method!=='DELETE')return json(terminalResponse);
      if(target.includes('/files?'))return json({data:[{id:"final",path:"/mnt/data/final.docx",source:"assistant"},{id:"preview",path:"/mnt/data/preview.pdf",source:"assistant"},{id:"ocr",path:"/mnt/data/ocr.txt",source:"assistant"},{id:"check",path:"/mnt/data/itis-validation.json",source:"assistant"}]});
      if(target.endsWith('/files/check/content'))return json({checks:[{name:"independent totals",passed:true}],sources:missing?[names[0]]:names});
      if(target.endsWith('/files/final/content')){downloads.push('docx');return new Response(new Uint8Array(final).buffer);}
      if(target.includes('/files/preview/')||target.includes('/files/ocr/'))throw new Error('Unrequested intermediate must not be downloaded');
      if(options?.method==='DELETE')return json({deleted:true});
      throw new Error('Unexpected fake request: '+target);
    };
    const started=performance.now();const response=await startChatJob(input,live);
    type Result={type?:string;attachments:Array<{name:string;url:string}>;text:string;usage:unknown};
    let result:Result;
    if(live){let final:Result|undefined;let updates=0;for await(const event of readChatEvents<{type:string;stage?:string}>(response.body!)){updates++;if(event.type==='progress')console.log('LIVE STAGE',event.stage);if(event.type==='error')throw Error(JSON.stringify(event));if(event.type==='done')final=event as unknown as Result;}assert.ok(final);result=final;console.log('LIVE updates',updates);}else result=await response.json() as Result;
    assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.attachments.length,1);assert.match(result.attachments[0].name,/\.docx$/i);
    const bytes=await readFile(join(process.env.GENERATED_FILES_DIR!,basename(result.attachments[0].url)));
    const text=readEditableWord(bytes).text;
    for(const marker of ['ORDER-QA-705','Alpha','Beta','700'])assert.ok(text.includes(marker),marker);
    if(!live){assert.equal(uploaded,3);assert.equal(repairs,0);assert.equal(result.text,"");assert.ok(downloads.length>0);}
    await mkdir('artifacts/document-qa',{recursive:true});await writeFile(`artifacts/document-qa/${live?'live':'mock'}-verified.docx`,bytes);
    console.log(JSON.stringify({mode:live?'live':'fake',seconds:Math.round((performance.now()-started)/100)/10,files:result.attachments.map((f:{name:string})=>f.name),usage:result.usage,verifiedMarkers:true}));
    if(live){
      const prompt='Phân tích và đối chiếu cả 3 tài liệu, trả lời ngắn số lượng ròng từng mặt hàng, tổng số lượng và tổng tiền sau điều chỉnh. Không tạo file.';
      const started=performance.now();const response=await startChatJob({...input,prompt,artifact:false},true);
      let deltas=0,firstDelta=0,answer='';
      for await(const event of readChatEvents<{type:string;delta?:string;text?:string}>(response.body!)){
        if(event.type==='delta'){deltas++;firstDelta||=performance.now()-started;}
        if(event.type==='error')throw Error(JSON.stringify(event));if(event.type==='done')answer=event.text??'';
      }
      assert.ok(deltas>0,'real answer must stream before terminal result');assert.match(answer,/700/);
      console.log(JSON.stringify({liveAnalysisDeltas:deltas,firstDeltaSeconds:Math.round(firstDelta/100)/10,seconds:Math.round((performance.now()-started)/100)/10,answer}));
    }
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
      for(const drop of [false,true]){
        dropStream=drop;livePosts=0;
        const response=await startChatJob({...input,prompt:'REALTIME-QA: trả lời ngắn gọn',sourceMessageId:null,documents:[],catalog:[],artifact:false,compute:false},true);
        const events=[];for await(const e of readChatEvents<{type:string;delta?:string;text?:string;attachments?:unknown[]}>(response.body!))events.push(e);
        assert.ok(events.some(e=>e.type==='delta'&&e.delta?.includes('Tiếng Việt')),'answer must arrive before done');
        assert.ok(!JSON.stringify(events).includes('PRIVATE REASONING'));
        assert.equal(events.at(-1)?.type,'done');assert.equal(events.at(-1)?.text,'Tiếng Việt: kết quả QA.');assert.equal(livePosts,1,'lost provider stream must recover the same response without another model call');
      }
      console.log('PASS incremental answer before completion, private reasoning excluded, provider-disconnect fallback without another POST');
      console.log('PASS exact DOCX-only delivery, intermediate filtering before download, all-source coverage, one bounded repair, durable failed job, no stale answer export');
      const recovery=randomUUID();
      await db.insert(conversations).values({id:recovery,userId:uid,title:"Pasted exam export QA"});
      const pasted="ĐỀ KIỂM TRA QA\nThời gian: 30 phút\n\nI. Chọn câu trả lời\n"+("Hello means Xin chào.\n".repeat(10))+"d. Two books.";
      await db.insert(messages).values([
        {conversationId:recovery,role:"user",content:pasted+" xuất bản Wold cho tôi với",createdAt:new Date(Date.now()-2000)},
        {conversationId:recovery,role:"assistant",content:"Hiện tại tôi không thể đính kèm trực tiếp tệp Word trong cuộc trò chuyện này.",createdAt:new Date(Date.now()-1000)},
      ]);
      const pastedResult=await localArtifactAction({userId:uid,conversationId:recovery,prompt:"xuât bản doc cho tôi",locale:"vi"});
      assert.equal(pastedResult?.attachments.length,1);
      assert.equal(pastedResult?.usage.total_tokens,0);
      tracked.push(...pastedResult!.attachments);
      const recoveredBytes=await readFile(join(process.env.GENERATED_FILES_DIR!,basename(pastedResult!.attachments[0].url)));
      const recoveredText=readEditableWord(recoveredBytes).text;
      for(const marker of ["ĐỀ KIỂM TRA QA","30 phút","Hello","d. Two books."])assert.ok(recoveredText.includes(marker),marker);
      assert.ok(!recoveredText.includes("không thể đính kèm"));
      await db.insert(messages).values([
        {conversationId:recovery,role:"user",content:"Đổi thời gian làm bài thành 45 phút.",createdAt:new Date(Date.now()+1000)},
        {conversationId:recovery,role:"assistant",content:"Tôi không thể tạo tệp trong cuộc trò chuyện này.",createdAt:new Date(Date.now()+2000)},
      ]);
      assert.equal(await localArtifactAction({userId:uid,conversationId:recovery,prompt:"xuất bản doc",locale:"vi"}),null,"later edits must go through the document pipeline");
      console.log("PASS doc/Wold recovery exports the original pasted draft without refusal text or paid calls");
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
