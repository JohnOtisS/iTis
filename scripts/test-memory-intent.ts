import assert from "node:assert/strict";
import {isExplicitMemoryRequest,memoryOnlyRequest} from "../lib/memory-consolidation";
for(const prompt of ["lưu lại Nghị định 30 và soạn văn bản đúng quy định","Bro, hãy lưu lại quy trình kiểm kê của tôi: mã LOTUS-742.","Hãy ghi nhớ: gọi tôi là Lan.","Lưu vào bộ nhớ: tôi thích bảng ngắn gọn."]){assert.equal(isExplicitMemoryRequest(prompt),true,prompt);}
for(const prompt of ["Lưu lại file Word này thành PDF","Lưu lại Nghị định 30 thành file PDF để tải xuống","Lưu lại báo cáo.xlsx","Đừng lưu lại quy trình này","Không ghi nhớ điều này","Bạn có nhớ tôi không?","Can you remember my name?"]){assert.equal(isExplicitMemoryRequest(prompt),false,prompt);}
assert.equal(memoryOnlyRequest("lưu lại Nghị định 30 và soạn văn bản đúng quy định"),false);
assert.equal(memoryOnlyRequest("Hãy ghi nhớ tên tôi là Lan và soạn một CV Word cho tôi"),false);
assert.equal(memoryOnlyRequest("Lưu lại quy trình kiểm kê của tôi: mã LOTUS-742."),true);
console.log("PASS: natural memory requests, document-save exclusions, negations and combined drafting requests.");
