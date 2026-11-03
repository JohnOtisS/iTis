import {createHash} from "node:crypto";
import {and,desc,eq,sql} from "drizzle-orm";
import {getDb} from "@/db";
import {conversations,messages,users} from "@/db/schema";
import {documentCatalog,validateOutput,versionOutput} from "@/lib/chat-documents";
import {readChatFile,saveChatFile,type ChatAttachment} from "@/lib/chat-files";
import {buildWord,wordDraftSchema} from "@/lib/word-fast";
import {documentKind,localArtifactIntent,resolveFileReference} from "@/lib/artifact-policy";
import {taskUsage} from "@/lib/task-usage";

export function markdownWordDraft(content:string) {
  const blocks:Array<{type:"heading"|"paragraph"|"bullet"|"table";text:string;rows:string[][]}>=[];
  const plain=(s:string)=>s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,"$1 ($2)").replace(/\*\*([^*]+)\*\*/g,"$1").replace(/__([^_]+)__/g,"$1").replace(/`([^`]+)`/g,"$1");
  const lines=content.replace(/\r\n/g,"\n").split("\n");
  let code=false;
  const cells=(s:string)=>s.trim().replace(/^\||\|$/g,"").split(/(?<!\\)\|/).map(c=>plain(c.trim().replace(/\\\|/g,"|")));
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/^\s*```/.test(line)){code=!code;continue;}
    if(!code&&i+1<lines.length&&line.includes("|")&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
      const rows=[cells(line)];i++;
      while(i+1<lines.length&&lines[i+1].includes("|")&&lines[i+1].trim()){rows.push(cells(lines[++i]));}
      blocks.push({type:"table",text:"",rows});continue;
    }
    const heading=!code?line.match(/^#{1,6}\s+(.+)$/):null;
    const bullet=!code?line.match(/^\s*[-*+]\s+(.+)$/):null;
    blocks.push({type:heading?"heading":bullet?"bullet":"paragraph",text:code?line:plain(heading?.[1]??bullet?.[1]??line),rows:[]});
  }
  // Explicit size validation rejects oversized exports rather than silently dropping text.
  return wordDraftSchema.extend({blocks:wordDraftSchema.shape.blocks.max(1200)}).parse({filename:"document.docx",title:"Document",summary:"",blocks});
}

