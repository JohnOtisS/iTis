import assert from "node:assert/strict";
import {strFromU8,unzipSync} from "fflate";
import {buildWord,readEditableWord} from "../lib/word-fast";
import {completeWord,indexedWordParagraphs,wordCompletionRequest,wordCompletionSource,wordCompletionIssues,cleanWordExportBody} from "../lib/word-completion";
import {fastWordMode,needsDocumentOutput,isDocumentEditFollowup} from "../lib/chat-task-policy";
import {needsFullDocumentReview} from "../lib/document-request";

for(const prompt of ["Soạn nội dung: hoàn thiện phần kiểm điểm đang viên sau","Hoàn thiện đầy đủ chuyên sâu bản sau","Bổ sung nội dung vào mục I.1","Viết tiếp phần hạn chế trong mẫu","Complete the attached Word form"]){assert(wordCompletionRequest(prompt),prompt);assert.equal(fastWordMode(prompt,[{name:"source.docx"}],false,false),"complete",prompt);}
for(const prompt of ["Chỉ phân tích và góp ý, không sửa file","Chỉ viết phần bổ sung trong chat","Hướng dẫn hoàn thiện bản kiểm điểm","Tóm tắt tài liệu"]){assert(!wordCompletionRequest(prompt),prompt);}
assert.equal(fastWordMode("Hoàn thiện rồi xuất PDF",[{name:"source.docx"}],false,false),null);
assert.equal(fastWordMode("Viết lại và hoàn thiện toàn văn",[{name:"source.docx"}],false,false),null);
assert.equal(needsFullDocumentReview("Phân tích kỹ, chuyên sâu tài liệu",1),true);
assert.equal(needsDocumentOutput("Chỉ phân tích chuyên sâu, không sửa file và không tạo file"),false);
assert.equal(isDocumentEditFollowup("Chỉ phân tích chuyên sâu, không sửa file và không tạo file",true),false);

const bytes=buildWord({filename:"form.docx",title:"BẢN KIỂM ĐIỂM",summary:"",blocks:[
 {type:"paragraph",text:"Họ và tên: … Ngày sinh: …",rows:[]},
 {type:"heading",text:"I. Ưu điểm",rows:[]},
 {type:"paragraph",text:"Đã giữ nội dung ORIGINAL-881, số liệu 125.",rows:[]},
 {type:"heading",text:"II. Hạn chế",rows:[]},
 {type:"paragraph",text:"Nội dung cũ cần giữ nguyên.",rows:[]},
 {type:"table",text:"",rows:[["Mã","Kết quả"],["0012","80"]]},
 {type:"paragraph",text:"Người tự kiểm điểm: …",rows:[]},
]});
const source=readEditableWord(bytes),paragraphs=indexedWordParagraphs(source);
const heading=paragraphs.find(p=>p.text==="I. Ưu điểm")!,field=paragraphs.find(p=>p.text.startsWith("Họ và tên"))!;
const plan={summary:"",insertions:[{paragraphIndex:heading.index,anchor:heading.text,paragraphs:["Có ý thức học tập, rèn luyện và phối hợp trong công việc.","Chủ động rà soát tiến độ các nhiệm vụ được giao."]}],fills:[{paragraphIndex:field.index,anchor:field.text,text:"Họ và tên: Nguyễn Văn A Ngày sinh: …"}]};
const output=completeWord(source,plan),result=readEditableWord(output);
assert.deepEqual(wordCompletionIssues(bytes,output),[]);
assert(wordCompletionIssues(bytes,buildWord({filename:"fragment.docx",title:"Chỉ phần mới",summary:"",blocks:[{type:"paragraph",text:"Nội dung bổ sung",rows:[]}]})).length>0);
assert(result.text.includes("Họ và tên: Nguyễn Văn A Ngày sinh: …"));
assert(result.text.indexOf("I. Ưu điểm")<result.text.indexOf(plan.insertions[0].paragraphs[0]));
assert(result.text.indexOf(plan.insertions[0].paragraphs[1])<result.text.indexOf("II. Hạn chế"));
for(const p of paragraphs)if(p.index!==field.index)assert(result.text.includes(p.text),`Keep original ${p.index}`);
const originalZip=unzipSync(bytes),outputZip=unzipSync(output);
for(const part of Object.keys(originalZip))if(part!=="word/document.xml")assert.deepEqual(outputZip[part],originalZip[part],part);
assert.equal((strFromU8(outputZip["word/document.xml"]).match(/<w:tbl>/g)??[]).length,1);
assert.throws(()=>completeWord(source,{...plan,fills:[{...plan.fills[0],text:"Nguyễn Văn A"}]}),/label or fact/);
assert.throws(()=>completeWord(source,{...plan,insertions:[{...plan.insertions[0],anchor:"Wrong heading"}]}),/anchor/);
assert.throws(()=>completeWord(source,{...plan,insertions:[{...plan.insertions[0],paragraphs:["Nội dung cũ cần giữ nguyên."]}]}),/duplicates/);
assert.throws(()=>completeWord(source,{...plan,insertions:[{...plan.insertions[0],paragraphs:["Bạn có muốn mình soạn thêm phần hạn chế không?"]}]}),/chat question/);
const original={name:"source.docx",url:"source",kind:"input" as const};
const revised={name:"completed.docx",url:"revised",kind:"output" as const,sourceUrls:[original.url]};
const fragment={name:"answer.docx",url:"fragment",kind:"output" as const,sourceMessageId:"m",sourceUrls:[]};
assert.equal(wordCompletionSource("Hoàn thiện",[fragment,original],[fragment]),original);
assert.equal(wordCompletionSource("Bổ sung phần II",[revised,original],[revised]),revised);
assert.equal(wordCompletionSource("Hoàn thiện Word theo PDF vừa gửi",[revised,original],[{name:"source.pdf",url:"pdf"}]),revised);
assert.equal(wordCompletionSource("Hoàn thiện bản gốc",[revised,original],[revised]),original);
const body="# BẢN KIỂM ĐIỂM\n\nNội dung đã soạn đầy đủ.\n\nLưu ý: Thời hạn nộp trước ngày 30/11.\n\nAnh/chị đã hoàn thành nhiệm vụ chưa?\n\nBạn có muốn nhận thông báo qua email không?";
const question="Bạn đang công tác trong lĩnh vực nào để mình bổ sung dẫn chứng, hoặc bạn có muốn mình soạn các mục còn lại không?";
assert.equal(cleanWordExportBody(body+"\n\n"+question),body);
assert.equal(cleanWordExportBody("Dưới đây là nội dung đã soạn:\n\n"+body),body);
assert.equal(cleanWordExportBody(body),body);
assert.equal(cleanWordExportBody(body+"\n\n*Bạn nên điều chỉnh các nhận định cho đúng tình hình thực tế của bản thân.*"),body);
console.log("PASS original Word completion: section placement, retained content/package/table, field labels, rejected duplicates/questions, revision selection and safe export cleanup");
