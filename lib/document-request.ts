// Interpret output requirements separately from input filenames and intermediate files.
const sourceClause = /\b(?:tu (?=file\b|tep\b|tai lieu\b|word\b|docx\b|excel\b|xlsx\b|pdf\b|pptx\b|powerpoint\b|csv\b)|dua tren\b|theo mau\b|based on\b|from (?=(?:the )?(?:file|document|word|docx|excel|xlsx|pdf|pptx|powerpoint|csv)\b))/;
const conversionTarget = /\b(?:sang|thanh|to|into)\s+(?:(?:file|tep|ban|mot|a|an|the)\s+)*(?=pdf\b|word\b|docx\b|excel\b|xlsx\b|csv\b|powerpoint\b|pptx\b|txt\b|markdown\b)/;
export const deliveryTarget = /\b(?:ban hanh(?:\s+(?:cho (?:toi|minh|em|anh)))?|ra|gui(?: (?:cho )?(?:toi|minh|em|anh))?|cho (?:toi|minh|em|anh)|send me|give me)\s+(?:(?:ra|sang|thanh|mot|a|an|ban|file|tep|version)\s+)*\.?(?:word|docx|pdf|excel|xlsx|csv|powerpoint|pptx)\b/;
export function documentRequestText(value:string){
  return value.normalize("NFD").replace(/\p{M}/gu,"").replace(/[đĐ]/g,"d").toLowerCase()
    .replace(/\b(?:wold|wodr|wrod|wor[dđ])\b/g,"word")
    .replace(/\b((?:xuat|export|chuyen|convert)(?:\s+(?:ra|sang|thanh|ban|file|tep))*)\s+\.?doc\b/g,"$1 word")
    .replace(/\b((?:file|tep|ban|phai|xuat|export|sang|thanh|into|to)\s+)\b(?:exce|excell|exel|excle|xcell|xceell|xcel)\b/g,"$1excel")
    .replace(/\b((?:xuat|export|chuyen|convert)(?:\s+(?:ra|sang|thanh|ban|file|tep))*)\s+w\b/g,"$1 word");
}
export function outputExtensions(prompt:string){
  let text=affirmativeDocumentRequest(prompt);
  // A final export after an edit identifies the deliverable, even if the edit
  // mentions a different source format.
  const exportStep=text.search(/(?:\b(?:roi|sau do|then)\b|[,;.!?\n])\s*(?:hay\s+)?(?:xuat|export|ban hanh)\b/);
  if(exportStep>=0&&!/\b(?:xuat|export|ban hanh)\b/.test(text.slice(0,exportStep)))text=text.slice(exportStep);
  const action=text.search(/\b(?:tao|create|generate|xuat|export|ban hanh|chuyen|convert|sua|edit)\b/);
  if(action>=0)text=text.slice(action);
  text=text.split(sourceClause)[0];
  const conversion=text.search(conversionTarget);
  if(conversion>=0)text=text.slice(conversion);
  const map:Array<[string,RegExp]>=[[".xlsx",/\b(?:xlsx|excel)\b/],[".docx",/\b(?:docx|word)\b/],[".pptx",/\b(?:pptx|powerpoint|slides?)\b/],[".pdf",/\bpdf\b/],[".csv",/\bcsv\b/],[".zip",/\bzip\b/],[".txt",/\btxt\b/],[".md",/\b(?:markdown|md)\b/],[".json",/\bjson\b/]];
  return map.filter(([,pattern])=>pattern.test(text)).map(([extension])=>extension);
}
export function affirmativeDocumentRequest(prompt:string){
  return documentRequestText(prompt)
    .replace(/\b(?:khong(?: can)?|no|without|do not|don't)\s+(?:(?:xuat|tao|render|export|create|generate)\s+)?(?:(?:file|tep|ban|any)\s+)*(?:word|docx|pdf|excel|xlsx|csv|powerpoint|pptx|txt|text|markdown|files?|tep)\b(?:\s+(?:va|hay|hoac|or|and)\s+(?:word|docx|pdf|excel|xlsx|csv|powerpoint|pptx|txt|text|markdown)\b)*/g,"")
    .replace(/(?:khong[^.!?\n]*(?:tai lai|upload|attach|dinh kem)[^.!?\n]*)/g,"");
}
export function deliverableExtensions(prompt:string,documents:Array<{name:string}>=[]){
  const explicit=outputExtensions(prompt);
  if(explicit.length)return explicit;
  const source=[...new Set(documents.map(f=>f.name.toLowerCase().match(/\.(docx|xlsx|pptx|pdf|csv|txt|md)$/)?.[0]).filter((s):s is string=>Boolean(s)))];
  return source.length===1?source:[];
}
export function isRequestedDeliverable(name:string,extensions:string[]){
  const base=name.split(/[\\/]/).pop()!.toLowerCase();
  if(base==="itis-validation.json")return false;
  return extensions.length?extensions.some(ext=>base.endsWith(ext)):/\.(docx|xlsx|pptx|pdf|csv|zip|txt|md|json)$/.test(base);
}
export function deliverableInstruction(extensions:string[]){
  return extensions.length?`Deliver ONLY these requested output formats: ${extensions.join(", ")}. Do not generate extra formats, PDF previews, OCR dumps or debug exports unless necessary internally; never cite internal files. Return file citations only, plus at most one short essential caveat. Do not repeat the document text in chat.`:"Return only the requested final deliverables, never intermediate OCR/debug/validation files. Do not repeat the document text in chat.";
}
export function sourceFormatText(prompt:string){
  const text=documentRequestText(prompt);
  const from=sourceClause.exec(text);
  // An edit can name one source before the reference clause and another after.
  // Only skip the earlier text when it states an output before its sources.
  const outputBeforeSource=from&&(/\b(?:xuat|export|tao|create|generate)\b/.test(text.slice(0,from.index)) || deliveryTarget.test(text.slice(0,from.index)));
  const source=from&&outputBeforeSource?text.slice(from.index+from[0].length):text;
  const beforeExport=source.split(/\b(?:xuat|export)\b/)[0].split(deliveryTarget)[0];
  const beforeCreation=from?beforeExport.split(/\b(?:chuyen|convert|tao|create)\b/)[0]:beforeExport;
  return beforeCreation.split(conversionTarget)[0];
}
export function needsFullDocumentReview(prompt:string,count:number){
  if(count===0)return false;
  const text=documentRequestText(prompt);
  return /toan bo|tat ca|day du|full review|(?:every|all) (?:rows?|sheets?|pages?|slides?|sections?)|exhaustive/.test(text)
    || /\b(?:(?:trang|page|slide)\s+\d+|header|footer|dau trang|chan trang|footnotes?|chu thich cuoi trang|speaker notes|ghi chu thuyet trinh|bo cuc|layout|pdf quet|scanned|ocr)\b/.test(text)
    || count>1&&/phan tich|doi chieu|so sanh|tong hop|\bloc\b|trung khop|analy[sz]|compare|reconcile|synthesi[sz]|\bfilter\b/.test(text);
}
export function sourceCoverageIssues(sources:unknown,documents:Array<{name:string}>){
  const normalized=(s:string)=>s.split(/[\\/]/).pop()!.normalize("NFC").trim().toLowerCase();
  const covered=new Set(Array.isArray(sources)?sources.filter((s):s is string=>typeof s==="string").map(normalized):[]);
  const missing=documents.filter(f=>!covered.has(normalized(f.name)));
  return missing.length?[`Executed checks must include every supplied document. Missing sources: ${missing.map(f=>f.name).join(", ")}.`]:[];
}
export function documentSourceLabels(documents:Array<{name:string;version?:number}>){
  const counts = new Map<string,number>();
  const key = (name:string) => name.normalize("NFC").toLowerCase();
  for(const file of documents)counts.set(key(file.name),(counts.get(key(file.name))??0)+1);
  return documents.map((file,index)=>(counts.get(key(file.name))??0)>1
    ? `Source ${index+1} (v${file.version??1}): ${file.name}`
    : file.name);
}
