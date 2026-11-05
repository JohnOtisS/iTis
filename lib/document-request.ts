// Interpret output requirements separately from input filenames and intermediate files.
export function documentRequestText(value:string){
  return value.normalize("NFD").replace(/\p{M}/gu,"").replace(/[đĐ]/g,"d").toLowerCase()
    .replace(/\b(?:wodr|wrod|wor[dđ])\b/g,"word")
    .replace(/\b((?:file|tep|ban|xuat|export|sang|thanh|into|to)\s+)\b(?:exce|excell|exel|excle)\b/g,"$1excel")
    .replace(/\b((?:xuat|export|chuyen|convert)(?:\s+(?:ra|sang|thanh|ban|file|tep))*)\s+w\b/g,"$1 word");
}
export function outputExtensions(prompt:string){
  let text=documentRequestText(prompt);
  // Remove negative output clauses, not the affirmative request that follows them.
  text=text.replace(/\b(?:khong(?: can)?|no|without|do not|don't)\s+(?:(?:xuat|tao|export|create|generate)\s+)?(?:(?:file|tep|ban)\s+)?(?:word|docx|pdf|excel|xlsx|csv|powerpoint|pptx|txt|text|markdown)\b(?:\s+(?:va|hay|hoac|or|and)\s+(?:word|docx|pdf|excel|xlsx|csv|powerpoint|pptx|txt|text|markdown)\b)*/g,"");
  text=text.replace(/(?:khong[^.!?\n]*(?:tai lai|upload|attach|dinh kem)[^.!?\n]*)/g,"");
  const action=text.search(/\b(?:tao|create|generate|xuat|export|chuyen|convert|sua|edit)\b/);
  if(action>=0)text=text.slice(action);
  const conversion=[...text.matchAll(/\b(?:sang|thanh|to|into)\s+(?:(?:file|tep|ban|a|an|the)\s+)?(?=pdf\b|word\b|docx\b|excel\b|xlsx\b|csv\b|powerpoint\b|pptx\b|txt\b|markdown\b)/g)].at(-1);
  if(conversion?.index!==undefined)text=text.slice(conversion.index);
  text=text.split(/\b(?:tu file|tu tep|dua tren|based on|from (?:the )?(?:file|document))\b/)[0];
  const map:Array<[string,RegExp]>=[[".xlsx",/\b(?:xlsx|excel)\b/],[".docx",/\b(?:docx|word)\b/],[".pptx",/\b(?:pptx|powerpoint|slides?)\b/],[".pdf",/\bpdf\b/],[".csv",/\bcsv\b/],[".zip",/\bzip\b/],[".txt",/\btxt\b/],[".md",/\b(?:markdown|md)\b/],[".json",/\bjson\b/]];
  return map.filter(([,pattern])=>pattern.test(text)).map(([extension])=>extension);
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
  const from=text.match(/\b(?:tu (?:file|tep|tai lieu)|from (?:the )?(?:file|document))\b([\s\S]*)/);
  if(from)return from[1].split(/\b(?:xuat|export|chuyen|convert|tao|create)\b/)[0];
  return text.split(/\b(?:sang|into|to|xuat|export)\b/)[0];
}
export function needsFullDocumentReview(prompt:string,count:number){
  return count>0&&/toan bo|tat ca|day du|full review|every (?:row|sheet|page)|exhaustive/.test(documentRequestText(prompt))
    || count>1&&/phan tich|doi chieu|so sanh|tong hop|\bloc\b|trung khop|analy[sz]|compare|reconcile|synthesi[sz]|\bfilter\b/.test(documentRequestText(prompt));
}
export function sourceCoverageIssues(sources:unknown,documents:Array<{name:string}>){
  const normalized=(s:string)=>s.split(/[\\/]/).pop()!.normalize("NFC").trim().toLowerCase();
  const covered=new Set(Array.isArray(sources)?sources.filter((s):s is string=>typeof s==="string").map(normalized):[]);
  const missing=documents.filter(f=>!covered.has(normalized(f.name)));
  return missing.length?[`Executed checks must include every supplied document. Missing sources: ${missing.map(f=>f.name).join(", ")}.`]:[];
}
