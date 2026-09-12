import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath,URL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const buildOnly=process.argv.includes('--build-only');
if(process.argv.slice(2).some(v=>v!=='--build-only'))throw new Error('Only --build-only is supported');
const config=JSON.parse(readFileSync('cloudbaserc.json','utf8'));
const environment=config.envId,deployPath=config.hosting?.[0]?.deployPath;
if(!/^[a-zA-Z0-9-]+$/.test(environment??''))throw new Error('Set a valid envId in cloudbaserc.json');
if(!/^\/[a-zA-Z0-9/_-]*$/.test(deployPath??''))throw new Error('Set a valid hosting deployPath');
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run through npm run deploy:cloudbase');
function run(command,args,options={}){
 const result=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true,...options});
 if(result.error)throw new Error(`Unable to start ${command}: ${result.error.message}`);
 if(result.status!==0)throw new Error(`Command failed (exit ${result.status}); upload was not completed`);
}
try{
 console.log('1/3 Install dependencies including build tools');
 run(process.execPath,[npm,'ci','--include=dev']);
 console.log('2/3 Build and validate dist');
 run(process.execPath,[npm,'run','build']);
 if(buildOnly){console.log('Build-only verification complete; no cloud resources changed.');}
 else{
  console.log('3/3 Upload validated dist to the configured CloudBase environment');
  // Use the platform-provided authenticated CLI. Do not install a moving CLI version or request credentials here.
  run(process.platform==='win32'?'tcb.cmd':'tcb',['hosting','deploy','./dist',deployPath,'-e',environment],{shell:process.platform==='win32'});
  console.log('CloudBase static upload completed. Business API connectivity requires separate verification.');
 }
}catch(error){console.error(error.message);process.exitCode=1;}
