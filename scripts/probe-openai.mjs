// Read-only diagnostics. Never prints credentials or the complete model catalog.
const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" };
const catalog = await fetch("https://api.openai.com/v1/models", { headers, signal: AbortSignal.timeout(15000) });
const models = await catalog.json();
console.log(JSON.stringify({ endpoint: "models", status: catalog.status, configured: Boolean(process.env.OPENAI_API_KEY), targets: ["gpt-6-luna", "gpt-6.1-sol"].map(id=>({id,available:models.data?.some(model=>model.id===id)??false})), error: models.error ? { code: models.error.code, type: models.error.type } : undefined }));
if(catalog.ok) {
  for(const model of ["gpt-6-luna","gpt-6.1-sol"]) {
    const response = await fetch("https://api.openai.com/v1/responses", { method:"POST",headers,signal:AbortSignal.timeout(30000),body:JSON.stringify({model,input:"Reply OK only.",store:false,max_output_tokens:32,reasoning:{effort:"low"}}) });
    const data=await response.json();
    console.log(JSON.stringify({endpoint:"responses",model,status:response.status,responseStatus:data.status,usage:data.usage,error:data.error?{code:data.error.code,type:data.error.type,param:data.error.param,message:data.error.message?.replace(/sk-[A-Za-z0-9_-]+/g,"[REDACTED]")}:undefined}));
  }
  const stream = await fetch("https://api.openai.com/v1/responses", { method:"POST",headers,signal:AbortSignal.timeout(30000),body:JSON.stringify({model:"gpt-6-luna",input:[{role:"developer",content:"Answer briefly."},{role:"user",content:"Reply OK only."}],store:false,stream:true,max_output_tokens:900,reasoning:{effort:"low"},text:{verbosity:"low"}}) });
  const content=await stream.text();
  console.log(JSON.stringify({endpoint:"stream",status:stream.status,hasCompleted:content.includes('"response.completed"'),error:stream.ok?undefined:content.slice(0,500)}));
}
