import {affirmativeDocumentRequest,deliveryTarget,documentRequestText,outputExtensions} from "@/lib/document-request";

export function needsWebSearch(prompt: string) {
  const text = documentRequestText(prompt).replace(/`[^`]*`|"[^"]*"|“[^”]*”/g, " ");
  if (/\b(?:khong (?:can )?(?:tra cuu|tim (?:kiem )?(?:web|tren mang)|dung (?:web|internet))|(?:do not|don't|without) (?:use the web|search(?: the web)?|brows(?:e|ing))|(?:chi|only) (?:dua vao (?:tep|file)|use (?:the )?attached (?:file|documents?)))\b/.test(text)) return false;
  if (/\b(?:tra cuu|tim(?: kiem)?|kiem chung|xac minh|search|browse|check|verify|sources?)\b[^.!?\n]{0,50}\b(?:web|internet|online|tren mang)\b|\b(?:fact[ -]?check|look\s*up|nguon chinh thuc|official sources?)\b/.test(text)) return true;
  if (/^\s*(?:(?:hay|ban|please)\s+)*(?:viet|soan|dich|sua|chinh sua|write|draft|translate|edit)\b/.test(text)) return false;
  if (/\b(?:trong (?:file|tep|tai lieu) (?:dinh kem|vua gui)|in the attached (?:file|document|spreadsheet))\b/.test(text)) return false;

  return /https?:\/\/|\b(?:tra cuu|moi nhat|hom nay|hien tai|bay gio|tin tuc|latest|today|news|currently|current (?:president|ceo|price|version|status|weather|law|rules?|regulations?))\b/.test(text)
    || (!/\b(?:la gi|nghia la gi|what (?:is|does) .{1,40} mean)\b/.test(text) && /\b(?:gia vang|gia xang|ti gia|ty gia|thoi tiet|exchange rate|gold price|weather forecast)\b/.test(text))
    || /\b(?:ra mat|ra|mo ban|phat hanh|cap nhat|con hieu luc|con hoat dong)\s+chua\b|\b(?:ai (?:dang la|giu chuc)|who (?:is|runs) the (?:president|ceo|prime minister)|(?:released|available) yet|still in effect)\b/.test(text)
    || /\b(?:gia|price|so sanh|khac nhau|compare|difference between)\b[^.!?\n]{0,100}\b(?:iphone|ipad|galaxy|pixel|macbook)\s*\d/.test(text);
}
export function needsComputation(prompt: string, hasDocuments = false) {
  return /\b(calculate|reconcile|variance|sum|formula|statistics|forecast|audit)\b|tính (?:tổng|toán|thuế|lãi)|công thức|đối chiếu|chênh lệch|thống kê|dự báo|kiểm toán/i.test(prompt)
    || (hasDocuments && /\b(vat|total|quantity|amount)\b|tổng|số lượng|thành tiền|doanh thu/i.test(prompt));
}
export function canDraftFromOriginalFiles(prompt: string, documents: Array<{name:string;size?:number}>, artifact: boolean, spreadsheetTask: unknown) {
  const text = documentRequestText(prompt);
  return !artifact && !spreadsheetTask && documents.length>0
    && documents.every(file=>/\.(pdf|docx|txt|md)$/i.test(file.name))
    && documents.every(file=>typeof file.size==="number" && file.size>0)
    && documents.reduce((sum,file)=>sum+(file.size??0),0)<50*1024*1024
    && !needsComputation(prompt,true)
    && /\b(?:soan|viet|tong hop|tom tat|draft|write|synthesi[sz]e|summari[sz]e)\b/.test(text);
}
export {spreadsheetOperation,wantsSpreadsheetFile} from "@/lib/spreadsheet-policy";

export function isSpreadsheetRetry(prompt: string) {
  return /^(?:(?:hay|vui long|please)\s+)?(?:lam lai|thu lai|chay lai|retry|try again|redo)(?:\s+(?:cho toi|giup toi|nhe|di|please|it))*[.!?]*$/.test(documentRequestText(prompt).trim());
}

export function chatResponseTokenLimit(prompt: string, history: Array<{role:string;content:string}>, model:string) {
  const drafting = /\b(?:soan|viet|tao|write|draft|create)\b.{0,100}\b(?:de thi|de kiem tra|bai kiem tra|giao an|bao cao|ke hoach|exam|test paper|lesson plan|report|proposal)\b/;
  const text = documentRequestText(prompt);
  const longDraft = drafting.test(text) || (prompt.length <= 140 &&
    history.filter(row=>row.role==="user").slice(-8).some(row=>drafting.test(documentRequestText(row.content))));
  return longDraft ? 6000 : model === "gpt-6.1-sol" ? 2500 : 1000;
}
export function needsDocumentOutput(prompt: string) {
  prompt = affirmativeDocumentRequest(prompt);
  if (deliveryPhrase(prompt)) return true;
  return /\b(chuyen|convert|xuat|export|render|tao|lap|lam|sua|chinh|cap nhat|modify|edit|generate|create|make)\b.{0,70}\b(file|tep|pdf|word|docx|excel|xlsx|xlsm|csv|tsv|powerpoint|pptx|bao cao|report)\b/.test(prompt)
    || /\b(?:cho (?:toi|minh|em|anh)|send me|give me)\s+(?:mot\s+|an?\s+|the\s+)?(?:file|tep)\s+(?:pdf|word|docx|excel|xlsx|xlsm|csv|tsv|powerpoint|pptx)\b/.test(prompt);
}
function deliveryPhrase(text: string) {
  if (/^\s*(?:(?:hay|ban|please)\s+)*(?:cach|huong dan|lam sao|how (?:to|do|can))\b/.test(text)) return false;
  if (/\b(?:khong (?:can|muon)|dung|do not|don't)\s+(?:ban hanh|gui|in)\b/.test(text)) return false;
  return deliveryTarget.test(text);
}
export function isDocumentDeliveryFollowup(prompt: string) {
  const text=documentRequestText(prompt).trim();
  return /^(?:(?:ban|hay|vui long|please)\s+)*(?:ban hanh|(?:gui|cho) (?:lai )?(?:cho )?(?:toi|minh|anh|em) tai(?: xuong| ve)|tai xuong|download)\b(?:\s+(?:ra|cho|toi|minh|em|anh|giup|de|tai|xuong|ve|nhe|di|voi|it|please))*[.!?]*$/.test(text);
}
export function downloadFormatFromContext(prompt: string, previousUserRequests: string[]) {
  if (!isDocumentDeliveryFollowup(prompt)) return [];
  const previous=previousUserRequests.findLast(value=>!/^(?:ok(?:ay)?|duoc|dong y|vang|yes|uh|u)[.!?]*$/.test(documentRequestText(value).trim()));
  return previous && needsDocumentOutput(previous) ? outputExtensions(previous) : [];
}
export function isDocumentTaskFollowup(prompt: string) {
  const text = documentRequestText(prompt).trim();
  if (/\b(?:khong (?:can )?(?:xuat|tao)|chi tra loi|chi phan tich|do not create|answer only)\b/.test(text)) return false;
  return /^(?:(?:ban|hay|vui long|please)\s+)*(?:lam lai|thu lai|tiep tuc|lam tiep|sua lai|chinh lai|dien(?: them| day du)?|bo sung|cap nhat|retry|try again|continue|redo|update)\b/.test(text)
    || /^(?:ten (?:ubnd|co quan)|ubnd (?:phuong|xa)|nguoi ky|co quan ban hanh)\b/.test(text);
}

export function documentTaskFromContext(prompt: string, previousUserRequests: string[]) {
  if (!isDocumentTaskFollowup(prompt) || outputExtensions(prompt).length) return null;
  const relevant: string[] = [];
  for (const request of [...previousUserRequests].reverse()) {
    const formats = outputExtensions(request);
    if (needsDocumentOutput(request) && formats.length) {
      return [request,...relevant.reverse(),prompt].join("\n");
    }
    if (!isDocumentTaskFollowup(request) && !/^(?:ok|duoc|yes)[.!?]*$/.test(documentRequestText(request).trim())) return null;
    relevant.push(request);
  }
  return null;
}
export const requestedExtensions=outputExtensions;
export function isWordFieldEdit(prompt: string) {
  return /^(?:(?:hay|vui long|please)\s+)?(?:dien(?: them| lai)?|bo sung|cap nhat|fill in|insert|update)\s+(?:truong |muc )?(?:so (?:van ban|ke hoach|hieu)|ngay (?:ky|ban hanh)|(?:ten )?nguoi ky|document number|signing date|signer)\b/.test(documentRequestText(prompt).trim());
}
export function isImageGeneration(prompt: string) {
  return /(?:tạo|vẽ|render|generate|draw|create).{0,25}(?:hình ảnh|bức ảnh|bức tranh|chân dung|image|portrait|picture|illustration)/i.test(prompt)
    && !/pdf|docx|pptx|xlsx|slide|chart|biểu đồ|tài liệu/i.test(prompt);
}
export function fastWordMode(prompt:string,documents:Array<{name:string}>,compute:boolean,web:boolean):"create"|"edit"|null {
  const formats=requestedExtensions(prompt);
  const textEdit = isWordFieldEdit(prompt) || /thay|đổi|replace|change|sửa lỗi|chính tả/i.test(prompt);
  if(!formats.length && documents.length===1 && /\.docx$/i.test(documents[0].name) && textEdit)formats.push(".docx");
  if(compute||web||formats.length!==1||formats[0]!==".docx"||/macro|tracked|track changes|theo dõi thay đổi|chuyển đổi|convert|mẫu gốc|template|logo|hình ảnh|Nghị định|NĐ.?30|thể thức|căn lề|font/i.test(prompt))return null;
  if(!documents.length)return /\b(?:ke hoach|van ban|chi dao)\s+(?:cua\s+)?(?:tinh|ubnd tinh)\b|\bprovincial (?:plan|directive)\b/.test(documentRequestText(prompt)) ? null : "create";
  if(documents.length===1 && /\.docx$/i.test(documents[0].name) && textEdit)return "edit";
  return null;
}
export function isTerraWordCandidate(prompt: string, documents: Array<{name:string}>, compute: boolean, web: boolean) {
  const text = documentRequestText(prompt);
  if (compute || web || /\b(?:doi chieu|so sanh|tinh toan|ocr|scan(?:ned)?|pdf quet|giu nguyen bo cuc|keep (?:the )?(?:layout|formatting)|legal analysis|phan tich phap ly)\b/.test(text)) return false;
  if (fastWordMode(prompt, documents, compute, web) === "edit") return true;
  const formats = outputExtensions(prompt);
  return formats.length === 1 && formats[0] === ".docx"
    && documents.length >= 1 && documents.length <= 3
    && documents.every(file => /\.pdf$/i.test(file.name))
    && !/\b(?:chuyen(?: doi)?|convert)\b/.test(text);
}
export function isDocumentEditFollowup(prompt:string,hasDocuments:boolean){
  return hasDocuments && (/(?:sửa|chỉnh sửa|cập nhật|thay|đổi).{0,40}(?:file|tệp|tài liệu|tên|vị trí|nội dung|tiêu đề|lương|số lượng|đơn giá)|\b(edit|modify|update|replace)\b/i.test(prompt) || /^(?:hãy\s+)?(?:đổi|thay)\s+.{1,80}\s+(?:thành|sang|bằng)/i.test(prompt));
}
