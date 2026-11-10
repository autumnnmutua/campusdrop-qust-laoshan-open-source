/* © 2026 专业团队 · CampusDrop v4.5.0 */
import { spawnSync } from 'node:child_process';
import { readFileSync,existsSync,readdirSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import ignore from 'ignore';
function git(args,input) {
  const r=spawnSync('git',args,{encoding:'utf8',input,windowsHide:true});
  if(r.status!==0)throw new Error('Git security inventory failed');
  return r.stdout;
}
const root=process.cwd();
const gitRoot=spawnSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true});
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const inRepository=gitRoot.status===0 && samePath(realpathSync(root),realpathSync(gitRoot.stdout.trim()));
const rootIgnore=ignore().add(readFileSync('.gitignore','utf8'));
const problems=[];
// A downloaded source archive has no .git directory. Apply its ignore files while walking it,
// instead of requiring the user to initialise a repository just to run the release checks.
function archiveFiles() {
  const files=[];
  function walk(directory,rules) {
    for(const entry of readdirSync(join(root,directory),{withFileTypes:true})) {
      const file=directory?`${directory}/${entry.name}`:entry.name;
      if(file==='.git')continue;
      let ignored=false;
      for(const rule of rules) {
        const relative=rule.prefix?file.slice(rule.prefix.length+1):file;
        const match=rule.filter.test(relative+(entry.isDirectory()?'/':''));
        if(match.ignored)ignored=true;
        else if(match.unignored)ignored=false;
      }
      if(ignored)continue;
      if(entry.isSymbolicLink()){problems.push(`${file}: symbolic link not scanned`);continue;}
      if(entry.isDirectory()) {
        const ignoreFile=join(root,file,'.gitignore');
        walk(file,existsSync(ignoreFile)?[...rules,{prefix:file,filter:ignore().add(readFileSync(ignoreFile,'utf8'))}]:rules);
      } else if(entry.isFile()) files.push(file);
    }
  }
  walk('',[{prefix:'',filter:rootIgnore}]);
  return files;
}
const files=inRepository?[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))]:archiveFiles();
const forbidden=/(^|\/)(\.dev\.vars[^/]*|\.env(?!\.example$)[^/]*|\.npmrc|[^/]+\.(?:sqlite(?:3)?|db|pem|key|p12|pfx))$|^(?:\.wrangler|\.private|test-results|node_modules|dist|playwright-report)\//;
const patterns=[/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{40,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/(?:CLOUDFLARE_API_TOKEN|D1_SECRET)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/];
for(const file of files) {
  if(!existsSync(file))continue;
  if(forbidden.test(file)){problems.push(`${file}: forbidden file`);continue;}
  const contents=readFileSync(file,'utf8');
  if(patterns.some(pattern=>pattern.test(contents)))problems.push(`${file}: possible credential`);
}
const examples=['.dev.vars','.dev.vars.production','.env.production','.private/backup.sql','.wrangler/state/db.sqlite','test-results/mock-payment-mobile.png','production.db','operator.pem'];
const ignored=inRepository?git(['check-ignore','--no-index','--stdin'],examples.join('\n')).trim().split(/\r?\n/):examples.filter(path=>rootIgnore.ignores(path));
for(const path of examples)if(!ignored.includes(path))problems.push(`${path}: ignore rule missing`);
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}
else console.log(`PASS: ${files.length} publishable files scanned (${inRepository?'Git repository':'source archive'}); credential patterns and private-file exclusions checked. Values are never printed.`);
