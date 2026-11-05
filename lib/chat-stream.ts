// The final NDJSON line need not end in a newline. A dropped connection is not success.
export async function* readChatEvents<T extends {type:string}>(body:ReadableStream<Uint8Array>){
  const reader=body.getReader(),decoder=new TextDecoder();let buffer="",terminal=false;
  try{
    while(true){
      const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
      const lines=buffer.split(/\r?\n/);buffer=done?"":lines.pop()??"";
      for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line) as T;if(event.type==="done"||event.type==="error")terminal=true;yield event;}
      if(done)break;
    }
    if(!terminal)throw new Error("STREAM_INTERRUPTED");
  }finally{reader.releaseLock();}
}
