import {z} from "zod";
import {strFromU8,strToU8,unzipSync,zipSync} from "fflate";
import {XMLValidator} from "fast-xml-parser";
import {documentRequestText,outputExtensions} from "@/lib/document-request";
import {readEditableWord} from "@/lib/word-fast";
import type {ChatAttachment} from "@/lib/chat-files";

export function wordCompletionRequest(prompt:string){
  const text=documentRequestText(prompt);
  if(/\b(?:chi (?:can )?(?:phan tich|nhan xet|gop y|goi y|tra loi|viet phan bo sung|soan trong chat)|khong (?:can )?(?:sua|chinh|xuat|tao|gui) (?:file|tep|word)|(?:analysis|feedback|suggestions?) only|do not (?:edit|create)|answer only in chat)\b/.test(text))return false;
  if(/^\s*(?:(?:hay|ban|please)\s+)*(?:cach|huong dan|lam sao|how to)\b/.test(text))return false;
  return /\b(?:hoan thien|hoan chinh|dien (?:tiep|vao)|bo sung|viet tiep|soan tiep|complete|finish|fill (?:in|out)|expand)\b/.test(text);
}

export function wordCompletionSource(prompt:string,catalog:ChatAttachment[],recent:ChatAttachment[],inputs:ChatAttachment[]=[],named:ChatAttachment[]=[]){
  if(!wordCompletionRequest(prompt))return undefined;
  const words=(files:ChatAttachment[])=>files.filter(f=>/\.docx$/i.test(f.name));
  const specified=words(named);if(specified.length)return specified.length===1?specified[0]:undefined;
  const uploaded=words(inputs);if(uploaded.length)return uploaded.length===1?uploaded[0]:undefined;
  const text=documentRequestText(prompt);
  if(/\b(?:file goc|tep goc|ban goc|original)\b/.test(text))return words(catalog).find(f=>f.kind!=="output");
  if(/\b(?:version|ban|v)\s*\d+\b/.test(text))return undefined;
  if(!words(recent).length&&!/\b(?:word|docx)\b/.test(text))return undefined;
  // A locally exported chat fragment is not a revision of the uploaded template.
  const candidates=words(recent).filter(f=>!f.sourceMessageId||f.sourceUrls?.length);
  if(candidates.length)return candidates.length===1?candidates[0]:undefined;
  return words(catalog).find(f=>f.kind!=="output"||f.sourceUrls?.length);
}

export const wordCompletionSchema=z.object({
  summary:z.string().max(1000),
  insertions:z.array(z.object({paragraphIndex:z.number().int().min(0),anchor:z.string().max(12000),paragraphs:z.array(z.string().min(1).max(6000)).min(1).max(40)})).max(40),
  fills:z.array(z.object({paragraphIndex:z.number().int().min(0),anchor:z.string().max(12000),text:z.string().min(1).max(12000)})).max(30),
});
export const wordCompletionFormat={type:"json_schema",name:"complete_original_word",strict:true,schema:{type:"object",additionalProperties:false,properties:{summary:{type:"string"},insertions:{type:"array",items:{type:"object",additionalProperties:false,properties:{paragraphIndex:{type:"integer"},anchor:{type:"string"},paragraphs:{type:"array",items:{type:"string"}}},required:["paragraphIndex","anchor","paragraphs"]}},fills:{type:"array",items:{type:"object",additionalProperties:false,properties:{paragraphIndex:{type:"integer"},anchor:{type:"string"},text:{type:"string"}},required:["paragraphIndex","anchor","text"]}}},required:["summary","insertions","fills"]}};

const decode=(text:string)=>text.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&").replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const escape=(text:string)=>text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const plain=(xml:string)=>[...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m=>decode(m[1])).join("");
const normalized=(value:string)=>value.normalize("NFC").replace(/\s+/g," ").trim();
const placeholders=/…+|\.{2,}|_{2,}|\[[^\]]{1,150}\]/g;

