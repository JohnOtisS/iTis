import assert from "node:assert/strict";
import {zipSync,strToU8} from "fflate";
import {isSpreadsheetFormattingOnly,spreadsheetDeliverables,singleSpreadsheetOutput,spreadsheetInstructions,spreadsheetOperation,spreadsheetRevisionSources,wantsSpreadsheetFile} from "../lib/spreadsheet-policy";
import {workbookPreservationIssues,workbookSnapshot} from "../lib/spreadsheet-validation";
import {deliverableExtensions,outputExtensions} from "../lib/document-request";
import {selectDocuments,spreadsheetIssues} from "../lib/chat-documents";
import {needsWebSearch} from "../lib/chat-task-policy";

for(const prompt of ["Thêm cột tuổi ở cuối bảng","Bổ sung cột thành tiền và tính theo số lượng * đơn giá","Tách cột họ tên thành hai cột","Gộp hai bảng theo mã hồ sơ","Điền công thức SUMIFS cho từng dòng","Xóa cột ghi chú","Đổi tên sheet thành Tổng hợp","Chỉnh độ rộng cột và xuống dòng","Tô màu ô trống","Cố định hàng đầu bằng freeze panes","Add a column and fill the formula down","Replace values in cells B2:B20","Remove the blank rows","Rename sheet Orders to Sales","Tính cột VAT 8%","Chuẩn hóa ngày sinh"]){
  assert.equal(spreadsheetOperation(prompt),"edit",prompt);
  assert(wantsSpreadsheetFile(prompt,spreadsheetOperation(prompt)),prompt);
}
for(const prompt of ["Xuất sang CSV","Chuyển file sang TSV","Tải phai xcell","Export to PDF","Convert to Word"]){assert.equal(spreadsheetOperation(prompt),"convert",prompt);assert(wantsSpreadsheetFile(prompt,"convert"));}
for(const prompt of ["Chuyển Excel qua PDF","Xuất Excel ra PDF","Lưu Excel thành định dạng PDF","Save Excel as PDF","Chuyển Excel thành bảng Word"]){assert.deepEqual(outputExtensions(prompt),prompt.endsWith("Word")?[".docx"]:[".pdf"],prompt);assert.equal(spreadsheetOperation(prompt),"convert",prompt);}
assert.deepEqual(outputExtensions("Chuyển sheet Data của bản vừa sửa sang CSV, chỉ một CSV, không kèm Excel hay PDF."),[".csv"]);
assert.deepEqual(outputExtensions("Xuất Word, không gửi Excel và PDF"),[".docx"]);
assert.deepEqual(outputExtensions("Từ CSV này làm Excel cho tôi"),[".xlsx"]);
assert.deepEqual(outputExtensions("Sửa Excel rồi gửi Word cho tôi"),[".docx"]);
assert.deepEqual(outputExtensions("Sửa Excel và trả PDF, không kèm Word"),[".pdf"]);
assert.match(spreadsheetInstructions("Tính tuổi hôm nay","read",false,"2026-11-23"),/2026-11-23/);
assert.equal(needsWebSearch("Tính tuổi hôm nay từ ngày sinh trong Excel"),false);
assert.equal(needsWebSearch("Calculate age today from birth dates"),false);
assert.equal(needsWebSearch("Tính tuổi hôm nay và tra cứu web quy định"),true);
for(const prompt of ["Tính tổng doanh thu cho tôi biết","Đối chiếu hai bảng và báo chênh lệch","Có bao nhiêu người đủ 16 tuổi?","Calculate the total amount","Đếm số người, không xóa dòng"]){assert.equal(spreadsheetOperation(prompt),"read",prompt);assert(!wantsSpreadsheetFile(prompt,"read"));}
for(const prompt of ["Hướng dẫn thêm cột Excel","How do I format dates?","bro hướng dẫn tính tổng","Định dạng ngày sinh là định dạng gì?"]){assert.notEqual(spreadsheetOperation(prompt),"edit",prompt);}
assert(wantsSpreadsheetFile("Thêm cột tuổi rồi cho tôi biết bao nhiêu ô lỗi","edit"));
assert(!wantsSpreadsheetFile("Tính cột VAT, chỉ trả lời trong chat","edit"));
assert(!wantsSpreadsheetFile("Lọc người đủ tuổi, không cần tạo file","filter"));
assert(isSpreadsheetFormattingOnly("Định dạng ngày sinh, giữ nguyên công thức"));
assert(!isSpreadsheetFormattingOnly("Định dạng ngày sinh và thêm cột tuổi"));

