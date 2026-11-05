// SSE framing only. Never forward reasoning, Python source or tool output to the chat.
export async function* providerEvents(body:ReadableStream<Uint8Array>){
  const reader=body.getReader(),decoder=new TextDecoder();let buffer="";
  try{
    while(true){
      const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
      const frames=buffer.split(/\r?\n\r?\n/);buffer=done?"":frames.pop()??"";
      for(const frame of frames){
        const data=frame.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
        if(data&&data!=="[DONE]")yield JSON.parse(data) as {type:string;delta?:string;response?:{id:string;status:string};sequence_number?:number};
      }
      if(done)break;
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// Terminal delivery may arrive by SSE and polling in either order. Keep one answer.
export function upsertReply<T extends {id?:string}>(items:T[],reply:T,temporaryId?:string|null){
  const matches=(item:T)=>Boolean(reply.id&&item.id===reply.id||temporaryId&&item.id===temporaryId);
  const index=items.findIndex(matches);
  if(index<0)return [...items,reply];
  return items.flatMap((item,i)=>i===index?[reply]:matches(item)?[]:[item]);
}
