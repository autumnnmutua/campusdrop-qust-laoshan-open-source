import { spawnSync } from 'node:child_process';
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this gate through npm run verify');
for(const script of ['security:check','api:check','lint','typecheck','build']) {
  const result=spawnSync(process.execPath,[npm,'run',script],{stdio:'inherit',windowsHide:true});
  if(result.status!==0){process.exitCode=1;break;}
}
