export function taskFailureText(error:string,vi:boolean){
  if(/STREAM_INTERRUPTED/.test(error))return vi?"Kết nối bị ngắt trước khi nhận đủ kết quả. Tác vụ có thể vẫn đang chạy; mở lại phiên chat để kiểm tra trước khi thử lại.":"The connection ended before the result arrived. The task may still be running; reopen this chat before retrying.";
  if(/Processing limit|incomplete|max_output_tokens/i.test(error))return vi?"Tác vụ đã chạm giới hạn xử lý trước khi hoàn tất. Tệp gốc vẫn được giữ; hãy thử lại hoặc chia nhỏ yêu cầu.":"The task reached its processing limit before completion. Original files are retained; retry or split the request.";
  if(/Invalid input: Expected context stuffing file type/i.test(error))return vi?"Định dạng đầu vào chưa được xử lý đúng. Tệp gốc vẫn được giữ; hãy thử lại với bản cập nhật mới.":"The input format was not processed correctly. Original files are retained; retry with the updated version.";
  if(/verification|Invalid PDF|Invalid Office/i.test(error))return vi?"Tệp đầu ra chưa vượt qua kiểm tra nên chưa được gửi. Tệp gốc vẫn được giữ; hãy thử lại tác vụ.":"The output did not pass validation and was not delivered. Original files are retained; retry the task.";
  return error.slice(0,600);
}
