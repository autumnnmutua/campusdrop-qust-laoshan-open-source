import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { URL } from 'node:url';

export function commandEnvironment(production, base = process.env) {
  const env = { ...base };
  if (production) env.CLOUDFLARE_ENV = 'production';
  else delete env.CLOUDFLARE_ENV;
  return env;
}

export function readConfig(path = 'wrangler.jsonc') {
  const result = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (result.error) throw new Error('Wrangler 配置无法解析');
  return result.config;
}

export function productionIssues(config) {
  const prod = config.env?.production;
  const issues = [];
  if (!prod || prod.vars?.APP_ENV !== 'production') issues.push('production.APP_ENV 必须为 production');
  try {
    const origin = new URL(prod?.vars?.APP_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== prod.vars.APP_ORIGIN || /(^localhost$|^127\.|\.invalid$|\.example$|^example\.)/.test(origin.hostname)) throw new Error();
  } catch { issues.push('APP_ORIGIN 必须是实际部署站点的 HTTPS origin，不能使用占位域名或包含路径'); }
  const db = prod?.d1_databases?.find(d => d.binding === 'DB');
  if (!db || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(db.database_id) || /^0{8}-/.test(db.database_id)) issues.push('请填写远端生产 D1 的真实 database_id');
  if (db?.remote) issues.push('不要在生产配置中启用本地预览远端数据访问 remote:true');
  if (db?.migrations_dir !== 'migrations') issues.push('生产 DB migrations_dir 必须为 migrations');
  if (db?.database_id && config.d1_databases?.some(d => d.database_id === db.database_id)) issues.push('生产 D1 必须与本地/开发绑定隔离');
  if (!prod?.name || prod.name === config.name) issues.push('生产 Worker 必须使用独立名称');
  const assets = prod?.assets ?? config.assets;
  if (assets?.not_found_handling !== 'single-page-application' || !Array.isArray(assets.run_worker_first) || !assets.run_worker_first.includes('/api/*')) issues.push('必须保留 SPA fallback 与 /api/* Worker 优先路由');
  if (Object.keys(prod?.vars ?? {}).some(k => /TOKEN|PASSWORD|SECRET|API_KEY/i.test(k))) issues.push('Secrets 不得写入 vars');
  return issues;
}

export function requireProduction() {
  const config = readConfig(), issues = productionIssues(config);
  if (issues.length) throw new Error(`生产操作已阻止：\n${issues.join('\n')}`);
  return config;
}

export function stagingIssues(config){
 const stage=config.env?.staging,issues=[];
 if(stage?.vars?.APP_ENV!=='staging')issues.push('staging.APP_ENV must be staging');
 if(stage?.name===config.env?.production?.name)issues.push('Staging Worker must be separate');
 if(stage?.vars?.APP_ORIGIN===config.env?.production?.vars?.APP_ORIGIN)issues.push('Staging origin must be separate');
 if(stage?.d1_databases?.[0]?.database_id===config.env?.production?.d1_databases?.[0]?.database_id)issues.push('Staging D1 must be separate');
 return [...issues,...productionIssues({...config,env:{production:{...stage,vars:{...stage?.vars,APP_ENV:'production'}}}})];
}
export function requireDeployment(target){
 if(target==='production')return requireProduction();
 if(target!=='staging')throw new Error('Unknown deployment target');
 const config=readConfig(),issues=stagingIssues(config);if(issues.length)throw new Error(issues.join('\n'));return config;
}
