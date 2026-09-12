import { spawnSync } from 'node:child_process';
import { readFileSync,existsSync } from 'node:fs';
function git(args,input) {
  const r=spawnSync('git',args,{encoding:'utf8',input,windowsHide:true});
  if(r.status!==0)throw new Error('Git security inventory failed');
  return r.stdout;
}
const files=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))];
const forbidden=/(^|\/)(\.dev\.vars[^/]*|\.env(?!\.example$)[^/]*|\.npmrc|[^/]+\.(?:sqlite(?:3)?|db|pem|key|p12|pfx))$|^(?:\.wrangler|\.private|test-results|node_modules|dist|playwright-report)\//;
const patterns=[/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{40,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/(?:CLOUDFLARE_API_TOKEN|D1_SECRET)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/];
const problems=[];
for(const file of files) {
  if(!existsSync(file))continue;
  if(forbidden.test(file)){problems.push(`${file}: forbidden file`);continue;}
  const contents=readFileSync(file,'utf8');
  if(patterns.some(pattern=>pattern.test(contents)))problems.push(`${file}: possible credential`);
}
const examples=['.dev.vars','.dev.vars.production','.env.production','.private/backup.sql','.wrangler/state/db.sqlite','test-results/mock-payment-mobile.png','production.db','operator.pem'];
const ignored=git(['check-ignore','--no-index','--stdin'],examples.join('\n')).trim().split(/\r?\n/);
for(const path of examples)if(!ignored.includes(path))problems.push(`${path}: ignore rule missing`);
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}
else console.log(`PASS: ${files.length} publishable files scanned; credential patterns and private-file exclusions checked. Values are never printed.`);
