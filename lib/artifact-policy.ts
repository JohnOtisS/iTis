import {documentRequestText} from "@/lib/document-request";
// Deterministic intent resolution. Ambiguous sources must never trigger a paid guess.
export function normalizedReference(value: string) {
  return documentRequestText(value).replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
}
export function documentKind(value: string) {
  const text=normalizedReference(value);
  const matches=([[/\bke hoach\b/,"plan"],[/\bcong van\b/,"letter"],[/\bbao cao\b/,"report"]] as const).map(([re,kind])=>({kind,at:text.search(re)})).filter(m=>m.at>=0).sort((a,b)=>a.at-b.at);
  return matches[0]?.kind??null;
}

export function isBlockedArtifactSource(content: string) {
  const opening = normalizedReference(content.slice(0, 500)).replace(/^[#>*_\s]+/, "");
  return /^(?:(?:toi|minh|i|we) )?(?:chua the|khong the|cannot|can't|could not|couldn't|(?:am|are) unable to|unable to) (?:xuat|tao|lap|loc|doi chieu|hoan tat|hoan thanh|export|create|generate|complete|produce|finish)\b/.test(opening)
    || /^(?:chua du|thieu) (?:du lieu|thong tin|tai lieu)\b/.test(opening);
}
export function localArtifactIntent(prompt: string): "resend"|"export"|null {
  const text=normalizedReference(prompt);
  // These requests change content, compute, research, or require a particular layout.
  if (/\b(sua|chinh|cap nhat|thay|them|chen|xoa|bo sung|rut gon|sap xep|tom tat|phan tich|dich|tinh|soan|viet|edit|delete|insert|append|change|update|replace|summari\w*|analy\w*|translate|calculate|draft|rewrite)\b/.test(text)
    || /ghi nho|bo nho|remember|memory|forget|quen|sang tieng|into (?:english|vietnamese)|dinh dang lai|nghi dinh|nd\s*30|the thuc|van phong|font|can le|mau goc|template|tracked|logo|hinh anh|khong\s+(?:can\s+)?(?:xuat|gui)|do not|don't/.test(text)) return null;
  if (/gui lai|tai lai|resend|send .{0,40}again|download/.test(text) && /file|tep|word|pdf|excel|docx|xlsx|pptx|tai lieu|ban vua/.test(text)) return "resend";
  if(/pdf|excel|xlsx|pptx|powerpoint|csv/.test(text))return null;
  return /\b(xuat|export|chuyen|convert)\b/.test(text) && /word|docx|\.txt\b|markdown|\.md\b/.test(text)?"export":null;
}

export function resolveFileReference<T extends {name:string;url:string;family?:string;version?:number;kind?:string}>(files:T[],prompt:string) {
  const text=normalizedReference(prompt);
  const named=files.filter(f=>text.includes(normalizedReference(f.name))||(normalizedReference(f.name.replace(/\.[^.]+$/,"")).length>=5&&text.includes(normalizedReference(f.name.replace(/\.[^.]+$/,"")))));
  const kind=documentKind(prompt);
  const formats=[/word|docx/.test(text)?"docx":null,/excel|xlsx/.test(text)?"xlsx":null,/powerpoint|pptx/.test(text)?"pptx":null,/\bpdf\b/.test(text)?"pdf":null].filter(Boolean);
  const version=prompt.match(/\bv(?:ersion)?\s*(\d+)|bản\s+(\d+)/i);
  let candidates=named.length?named:kind?files.filter(f=>documentKind(f.name)===kind):files;
  if(formats.length)candidates=candidates.filter(f=>formats.some(ext=>f.name.toLowerCase().endsWith("."+ext)));
  if(version)candidates=candidates.filter(f=>(f.version??1)===Number(version[1]??version[2]));
  if(/file goc|tep goc|original|source file/.test(text))candidates=candidates.filter(f=>f.kind==="input");
  const latest=new Map<string,T>();
  for(const file of candidates){const key=`${file.family??file.name.toLowerCase()}:${file.name.split('.').pop()}`;const old=latest.get(key);if(!old||(file.version??1)>(old.version??1))latest.set(key,file);}
  candidates=[...latest.values()];
  // Explicit plural requests can return multiple files; singular requests must be unique.
  const plural=/tat ca|cac file|cac tep|all files/.test(text);
  return {files:candidates,ambiguous:candidates.length>1&&!plural};
}