type LocalInput={userId:string;conversationId:string;prompt:string;locale:"en"|"vi";sourceMessageId?:string;format?:"docx"|"txt"|"md"};
export async function localArtifactAction(input:LocalInput) {
  if(!input.sourceMessageId&&!localArtifactIntent(input.prompt))return null;
  return getDb().transaction(async tx=>{
    const lock=await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${'artifact:'+input.conversationId})) as acquired`);
    if(!lock.rows[0]?.acquired)throw new Error("ARTIFACT_BUSY");
    return performLocalArtifactAction(input);
  });
}
async function performLocalArtifactAction(input:LocalInput) {
  const db=getDb();
  const intent=input.sourceMessageId?"export":localArtifactIntent(input.prompt);
  if(!intent)return null;
  const [owned]=await db.select({id:conversations.id}).from(conversations).where(and(eq(conversations.id,input.conversationId),eq(conversations.userId,input.userId)));
  if(!owned)throw new Error("ARTIFACT_SOURCE_NOT_FOUND");
  const catalog=await documentCatalog(input.conversationId);
  const t=(en:string,vi:string)=>input.locale==="vi"?vi:en;
  let files:ChatAttachment[]=[];let clarification="";
  if(intent==="resend"){
    const resolved=resolveFileReference(catalog,input.prompt);
    if(resolved.ambiguous)clarification=t("Which file should I send? Specify its name or version: ","Bạn muốn gửi lại tệp nào? Hãy nêu tên hoặc phiên bản: ")+resolved.files.slice(0,6).map(f=>f.name+` (v${f.version??1})`).join("; ");
    else if(!resolved.files.length)clarification=t("No matching file is saved in this chat. Please specify the file name.","Chưa có tệp phù hợp trong phiên này. Bạn hãy nêu tên tệp cần gửi lại.");
    else files=resolved.files;
  }else{
    // Do not substitute a different format when a request contains several targets.
    const format=input.format??(/markdown|\.md\b/i.test(input.prompt)?"md":/\.txt\b/i.test(input.prompt)?"txt":"docx");
    if(!input.sourceMessageId&&/pdf|excel|xlsx|pptx|powerpoint|csv/i.test(input.prompt))return null;
    const sources=await db.select().from(messages).where(and(eq(messages.conversationId,input.conversationId),eq(messages.role,"assistant"),input.sourceMessageId?eq(messages.id,input.sourceMessageId):undefined)).orderBy(desc(messages.createdAt),desc(messages.id)).limit(input.sourceMessageId?1:80);
    let source:typeof sources[number]|undefined=sources[0];
    if(!input.sourceMessageId){
      const kind=documentKind(input.prompt);
      const drafts=sources.filter(s=>s.content.trim().length>=160&&!s.attachments.length);
      const matching=kind?drafts.filter(s=>documentKind(s.content.slice(0,500))===kind):drafts;
      source=matching[0];
      if(kind&&matching.length>1&&sources[0]?.id!==source?.id&&!/vừa|mới nhất|latest|last/i.test(input.prompt))clarification=t("Several drafts match. Use “Export Word” on the exact answer you want.","Có nhiều bản nháp phù hợp. Hãy bấm “Xuất Word” ngay tại câu trả lời cần xuất.");
      if(!source&&!clarification){
        const resolved=resolveFileReference(catalog,input.prompt);
        if(resolved.files.length===1&&resolved.files[0].name.toLowerCase().endsWith("."+format))files=resolved.files;
        else clarification=t("Select the answer to export using its Export Word button, or specify the document name.","Hãy chọn nút Xuất Word tại câu trả lời cần xuất, hoặc nêu rõ tên tài liệu.");
      }
    }
    if(!input.sourceMessageId&&!clarification){
      const existing=resolveFileReference(catalog.filter(f=>f.kind==="output"&&f.name.toLowerCase().endsWith("."+format)),input.prompt);
      if(existing.files.length===1){
        const [delivered]=await db.select({createdAt:messages.createdAt}).from(messages).where(and(eq(messages.conversationId,input.conversationId),sql`${messages.attachments} @> ${JSON.stringify([{url:existing.files[0].url}])}::jsonb`)).orderBy(messages.createdAt).limit(1);
        // Natural "export again" uses the newest saved version, while the exact-answer button
        // deliberately exports that immutable answer, even after a later file edit.
        if(delivered&&(!source||delivered.createdAt>=source.createdAt)){files=existing.files;source=undefined;}
      }
    }
    if(input.sourceMessageId&&!source?.content.trim())throw new Error("ARTIFACT_SOURCE_NOT_FOUND");
    if(source&&!clarification){
      const hash=createHash("sha256").update(source.content).digest("hex");
      const reused=catalog.find(f=>f.sourceMessageId===source.id&&f.sourceContentHash===hash&&f.name.endsWith("."+format));
      if(reused)files=[reused];
      else{
        const bytes=format==="docx"?buildWord(markdownWordDraft(source.content),false):new TextEncoder().encode(source.content);
        validateOutput(bytes,"document."+format);
        const title=source.content.split("\n").find(l=>l.trim())?.replace(/^#+\s*/,"").replace(/[^\p{L}\p{N} _-]/gu,"").slice(0,75)||"iTis-document";
        const file=versionOutput(await saveChatFile(bytes,title+"."+format,undefined,"output",input.userId),[],catalog);
        files=[{...file,sourceMessageId:source.id,sourceContentHash:hash}];
      }
    }
  }
  for(const file of files)if(!await readChatFile(file.url.replace(/^\/api\/files\//,"")))throw new Error("ARTIFACT_FILE_MISSING");
  const usage=taskUsage(undefined,{usage_complete:true});
  const result={text:clarification,model:"iTis Files",provider:"local",conversationId:input.conversationId,attachments:files,usage,pipeline:intent==="resend"?"reuse_file":"local_export"};
  await db.transaction(async tx=>{
    // Serialize file-only requests, and never leave an orphan result after chat deletion.
    await tx.select({id:users.id}).from(users).where(eq(users.id,input.userId)).for("update");
    const [chat]=await tx.select({id:conversations.id}).from(conversations).where(and(eq(conversations.id,input.conversationId),eq(conversations.userId,input.userId))).for("no key update");
    if(!chat)throw new Error("ARTIFACT_SOURCE_NOT_FOUND");
    await tx.insert(messages).values({conversationId:chat.id,role:"user",content:input.prompt,tokenCount:Math.ceil(input.prompt.length/3)});
    const [answer]=await tx.insert(messages).values({conversationId:chat.id,role:"assistant",content:result.text,model:result.model,attachments:files,taskUsage:usage}).returning({id:messages.id});
    await tx.update(conversations).set({contextTokens:sql`(select coalesce(sum(token_count),0) from messages where conversation_id=${chat.id})`,updatedAt:new Date()}).where(eq(conversations.id,chat.id));
    Object.assign(result,{messageId:answer.id});
  });
  return result;
}
