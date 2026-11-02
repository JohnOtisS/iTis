// Read-only diagnostics. Never prints credentials, message text or memory content.
import nextEnv from "@next/env";
import { Pool } from "pg";
import Redis from "ioredis";
import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
nextEnv.loadEnvConfig(process.cwd());
const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
const report={checkedAt:new Date().toISOString(),postgres:{},redis:{configured:Boolean(process.env.REDIS_URL)},files:{},warnings:[]};
try{
  const {rows:[state]}=await pool.query(`SELECT pg_database_size(current_database())::text AS database_bytes,
    (SELECT count(*) FROM users)::int AS users,
    (SELECT count(*) FROM sessions WHERE expires_at<now())::int AS expired_sessions,
    (SELECT count(*) FROM chat_jobs WHERE status='running' AND updated_at<now()-interval '15 minutes')::int AS stale_chat_jobs,
    (SELECT count(*) FROM user_memories WHERE active)::int AS active_memories,
    (SELECT count(*) FROM user_memories WHERE encrypted_content NOT LIKE 'v1.%')::int AS unexpected_memory_format,
    (SELECT count(*) FROM user_memories m JOIN conversations c ON c.id=m.source_conversation_id WHERE m.user_id<>c.user_id)::int AS cross_account_memory_sources,
    (SELECT count(*) FROM request_rate_windows WHERE expires_at<now())::int AS expired_rate_windows,
    (SELECT count(*) FROM stored_files)::int AS registered_files,
    (SELECT count(*) FROM drizzle.__drizzle_migrations)::int AS applied_migrations`);
  report.postgres={connected:true,...state};
  if(state.expired_sessions)report.warnings.push("Expired sessions can be pruned with maintenance.");
  if(state.stale_chat_jobs)report.warnings.push("Stale tasks need owner cancellation or the next admission cleanup.");
  if(state.unexpected_memory_format||state.cross_account_memory_sources)report.warnings.push("Memory data integrity requires review.");
  const {rows}=await pool.query("SELECT url,bytes FROM stored_files");
  let missing=0,mismatched=0,unresolved=0;
  for(const record of rows){
    const u=record.url.split('?')[0];let file;
    if(u.startsWith('/api/files/'))file=join(resolve(process.env.GENERATED_FILES_DIR||'storage/files'),basename(u));
    else if(u.startsWith('/api/avatars/'))file=join(resolve(process.env.AVATARS_DIR||'storage/avatars'),basename(u));
    else if(/^\/api\/images\/[^/]+\/file$/.test(u)){
      const {rows:[image]}=await pool.query("SELECT file_name FROM image_generations WHERE id::text=$1",[u.split('/')[3]]);
      if(image?.file_name)file=join(resolve(process.env.GENERATED_IMAGES_DIR||'/app/storage/generated'),basename(image.file_name));
    }
    if(!file){unresolved++;continue;}
    const info=await stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!info)missing++;else if(info.size!==Number(record.bytes))mismatched++;
  }
  report.files={registered:rows.length,missingPhysical:missing,sizeMismatches:mismatched,unresolvedReferences:unresolved};
  if(missing||mismatched||unresolved)report.warnings.push("Stored-file metadata and disk need reconciliation; diagnostics made no changes.");
  try{const tracked=execFileSync('git',['ls-files','--','storage'],{encoding:'utf8'}).trim();report.files.trackedRuntimeFiles=tracked?tracked.split(/\r?\n/).length:0;if(tracked)report.warnings.push("Runtime files already tracked by Git need review; ignore rules do not remove existing history.");}catch{/* Git is optional on deployed hosts. */}
}catch{report.postgres={connected:false};report.warnings.push("PostgreSQL diagnostics failed; check connectivity/migrations.");process.exitCode=1;}
finally{await pool.end();}
if(process.env.REDIS_URL){
  const redis=new Redis(process.env.REDIS_URL,{lazyConnect:true,connectTimeout:1500,commandTimeout:1500,maxRetriesPerRequest:0,retryStrategy:()=>null});redis.on('error',()=>{});
  try{await redis.connect();report.redis.connected=await redis.ping()==='PONG';report.redis.persistence=(await redis.info('persistence')).includes('aof_enabled:1');}catch{report.redis.connected=false;report.warnings.push("Redis unavailable: chat/memory request limits fall back to PostgreSQL.");}finally{redis.disconnect();}
}
console.log(JSON.stringify(report,null,2));
