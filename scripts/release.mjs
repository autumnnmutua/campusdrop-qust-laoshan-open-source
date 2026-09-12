import { spawnSync } from 'node:child_process';
import { requireDeployment, readConfig, commandEnvironment } from './deployment-config.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const mode = process.argv[2];
const target=process.argv[3]??'production';
if(!['production','staging'].includes(target)||process.argv.length>4)throw new Error('Unknown deployment target');
function run(cli, args, production = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', windowsHide: true, env: production?{...process.env,CLOUDFLARE_ENV:target}:commandEnvironment(false) });
  if (result.status !== 0) throw new Error('操作失败，后续步骤未执行');
}
try {
  if (!['check', 'build', 'deploy', 'dry-run', 'migrate'].includes(mode)) throw new Error('Unknown release operation');
  // Building placeholders is safe and enables offline runtime inspection. Publishing is fail-closed.
  if (mode !== 'build') requireDeployment(target);
  if (mode === 'check') console.log('生产配置检查通过。此检查未连接远端 D1，也未发布。');
  else if (mode === 'migrate') run('node_modules/wrangler/bin/wrangler.js', ['d1', 'migrations', 'apply', 'DB', '--remote', '--env', target, '--config', 'wrangler.jsonc']);
  else {
    run('node_modules/vite/bin/vite.js', ['build','--config','vite.workers.config.ts']);
    if (mode !== 'build') {
      const redirectPath = '.wrangler/deploy/config.json';
      const redirect = JSON.parse(readFileSync(redirectPath, 'utf8'));
      const builtPath = resolve(dirname(redirectPath), redirect.configPath);
      const built = readConfig(builtPath), source = requireDeployment(target).env[target];
      if (built.vars?.APP_ENV !== target || built.vars.APP_ORIGIN !== source.vars.APP_ORIGIN || built.name !== source.name || built.d1_databases?.[0]?.database_id !== source.d1_databases[0].database_id) throw new Error('构建产物与生产配置不一致，已阻止部署');
      // Vite already resolved production into this flat config. Selecting it again appends the suffix twice.
      run('node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', builtPath, ...(mode === 'dry-run' ? ['--dry-run'] : [])], false);
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
