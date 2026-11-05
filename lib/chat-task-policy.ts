import {documentRequestText,outputExtensions} from "@/lib/document-request";
export function needsComputation(prompt: string, hasDocuments = false) {
  return /\b(calculate|reconcile|variance|sum|formula|statistics|forecast|audit)\b|tính (?:tổng|toán|thuế|lãi)|công thức|đối chiếu|chênh lệch|thống kê|dự báo|kiểm toán/i.test(prompt)
    || (hasDocuments && /\b(vat|total|quantity|amount)\b|tổng|số lượng|thành tiền|doanh thu/i.test(prompt));
}
export function needsDocumentOutput(prompt: string) {
  prompt = documentRequestText(prompt).replace(/khong\s+(?:can\s+)?(?:xuat|tao|render)\s+(?:file|tep)|do not\s+(?:create|export|generate)\s+(?:any\s+)?files?/gi, "");
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