export function indexedWordParagraphs(source:ReturnType<typeof readEditableWord>){
  return [...source.xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((m,index)=>({index,text:plain(m[0])}));
}

export const wordCompletionInstruction="Complete the supplied original Word document IN PLACE using the indexed paragraphs, not a standalone answer or replacement document. Keep every original heading, existing text, tables, header/footer, signing area and personal-information fields. Add substantive, well-developed paragraphs under the appropriate existing headings and before the next section. Cover every aspect requested in each relevant source heading; match the document's voice and avoid padding/repetition. Do not duplicate an existing paragraph or invent new unrelated sections. For a specific requested section, complete that section while retaining the rest of the file. Use insertions anchored to an exact original paragraph index and its exact text. For blank personal fields use fills only when the user supplied the actual values; keep unknown values blank. A fill must retain all fixed labels and existing facts, changing only placeholders. Never invent an individual's name, birth date, achievements, scores, incidents, numbers or supporting references. Draft self-assessment wording for review without certifying unknown personal facts. Do not include chat introductions, follow-up questions, offers, Markdown fences or editorial instructions in document paragraphs. Use plain prose paragraphs rather than Markdown lists; put any essential review caveat in summary only. Empty insertions/fills are allowed only when the requested work is already present; say so in summary.";

export function completeWord(source:ReturnType<typeof readEditableWord>,plan:z.infer<typeof wordCompletionSchema>){
  const matches=[...source.xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
  const seen=new Set<string>(),existing=new Set(matches.map(m=>normalized(plain(m[0]))).filter(Boolean));
  const additions=new Map<number,string[]>(),fills=new Map<number,string>();
  const anchor=(index:number,text:string)=>{if(!matches[index]||normalized(plain(matches[index][0]))!==normalized(text))throw new Error("Word completion anchor does not match the original paragraph.");};
  for(const fill of plan.fills){
    anchor(fill.paragraphIndex,fill.anchor);
    if(fills.has(fill.paragraphIndex))throw new Error("Duplicate field-fill target.");
    const fixed=fill.anchor.split(placeholders).map(normalized).filter(Boolean);
    if(fixed.length===1&&fixed[0]===normalized(fill.anchor))throw new Error("Completion fills may change placeholders only.");
    let position=0;const value=normalized(fill.text);
    for(const part of fixed){const next=value.indexOf(part,position);if(next<0)throw new Error("A field fill removed an original label or fact.");position=next+part.length;}
    fills.set(fill.paragraphIndex,fill.text);
  }
  for(const insertion of plan.insertions){
    anchor(insertion.paragraphIndex,insertion.anchor);
    if(additions.has(insertion.paragraphIndex))throw new Error("Duplicate completion insertion target.");
    const paragraphs=insertion.paragraphs.map(text=>{
      const value=normalized(text);if(existing.has(value)||seen.has(value))throw new Error("Completion duplicates existing document content.");
      if(isAssistantDocumentFraming(text))throw new Error("Completion includes a chat question or assistant framing.");
      seen.add(value);return text;
    });
    additions.set(insertion.paragraphIndex,paragraphs);
  }
  let xml=source.xml;
  for(let i=matches.length-1;i>=0;i--){
    const original=matches[i][0];let paragraph=original;
    if(fills.has(i)){
      let wrote=false;
      paragraph=paragraph.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g,()=>{if(wrote)return '<w:t/>';wrote=true;return `<w:t xml:space="preserve">${escape(fills.get(i)!)}</w:t>`;});
      if(!wrote)throw new Error("Unable to fill a paragraph without text nodes.");
    }
    if(additions.has(i)){
      const rPr=original.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/)?.[0]?.replace(/<w:(?:b|bCs|i|iCs|u|color|highlight|vertAlign)\b[^>]*\/>/g,"")??"";
      paragraph+=additions.get(i)!.map(text=>`<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="both"/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`).join("");
    }
    xml=xml.slice(0,matches[i].index)+paragraph+xml.slice(matches[i].index!+original.length);
  }
  if(XMLValidator.validate(xml)!==true)throw new Error("Completed Word XML is invalid.");
  // Keep the original package: styles, tables, headers, footers, media and relationships.
  return zipSync({...source.files,"word/document.xml":strToU8(xml)},{level:6});
}

export function isAssistantDocumentFraming(text:string){
  const value=documentRequestText(text).replace(/[*_#>]/g,"").trim();
  return (/^(?:ban (?:co muon|muon|can)|neu ban (?:muon|can)|if you (?:want|would like))\b/.test(value)&&/\b(?:minh|toi|me|i can|i will)\b/.test(value))
    || /^(?:would you like me|do you want me|let me know|i can (?:also|help)|minh co the|toi co the (?:giup|soan|bo sung)|duoi day la (?:noi dung|ban du thao)|day la (?:noi dung|ban du thao))\b/.test(value)
    || /^(?:ban dang|ban hay|vui long (?:cho biet|cung cap))\b[\s\S]*\b(?:de (?:minh|toi)|minh (?:bo sung|soan)|toi (?:bo sung|soan))\b/.test(value)
    || /^ban nen (?:dieu chinh|kiem tra|ra soat)\b[\s\S]*\b(?:thuc te|ban than|ban kiem diem)\b/.test(value);
}

export function cleanWordExportBody(content:string){
  const blocks=content.trim().split(/\n\s*\n/);
  // Only trim conversational framing at the edges, never questions inside a form.
  while(blocks.length>1&&isAssistantDocumentFraming(blocks[0]))blocks.shift();
  while(blocks.length>1&&isAssistantDocumentFraming(blocks[blocks.length-1]))blocks.pop();
  return blocks.join("\n\n");
}

export function completionOutputRequested(prompt:string){
  const formats=outputExtensions(prompt);return !formats.length||(formats.length===1&&formats[0]===".docx");
}

export function wordCompletionIssues(original:Uint8Array,output:Uint8Array,preserveText=true){
  const read=(bytes:Uint8Array)=>{
    let expanded=0;
    const zip=unzipSync(bytes,{filter:entry=>{if(!/^word\/(?:document|header\d+|footer\d+)\.xml$/.test(entry.name))return false;expanded+=entry.originalSize;if(expanded>32*1024**2)throw new Error("Word preservation check exceeds its size budget.");return true;}});
    const body=strFromU8(zip["word/document.xml"]??new Uint8Array());
    if(!body)throw new Error("Word body is missing.");
    return {body,paragraphs:[...body.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(m=>normalized(plain(m[0]))).filter(Boolean),furniture:Object.entries(zip).filter(([name])=>/header|footer/.test(name)).flatMap(([,xml])=>[...strFromU8(xml).matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(m=>normalized(plain(m[0])))).filter(t=>t.length>3)};
  };
  const before=read(original),after=read(output),issues:string[]=[];
  if((after.body.match(/<w:tbl\b/g)??[]).length<(before.body.match(/<w:tbl\b/g)??[]).length)issues.push("The completed document lost an original table.");
  for(const text of before.furniture)if(!after.furniture.some(p=>p.includes(text)))issues.push("The completed document lost original header/footer text.");
  if(preserveText)for(const text of before.paragraphs){
    const fixed=text.split(placeholders).map(normalized).filter(Boolean);
    if(!after.paragraphs.some(paragraph=>{
      let at=0;for(const segment of fixed){const next=paragraph.indexOf(segment,at);if(next<0)return false;at=next+segment.length;}return true;
    }))issues.push("The completion lost an original paragraph, heading or field label; restore the full original content around the requested additions.");
  }
  return [...new Set(issues)].slice(0,4);
}
