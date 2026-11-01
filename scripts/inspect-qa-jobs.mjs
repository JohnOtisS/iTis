import {Pool} from "pg";
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try{
const {rows}=await pool.query("select j.id,j.status,j.stage,j.provider_response_id from chat_jobs j join users u on u.id=j.user_id where u.email like '%@qa.invalid'");
for(const row of rows){let status; if(row.provider_response_id){const r=await fetch(`https://api.openai.com/v1/responses/${row.provider_response_id}`,{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(10000)});const data=await r.json();status={http:r.status,status:data.status};}console.log({id:row.id,appStatus:row.status,stage:row.stage,provider:status});}
}finally{await pool.end();}