const original={name:"roster.xlsx",url:"original",kind:"input" as const};
const revised={name:"updated.xlsx",url:"revision",kind:"output" as const,family:original.url,version:2};
const older={name:"old.xlsx",url:"old",kind:"input" as const};
assert.deepEqual(spreadsheetRevisionSources([revised,original,older],"Thêm cột tuổi",[revised]),[revised]);
assert.deepEqual(spreadsheetRevisionSources([revised,original,older],"Chuyển sang PDF",[revised]),[revised]);
const csv={name:"data.csv",url:"csv",kind:"output" as const};
assert.deepEqual(selectDocuments([revised,csv],"Từ CSV này làm Excel cho tôi"),[csv]);
assert.equal(spreadsheetRevisionSources([revised,original],"Chuyển sang PDF",[revised],[{name:"new.docx",url:"word"}]),null);
assert.deepEqual(spreadsheetRevisionSources([csv,revised,original],"Xuất bản Excel vừa sửa sang PDF",[csv]),[revised]);
for(const prompt of ["Sửa file gốc","Sửa roster.xlsx","So sánh hai bảng","Gộp tất cả file","Dùng bản 1"]){assert.equal(spreadsheetRevisionSources([revised,original],prompt,[revised]),null,prompt);}
assert.deepEqual(outputExtensions("Từ TSV vừa gửi, xuất XLSX"),[".xlsx"]);
assert.deepEqual(outputExtensions("Từ XLSM chuyển sang PDF"),[".pdf"]);
assert.deepEqual(outputExtensions("Xuất Excel XLSM giữ macro"),[".xlsm"]);
assert.deepEqual(deliverableExtensions("Chỉnh định dạng",[{name:"legacy.xls"}]),[]);
assert.deepEqual(deliverableExtensions("Chỉnh định dạng",[{name:"macro.xlsm"}]),[".xlsm"]);
assert.deepEqual(spreadsheetDeliverables("Thêm cột tổng",[{name:"data.csv",url:"csv"}],"edit"),[".xlsx"]);
assert.deepEqual(spreadsheetDeliverables("Xuất TSV",[original],"convert"),[".tsv"]);
assert(singleSpreadsheetOutput("Lọc danh sách",[".xlsx"]));
assert(!singleSpreadsheetOutput("Xuất hai file Excel",[".xlsx"]));
assert(!singleSpreadsheetOutput("Xuất CSV",[".csv"]));
assert.match(spreadsheetInstructions("Thêm cột thành tiền và VAT","edit",true),/Decimal/);
assert.match(spreadsheetInstructions("Lọc từ 16 đến dưới 18 tuổi","filter",true),/>=16 and <18/);
assert.match(spreadsheetInstructions("Chuyển sang CSV","convert",true),/UTF-8 BOM/);

function book(rows:number,formula="SUM(A2:A3)",macro?:string){
 const files:Record<string,Uint8Array>={
  "xl/workbook.xml":strToU8('<workbook xmlns:r="urn:r"><sheets><sheet name="Data" r:id="rId1"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels":strToU8('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'),
  "xl/worksheets/sheet1.xml":strToU8(`<worksheet><sheetData>${Array.from({length:rows},(_,i)=>`<row r="${i+1}"><c r="A${i+1}"><v>${i}</v></c></row>`).join("")}<row r="10000"><c r="Z10000" s="2"/></row><row r="${rows+1}"><c r="B${rows+1}"><f>${formula}</f><v/></c></row></sheetData></worksheet>`),
 };if(macro)files["xl/vbaProject.bin"]=strToU8(macro);return zipSync(files);
}
const source=book(4),same=book(4),truncated=book(2),changed=book(4,"1+1");
assert.equal(workbookSnapshot(source).sheets[0].rows,5,"Ignore styled empty trailing rows");
assert.deepEqual(workbookPreservationIssues(source,same,"Thêm cột tuổi","edit"),[]);
assert.deepEqual(workbookPreservationIssues(source,book(5),"Thêm cột và ghi tổng ở cuối bảng","edit"),[]);
assert.match(workbookPreservationIssues(source,truncated,"Định dạng ngày sinh","edit")[0],/populated rows/);
assert.deepEqual(workbookPreservationIssues(source,truncated,"Lọc người trên 80 tuổi","filter"),[]);
assert.match(workbookPreservationIssues(source,changed,"Định dạng ngày sinh","edit")[0],/formula/);
assert.equal(workbookPreservationIssues(book(4,"1+1","VBA-SAFE"),book(4,"1+1"),"Định dạng", "edit",true).length,1);
assert.equal(spreadsheetIssues(source,true).length,1);
assert.equal(spreadsheetIssues(same,true,source).length,0,"Keep existing uncalculated formula during pure formatting");
assert.equal(spreadsheetIssues(changed,true,source).length,1,"New uncalculated formulas must still fail");
console.log("PASS spreadsheet commands, read-only exclusions, revision selection, formats, independent row/formula/VBA preservation and inherited cache handling");
