import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { needsDocumentOutput, requestedExtensions, needsComputation, isImageGeneration, fastWordMode, needsWebSearch } from "../lib/chat-task-policy";
import { deliverableExtensions, isRequestedDeliverable } from "../lib/document-request";
import { selectDocuments, versionOutput, inspectDocument, spreadsheetIssues, validateOutput } from "../lib/chat-documents";
import { relevantExcerpt } from "../lib/chat-context";

assert.equal(needsDocumentOutput("Tính tổng từ file, không xuất file."),false);
assert.equal(needsDocumentOutput("Create a short Word DOCX document titled Deployment Check."),true);
assert.equal(needsDocumentOutput("Calculate totals; do not create any files."),false);
assert.deepEqual(requestedExtensions("Từ file CSV gốc, tạo XLSX, DOCX, PDF và PPTX."),[".xlsx",".docx",".pptx",".pdf"]);
assert.deepEqual(requestedExtensions("Chuyển file Word sang PDF."),[".pdf"]);
assert.deepEqual(requestedExtensions("Từ CSV vừa gửi, đổi Qty của Beta thành 3. Xuất file Excel XLSX có công thức. Nêu tổng, không yêu cầu tải lại CSV."),[".xlsx"]);
assert.deepEqual(requestedExtensions("Tạo Excel XLSX và CSV để tải xuống."),[".xlsx",".csv"]);
assert.equal(needsDocumentOutput("Phân tích file Excel, tính tổng doanh thu và trả lời trong chat."),false);
assert.equal(needsDocumentOutput("Analyze the file report.xlsx and explain the differences."),false);
assert.equal(needsDocumentOutput("Tính tổng doanh thu rồi xuất file Excel."),true);
assert.equal(needsDocumentOutput("Cho tôi một file Excel mẫu."),true);
assert.deepEqual(requestedExtensions("Xuất Word, không xuất PDF."),[".docx"]);
assert.equal(needsComputation("Tính tổng số liệu và đối chiếu",true),true);
assert.equal(needsComputation("Phân tích nội dung hợp đồng",true),false);
assert.equal(isImageGeneration("Vẽ một bức tranh phong cảnh"),true);
for(const prompt of [
  "iPhone 18 Pro Max ra chưa?",
  "Phân tích sự khác nhau của iPhone 18 Pro Max và 15 Pro Max, xuất ra file exce;",
  "Giá iPhone 15 Pro Max bao nhiêu?",
  "Tỷ giá USD sang VND bao nhiêu?",
  "Ai đang là thủ tướng Nhật Bản?",
  "Cho tôi biết thời tiết Đà Nẵng",
  "Nghị định này còn hiệu lực chưa?",
  "Tra cứu trên mạng và viết email tóm tắt",
  "Is this regulation still in effect?",
  "Tóm tắt trang https://example.com/article",
])assert.equal(needsWebSearch(prompt),true,prompt);
for(const prompt of [
  "Viết email xin nghỉ phép hôm nay",
  "Sửa nội dung hiện tại của file Word",
  "Tìm kiếm số liệu trong file Excel đính kèm",
  "Tra cứu chi phí hôm nay trong tệp vừa gửi",
  "Không cần tra cứu. So sánh iPhone 18 Pro Max và 15 Pro Max.",
  "Chỉ dựa vào file đính kèm để so sánh giá vàng",
  "Tỷ giá là gì?",
  "Giải thích thuật toán binary search",
  "Explain electric current",
  'Dịch câu "What happened today?"',
])assert.equal(needsWebSearch(prompt),false,prompt);
const v1={name:"report.xlsx",url:"/api/files/first.xlsx",family:"first",version:1,kind:"input" as const};
const v2={name:"report.xlsx",url:"/api/files/second.xlsx",family:"first",version:2,kind:"output" as const};
const priorWord=[{name:"old-answer.docx"}];
for(const prompt of [
  "Phân tích cho tôi dsự khác nhau của iphone 18promax và 15promax xuất ra file exce;",
  "Xuất bản exce;",
  "Chuyển file Word sang file Excell.",
  "Xuất file Exel, không xuất Word.",
]){
  assert.equal(needsDocumentOutput(prompt),true,prompt);
  assert.deepEqual(requestedExtensions(prompt),[".xlsx"],prompt);
  assert.equal(fastWordMode(prompt,priorWord,false,false),null,prompt);
  const formats=deliverableExtensions(prompt,priorWord);
  assert.deepEqual(formats,[".xlsx"],prompt);
  assert.equal(isRequestedDeliverable("comparison.docx",formats),false,prompt);
  assert.equal(isRequestedDeliverable("comparison.xlsx",formats),true,prompt);
}
assert.deepEqual(selectDocuments([v2,v1],"Sửa file Excel"),[v2]);
assert.deepEqual(selectDocuments([v2,v1],"So sánh Excel v1 và v2"),[v2,v1]);
assert.deepEqual(selectDocuments([v2,v1],"Lấy file gốc Excel"),[v1]);
const next=versionOutput({name:"updated.xlsx",url:"new"},[v2],[v2,v1]);
assert.equal(next.version,3);assert.deepEqual(next.sourceUrls,[v2.url]);
assert.equal(inspectDocument(strToU8("Item,Qty\nA,2"),"data.csv"),"Item,Qty\nA,2");
assert.throws(()=>validateOutput(strToU8("not a pdf"),"bad.pdf"),/Invalid PDF/);
assert.throws(()=>validateOutput(zipSync({"[Content_Types].xml":strToU8("<Types/>")}),"bad.xlsx"),/Invalid Office/);
assert.equal(spreadsheetIssues(zipSync({"xl/worksheets/sheet1.xml":strToU8('<worksheet><sheetData><row><c r="A1"><f>2+2</f><v/></c></row></sheetData></worksheet>')}),true).length,1);
assert.equal(spreadsheetIssues(zipSync({"xl/worksheets/sheet1.xml":strToU8('<worksheet><sheetData><row><c r="A1"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>')}),true).length,0);
assert.match(spreadsheetIssues(zipSync({"xl/worksheets/sheet1.xml":strToU8('<worksheet><sheetData><row><c r="A1" t="e"><f>1/0</f><v>#DIV/0!</v></c></row></sheetData></worksheet>')}))[0], /#DIV\/0!/);
assert.match(spreadsheetIssues(zipSync({"xl/worksheets/sheet1.xml":strToU8('<worksheet><sheetData><row><c r="A1"><f>1+1</f><v>NaN</v></c></row></sheetData></worksheet>')}))[0], /invalid numeric/);
const sharedSheet=zipSync({
  "xl/workbook.xml":strToU8('<workbook xmlns:r="urn:rels"><sheets><sheet name="Orders" r:id="rId1"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels":strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  "xl/sharedStrings.xml":strToU8('<sst><si><t>Alpha</t></si><si><r><t>North</t></r><r><t> Office</t></r></si></sst>'),
  "xl/worksheets/sheet1.xml":strToU8('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>'),
});
const extractedSheet=inspectDocument(sharedSheet,"orders.xlsx")!;
assert.match(extractedSheet,/sheet: Orders/);assert.match(extractedSheet,/A1: Alpha/);assert.match(extractedSheet,/B1: North Office/);assert.match(extractedSheet,/C1: 4 \[formula: 2\+2\]/);
const excerpt=relevantExcerpt("unrelated ".repeat(200)+"Important code STAR-742"+" filler".repeat(200),"STAR-742",1800);
assert.match(excerpt,/STAR-742/);
console.log("PASS: task routing, source/output distinction, explicit versions, lineage, extraction, invalid-file rejection and relevant excerpts.");

for(const prompt of ["xuất bản W","xuất wodr","chuyển Word","soạn thảo Kế hoạch chuẩn văn phòng, hoàn thiện xuất wodr"]){assert.equal(needsDocumentOutput(prompt),true,prompt);assert.deepEqual(requestedExtensions(prompt),[".docx"],prompt);}

assert.equal(inspectDocument(Buffer.from("\ufeffMặt hàng\tSố lượng\nAlpha\t3", "utf16le"), "excel.tsv"), "Mặt hàng\tSố lượng\nAlpha\t3");
assert.match(inspectDocument(sharedSheet,"sales.xlsm")!, /A1: Alpha/);
