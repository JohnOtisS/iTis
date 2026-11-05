import assert from "node:assert/strict";
import {providerEvents,upsertReply} from "../lib/provider-events";
import {readChatEvents} from "../lib/chat-stream";
async function main(){
  const final={type:"response.completed",response:{id:"response-qa",status:"completed"}};
  const source=': keepalive\r\n\r\ndata: '+JSON.stringify({type:"response.output_text.delta",delta:"Tiếng Việt"})+'\r\n\r\ndata: '+JSON.stringify(final);
  const bytes=new TextEncoder().encode(source);
  const body=new ReadableStream<Uint8Array>({start(c){for(let i=0;i<bytes.length;i+=2)c.enqueue(bytes.slice(i,i+2));c.close();}});
  const events=[];for await(const event of providerEvents(body))events.push(event);
  assert.equal(events[0].delta,"Tiếng Việt");assert.equal(events[1].response?.status,"completed");
  type Reply={id?:string;content:string;file?:string};
  const reply:Reply={id:"saved",content:"",file:"final.docx"};
  assert.deepEqual(upsertReply<Reply>([],reply,"stream-1"),[reply],"reply survives route replacing the temporary message");
  const once=upsertReply<Reply>([{id:"user",content:"Export Word"},{id:"stream-1",content:"partial"}],reply,"stream-1");
  assert.deepEqual(upsertReply(once,reply,"stream-1"),once,"poll and SSE delivery are idempotent");
  const wire=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{"type":"heartbeat"}\n{"type":"done","attachments":["final.docx"]}'));c.close();}});
  const received=[];for await(const e of readChatEvents<{type:string}>(wire))received.push(e);
  assert.equal(received.at(-1)?.type,"done");
  console.log("PASS SSE framing/UTF-8/final frame, heartbeat, lost placeholder recovery, idempotent concurrent polling and stream completion");
}
void main();
