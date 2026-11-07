import {affirmativeDocumentRequest,documentRequestText,outputExtensions} from "@/lib/document-request";

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
export function spreadsheetOperation(prompt: string) {
  const text = documentRequestText(prompt);
  if (/^\s*(?:(?:hay|vui long|please)\s+)?(?:cach|huong dan|lam sao|how (?:to|do|can)|explain how)\b/.test(text)) return null;
  if (/\b(?:sap (?:xep|theo|thu tu)|xep (?:theo|lai|tu|danh sach|tuoi)|sort(?:ing)?|reorder|tang dan|giam dan|ascending|descending|tu (?:cao|thap) (?:xuong|len))\b/.test(text)) return "sort";
  if (/\b(?:loc|filter(?:ing)?|khu trung|(?:bo|xoa|loai bo) (?:dong )?trung|deduplicat(?:e|ion))\b/.test(text)) return "filter";
  if (/\b(?:phan tich|du lieu|xep hang|thong ke|nhom theo|dem|bao nhieu|top|cao tuoi nhat|tre tuoi nhat|lon nhat|nho nhat|analy[sz]\w*|data|rank\w*|count|group by|oldest|youngest|highest|lowest)\b/.test(text)) return "read";
  return null;
}

export function isSpreadsheetRetry(prompt: string) {
  return /^(?:(?:hay|vui long|please)\s+)?(?:lam lai|thu lai|chay lai|retry|try again|redo)(?:\s+(?:cho toi|giup toi|nhe|di|please|it))*[.!?]*$/.test(documentRequestText(prompt).trim());
}

export function wantsSpreadsheetFile(prompt: string, operation: ReturnType<typeof spreadsheetOperation>) {
  if (operation !== "sort" && operation !== "filter") return false;
  return !/\b(?:chi (?:can )?(?:liet ke|tra loi|hien thi)|tra loi trong chat|cho (?:toi )?biet|khong (?:can )?(?:xuat|tao) (?:them )?(?:file|tep|excel|xlsx|csv)|(?:answer|show|list) (?:only )?in chat|(?:no|without|do not create) (?:an? )?(?:file|spreadsheet))\b/.test(documentRequestText(prompt));
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
  return /\b(chuyen|convert|xuat|export|render|tao|lap|lam|sua|chinh|cap nhat|modify|edit|generate|create|make)\b.{0,70}\b(file|tep|pdf|word|docx|excel|xlsx|csv|powerpoint|pptx|bao cao|report)\b/.test(prompt)
    || /\b(?:cho (?:toi|minh|em|anh)|send me|give me)\s+(?:mot\s+|an?\s+|the\s+)?(?:file|tep)\s+(?:pdf|word|docx|excel|xlsx|csv|powerpoint|pptx)\b/.test(prompt);
}
export const requestedExtensions=outputExtensions;
export function isImageGeneration(prompt: string) {
  return /(?:tạo|vẽ|render|generate|draw|create).{0,25}(?:hình ảnh|bức ảnh|bức tranh|chân dung|image|portrait|picture|illustration)/i.test(prompt)
    && !/pdf|docx|pptx|xlsx|slide|chart|biểu đồ|tài liệu/i.test(prompt);
}
export function fastWordMode(prompt:string,documents:Array<{name:string}>,compute:boolean,web:boolean):"create"|"edit"|null {
  const formats=requestedExtensions(prompt);
  if(!formats.length && documents.length===1 && /\.docx$/i.test(documents[0].name) && /thay|đổi|replace|change|sửa lỗi|chính tả/i.test(prompt))formats.push(".docx");
  if(compute||web||formats.length!==1||formats[0]!==".docx"||/macro|tracked|track changes|theo dõi thay đổi|chuyển đổi|convert|mẫu gốc|template|logo|hình ảnh|Nghị định|NĐ.?30|thể thức|căn lề|font/i.test(prompt))return null;
  if(!documents.length)return "create";
  if(documents.length===1 && /\.docx$/i.test(documents[0].name) && /thay|đổi|replace|change|sửa lỗi|chính tả/i.test(prompt))return "edit";
  return null;
}
export function isDocumentEditFollowup(prompt:string,hasDocuments:boolean){
  return hasDocuments && (/(?:sửa|chỉnh sửa|cập nhật|thay|đổi).{0,40}(?:file|tệp|tài liệu|tên|vị trí|nội dung|tiêu đề|lương|số lượng|đơn giá)|\b(edit|modify|update|replace)\b/i.test(prompt) || /^(?:hãy\s+)?(?:đổi|thay)\s+.{1,80}\s+(?:thành|sang|bằng)/i.test(prompt));
}
