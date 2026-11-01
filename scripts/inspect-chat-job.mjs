// Read-only task timings. Does not print prompts, documents or credentials.
import {Pool} from "pg";
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try{
  const {rows:[job]}=await pool.query("select id,status,stage,provider_response_id,extract(epoch from(now()-created_at))::int as elapsed_seconds from chat_jobs where id=$1",[process.argv[2]]);
  if(!job)throw new Error("Task not found");
  let provider;
  if(job.provider_response_id){
    const started=Date.now();
    const response=await fetch(`https://api.openai.com/v1/responses/${job.provider_response_id}`,{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    provider={http:response.status,readLatencyMs:Date.now()-started,status:data.status,model:data.model,background:data.background,reasoning:data.reasoning,maxOutputTokens:data.max_output_tokens,outputTypes:data.output?.map(o=>({type:o.type,status:o.status})),usage:data.usage};
  }
  console.log(JSON.stringify({app:{status:job.status,stage:job.stage,elapsedSeconds:job.elapsed_seconds},provider},null,2));
}finally{await pool.end();}
