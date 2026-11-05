import assert from "node:assert/strict";
import {localArtifactIntent,resolveFileReference} from "../lib/artifact-policy";
import {markdownWordDraft} from "../lib/local-artifacts";
import {buildWord,readEditableWord} from "../lib/word-fast";
import {estimateModelCost,taskUsage,terminalProviderUsage} from "../lib/task-usage";
import {fastWordMode} from "../lib/chat-task-policy";

assert.equal(localArtifactIntent("Gửi lại file Word vừa tạo cho tôi"),"resend");
assert.equal(localArtifactIntent("Xuất cái Kế hoạch phía trên ra bản Word"),"export");
for(const prompt of ["Xuất Word và PDF", "Xuất Word theo Nghị định 30", "Sửa nội dung rồi xuất Word", "Tóm tắt rồi xuất Word", "Không cần xuất Word", "Chuyển Word sang PDF", "Gửi lại file và thay tên công ty", "Soạn Word mới", "Thêm địa chỉ rồi xuất Word", "Ghi nhớ văn bản này và xuất Word", "Chuyển sang tiếng Anh rồi xuất Word", "Xóa phần cũ rồi gửi lại file Word"])
  assert.equal(localArtifactIntent(prompt),null,prompt);
const plan={name:"Ke_hoach_A.docx",url:"old",family:"plan",version:1};
const next={...plan,url:"new",version:2};const letter={name:"Cong_van_A.docx",url:"letter",version:1};
assert.deepEqual(resolveFileReference([letter,next,plan],"Gửi lại Kế hoạch Word").files,[next]);
assert.deepEqual(resolveFileReference([letter,next,plan],"Gửi lại Ke_hoach_A.docx bản 1").files,[plan]);
assert.equal(resolveFileReference([letter,next],"Gửi lại file Word").ambiguous,true);
assert.equal(resolveFileReference([letter,next],"Gửi lại tất cả file Word").ambiguous,false);
assert.equal(fastWordMode("Xuất kế hoạch Word theo Nghị định 30",[],false,false),null);
const content="# KẾ HOẠCH QA-742\n\nDữ kiện: 1.234.567 đồng; ngày 03/11/2026.\n\n| Tên | Số lượng |\n|---|---|\n| Alpha | 4 |\n| Beta | 9 |\n\n- Không đổi dữ kiện\n\n```ts\nconst raw = '<tag> & value';\n```\nNguồn: [Cơ quan](https://example.invalid/ref)";
const result=readEditableWord(buildWord(markdownWordDraft(content),false));
for(const token of ["KẾ HOẠCH QA-742","1.234.567","03/11/2026","Alpha","Beta","const raw = '<tag> & value';","https://example.invalid/ref"])
  assert.ok(result.text.includes(token),token);
assert.equal(result.text.match(/KẾ HOẠCH QA-742/g)?.length,1,"must not duplicate title");
const u=taskUsage({input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:40,cache_write_tokens:10},output_tokens_details:{reasoning_tokens:15}});
assert.equal(u.total_tokens,120,"reasoning must not be charged twice");
const terminal=terminalProviderUsage({type:"response.incomplete",response:{usage:{input_tokens:350,output_tokens:900,output_tokens_details:{reasoning_tokens:700}}}});
assert.equal(terminal?.completed,false);assert.equal(terminal?.incomplete,true);assert.equal(taskUsage(terminal?.usage).total_tokens,1250);
assert.equal(terminalProviderUsage({type:"response.output_text.delta",delta:"abc"}),null);
assert.equal(estimateModelCost("gpt-6.1-sol",{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:40,cache_write_tokens:10}}),(50*2+10*2*1.25+40*.1+20*10)/1e6);
console.log("PASS intent exclusions, source type/version ambiguity, exact text/table/code export, no duplicated title, reasoning/cache-write accounting");

for(const prompt of ["xuất bản W","xuất wodr","xuất wrod"])assert.equal(localArtifactIntent(prompt),"export",prompt);
