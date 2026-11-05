import assert from "node:assert/strict";
import {deliverableExtensions,isRequestedDeliverable,outputExtensions,needsFullDocumentReview,sourceCoverageIssues} from "../lib/document-request";
import {selectDocuments} from "../lib/chat-documents";
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
