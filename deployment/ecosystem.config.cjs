/* eslint-disable @typescript-eslint/no-require-imports */
const path=require('node:path');
const root=process.env.ITIS_HOME||path.join(process.env.HOME,'itis');
module.exports={apps:[{name:'itis-web',script:path.join(root,'deployment','run-web.sh'),interpreter:'/bin/bash',cwd:root,autorestart:true,restart_delay:2000,max_restarts:20,kill_timeout:15000,time:true,out_file:path.join(root,'logs','web-out.log'),error_file:path.join(root,'logs','web-error.log'),max_memory_restart:'1500M',env:{ITIS_HOME:root}}]};
