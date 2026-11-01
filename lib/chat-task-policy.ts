export function needsComputation(prompt: string, hasDocuments = false) {
  return /\b(calculate|reconcile|variance|sum|formula|statistics|forecast|audit)\b|tính (?:tổng|toán|thuế|lãi)|công thức|đối chiếu|chênh lệch|thống kê|dự báo|kiểm toán/i.test(prompt)
    || (hasDocuments && /\b(vat|total|quantity|amount)\b|tổng|số lượng|thành tiền|doanh thu/i.test(prompt));
}
export function needsDocumentOutput(prompt: string) {
  prompt = prompt.replace(/không\s+(?:cần\s+)?(?:xuất|tạo|render)\s+(?:file|tệp)|do not\s+(?:create|export|generate)\s+(?:any\s+)?files?/gi, "");
  return /(chuyển|convert|xuất|export|render|tạo|làm|sửa|chỉnh|cập nhật|modify|edit|generate).{0,70}(file|tệp|pdf|word|docx|excel|xlsx|csv|powerpoint|pptx|báo cáo|report)|(file|tệp).{0,45}(pdf|word|docx|excel|xlsx|csv|powerpoint|pptx)/i.test(prompt);
}
export function requestedExtensions(prompt: string) {
  // Source formats are not output requirements (e.g. CSV -> four Office files).
  prompt = prompt.replace(/(?:không|do not|don't)[^.!?\n]*(?:tải lại|upload|attach|đính kèm|xuất|export|tạo|create)[^.!?\n]*/gi, "");
  const action = prompt.search(/tạo|create|generate|xuất|export|chuyển|convert|sửa|edit/i);
  let target = action >= 0 ? prompt.slice(action) : prompt;
  const conversion = target.match(/(?:sang|thành|\bto\b|into)\s+(?:(?:file|tệp|a|an|the)\s+)?(?:pdf|word|docx|excel|xlsx|csv|powerpoint|pptx)/i);
  if (conversion?.index !== undefined) target = target.slice(conversion.index);
  const map: Array<[string, RegExp]> = [[".xlsx",/xlsx|excel/i],[".docx",/docx|word/i],[".pptx",/pptx|powerpoint|slide/i],[".pdf",/\bpdf\b/i],[".csv",/\bcsv\b/i],[".zip",/\bzip\b/i]];
  return map.filter(([,pattern]) => pattern.test(target)).map(([extension]) => extension);
}
export function isImageGeneration(prompt: string) {
  return /(?:tạo|vẽ|render|generate|draw|create).{0,25}(?:hình ảnh|bức ảnh|bức tranh|chân dung|image|portrait|picture|illustration)/i.test(prompt)
    && !/pdf|docx|pptx|xlsx|slide|chart|biểu đồ|tài liệu/i.test(prompt);
}
export function fastWordMode(prompt:string,documents:Array<{name:string}>,compute:boolean,web:boolean):"create"|"edit"|null {
  const formats=requestedExtensions(prompt);
  if(!formats.length && documents.length===1 && /\.docx$/i.test(documents[0].name) && /thay|đổi|replace|change|sửa lỗi|chính tả/i.test(prompt))formats.push(".docx");
  if(compute||web||formats.length!==1||formats[0]!==".docx"||/macro|tracked|track changes|theo dõi thay đổi|chuyển đổi|convert|mẫu gốc|template|logo|hình ảnh/i.test(prompt))return null;
  if(!documents.length)return "create";
  if(documents.length===1 && /\.docx$/i.test(documents[0].name) && /thay|đổi|replace|change|sửa lỗi|chính tả/i.test(prompt))return "edit";
  return null;
}
export function isDocumentEditFollowup(prompt:string,hasDocuments:boolean){
  return hasDocuments && (/(?:sửa|chỉnh sửa|cập nhật|thay|đổi).{0,40}(?:file|tệp|tài liệu|tên|vị trí|nội dung|tiêu đề|lương|số lượng|đơn giá)|\b(edit|modify|update|replace)\b/i.test(prompt) || /^(?:hãy\s+)?(?:đổi|thay)\s+.{1,80}\s+(?:thành|sang|bằng)/i.test(prompt));
}
