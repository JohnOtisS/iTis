import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.env.ITIS_HOME||join(process.env.HOME,'itis');
const repo=join(root,'repository');
execFileSync('git',['-C',repo,'fetch','--depth=2','origin','main'],{stdio:'ignore',timeout:60000});
const sha=execFileSync('git',['-C',repo,'rev-parse','FETCH_HEAD'],{encoding:'utf8'}).trim();
const deployed=await readFile(join(root,'shared/deployed-sha'),'utf8').catch(()=>'');
if(sha===deployed.trim())process.exit(0);
const failed=await readFile(join(root,'shared/failed-sha'),'utf8').catch(()=>'');
if(sha===failed.trim())process.exit(0);
const response=await fetch(`https://api.github.com/repos/JohnOtisS/iTis/actions/runs?head_sha=${sha}&per_page=10`,{headers:{Accept:'application/vnd.github+json','User-Agent':'iTis-deploy'},signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error(`GitHub CI lookup unavailable (${response.status})`);
const data=await response.json();
const run=data.workflow_runs?.find(r=>r.name==='iTis CI'&&r.head_sha===sha&&r.head_branch==='main');
if(!run||run.status!=='completed')process.exit(0);
if(run.conclusion!=='success'){
  await writeFile(join(root,'shared/failed-sha'),sha,{mode:0o600});
  execFileSync(process.execPath,[join(root,'deployment/notify.mjs'),`🔴 iTis CI không đạt: ${sha.slice(0,8)}. Không deploy. ${run.html_url}`],{stdio:'inherit'});process.exit(0);
}
try{execFileSync('/bin/bash',[join(root,'deployment/deploy.sh'),sha],{stdio:'inherit',timeout:20*60*1000});}
catch{await writeFile(join(root,'shared/failed-sha'),sha,{mode:0o600});process.exitCode=1;}
