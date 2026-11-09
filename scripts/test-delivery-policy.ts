import assert from "node:assert/strict";
import {deliverableExtensions,documentSourceLabels,isRequestedDeliverable,outputExtensions,needsFullDocumentReview,sourceCoverageIssues} from "../lib/document-request";
import {selectDocuments,namedDocuments} from "../lib/chat-documents";
import {downloadFormatFromContext,needsDocumentOutput} from "../lib/chat-task-policy";
import {readChatEvents} from "../lib/chat-stream";
import {taskFailureText} from "../lib/task-failure";
async function main(){
  for(const prompt of ["xuất bản W","xuất wodr","xuất wrod","xuất bản Word từ file PDF","Soạn kế hoạch dựa trên PDF, xuất Word"]){
    const formats=outputExtensions(prompt);assert.deepEqual(formats,[".docx"],prompt);
    assert.equal(isRequestedDeliverable("final.docx",formats),true);
    for(const file of ["preview.pdf","ocr.txt","debug.json","itis-validation.json"])assert.equal(isRequestedDeliverable(file,formats),false,file);
  }
  assert.deepEqual(outputExtensions("Không PDF, xuất Word"),[".docx"]);
  assert.deepEqual(outputExtensions("Xuất Word, không PDF hay text phụ"),[".docx"]);
  assert.deepEqual(outputExtensions("Chuyển Word sang PDF"),[".pdf"]);
  const issueWord="ban hành ra bản Word cho tôi ban hành nhé";
  for(const prompt of [issueWord,"bạn không ban hành ra bản Word cho ttoii theo nghị định 30 được à","Cho tôi bản Word"]){
    assert.equal(needsDocumentOutput(prompt),true,prompt);
    assert.deepEqual(outputExtensions(prompt),[".docx"],prompt);
  }
  assert.equal(needsDocumentOutput("Không cần ban hành ra bản Word."),false);
  assert.equal(needsDocumentOutput("Hướng dẫn cách ban hành ra bản Word."),false);
  assert.deepEqual(downloadFormatFromContext("bạn ban hành cho tôi tải xuống",[issueWord,"ok"]),[".docx"]);
  assert.deepEqual(downloadFormatFromContext("Cho tôi tải xuống",[issueWord,"Xuất bản PDF nhé"]),[".pdf"]);
  assert.deepEqual(downloadFormatFromContext("Cho tôi tải xuống",[issueWord,"Giá vàng hôm nay bao nhiêu?"]),[]);
  assert.deepEqual(downloadFormatFromContext("Cho tôi tải xuống",[]),[]);
  assert.deepEqual(downloadFormatFromContext("Không cần tải xuống",[issueWord]),[]);
  assert.deepEqual(downloadFormatFromContext("Khi nào văn bản được ban hành?",[issueWord]),[]);
  assert.deepEqual(outputExtensions("Xuất Word và PDF"),[".docx",".pdf"]);
  assert.deepEqual(deliverableExtensions("Sửa tên trong file",[{name:"draft.docx"}]),[".docx"]);
  assert.equal(isRequestedDeliverable("ocr.txt",[".txt"]),true);
  const files=Array.from({length:7},(_,i)=>({name:`source-${i}.pdf`,url:`file-${i}`,kind:"input" as const}));
  const catalog=[{name:"older-output.docx",url:"output",kind:"output" as const},...files];
  assert.equal(selectDocuments(catalog,"Phân tích các tài liệu và xuất Word").length,7,"Word target must not filter PDF sources or truncate multi-document requests");
  assert.equal(selectDocuments(catalog,"Từ file PDF, phân tích và xuất Word").length,7);
  assert.equal(needsFullDocumentReview("Phân tích các tài liệu",7),true);
  assert.equal(needsFullDocumentReview("Chào bạn",0),false);
  assert.equal(sourceCoverageIssues(files.map(f=>f.name),files).length,0);
  assert.equal(sourceCoverageIssues([files[0].name],files).length,1);
  const word={name:"Quarterly.docx",url:"word",kind:"input" as const};
  const excel={name:"Quarterly.xlsx",url:"excel",kind:"input" as const,family:"sheet",version:1};
  const revised={...excel,url:"revised",kind:"output" as const,version:2};
  const pdf={name:"Rules.pdf",url:"pdf",kind:"input" as const};
  const slides={name:"Brand.potx",url:"slides",kind:"input" as const};
  const office=[word,excel,revised,pdf,slides];
  for(const {prompt,sources,outputs} of [
    {prompt:"Sửa file Excel rồi xuất PDF.",sources:[revised],outputs:[".pdf"]},
    {prompt:"Chuyển PDF thành một file Word.",sources:[pdf],outputs:[".docx"]},
    {prompt:"Xuất PPTX từ Excel và PDF.",sources:[revised,pdf],outputs:[".pptx"]},
    {prompt:"Dựa trên Word và PDF, xuất file exce;",sources:[word,pdf],outputs:[".xlsx"]},
    {prompt:"Sửa Excel dựa trên PDF rồi xuất Word.",sources:[revised,pdf],outputs:[".docx"]},
    {prompt:"Xuất Word theo mẫu PDF.",sources:[pdf],outputs:[".docx"]},
    {prompt:"Ban hành ra bản Word từ file PDF.",sources:[pdf],outputs:[".docx"]},
    {prompt:"Dựa trên PDF, ban hành ra bản Word.",sources:[pdf],outputs:[".docx"]},
    {prompt:"Ban hành ra bản Word, dùng PDF đính kèm làm căn cứ.",sources:[pdf],outputs:[".docx"]},
    {prompt:"Từ file PowerPoint, xuất PDF.",sources:[slides],outputs:[".pdf"]},
    {prompt:"Dựa trên Quarterly.xlsx và Rules.pdf, xuất Word và PowerPoint.",sources:[revised,pdf],outputs:[".docx",".pptx"]},
  ]){
    assert.equal(needsDocumentOutput(prompt),true,prompt);
    assert.deepEqual(selectDocuments(office,prompt),sources,prompt);
    assert.deepEqual(outputExtensions(prompt),outputs,prompt);
  }
  assert.deepEqual(namedDocuments(office,"Phân tích Quarterly.xlsx"),[excel,revised]);
  assert.deepEqual(selectDocuments(office,"Phân tích cả hai tệp vừa gửi",[word,pdf]),[word,pdf]);
  assert.deepEqual(selectDocuments([...office,...files],"Từ cả bốn tệp vừa gửi, kiểm tra mã từ Word và sheet Quarterly rồi xuất Word.",[word,revised,pdf,slides]),[word,revised,pdf,slides]);
  assert.deepEqual(namedDocuments(office,"So sánh tệp Quarterly với file Rules"),[word,excel,revised,pdf]);
  assert.deepEqual(selectDocuments(office,"Đối chiếu Quarterly.xlsx v1 và v2"),[excel,revised]);
  assert.deepEqual(selectDocuments(office,"Phân tích bản gốc Quarterly.xlsx"),[excel]);
  assert.deepEqual(selectDocuments([word],"Phân tích PDF"),[]);
  assert.equal(needsDocumentOutput("Đọc mọi slide của PowerPoint. Chỉ trả lời trong chat, không xuất Word."),false);
  assert.equal(needsFullDocumentReview("Check every slide",1),true);
  for(const prompt of ["Kiểm tra trang 7 của PDF","Đọc phần chân trang Word","Review speaker notes","Đọc PDF quét"]){
    assert.equal(needsFullDocumentReview(prompt,1),true,prompt);
  }
  const sourceLabels=documentSourceLabels([excel,revised,word]);
  assert.equal(new Set(sourceLabels).size,3);
  const distinctSources=sourceLabels.map(name=>({name}));
  assert.equal(sourceCoverageIssues(sourceLabels,distinctSources).length,0);
  assert.match(sourceCoverageIssues([sourceLabels[0],sourceLabels[2]],distinctSources)[0],/v2/);
  const content='{"type":"meta"}\n{"type":"delta","delta":"Tiếng Việt"}\n{"type":"done","text":"Đã xong"}';
  const bytes=new TextEncoder().encode(content);
  const body=new ReadableStream<Uint8Array>({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}});
  const events=[];for await(const event of readChatEvents<{type:string;text?:string}>(body))events.push(event);
  assert.equal(events.at(-1)?.text,"Đã xong","must parse final line without trailing newline and split UTF-8 chunks");
  const truncated=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{"type":"meta"}\n'));c.close();}});
  await assert.rejects(async()=>{for await(const event of readChatEvents(truncated))void event;},/STREAM_INTERRUPTED/);
  assert.match(taskFailureText("Processing limit reached",true),/giới hạn xử lý/);
  console.log("PASS Word aliases, exact output formats, no OCR/preview delivery, PDF source selection, seven-file review, source coverage and interrupted NDJSON streams");
}
void main();
