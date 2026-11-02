const hook=process.env.DISCORD_DEPLOY_WEBHOOK;
if(hook){
  try{const r=await fetch(hook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'iTis Deploy',allowed_mentions:{parse:[]},content:process.argv.slice(2).join(' ').slice(0,1800)}),signal:AbortSignal.timeout(10000)});if(!r.ok)console.error('Discord notification failed:',r.status);}
  catch{console.error('Discord notification unavailable.');}
}
