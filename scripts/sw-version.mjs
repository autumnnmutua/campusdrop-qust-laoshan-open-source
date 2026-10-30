import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Stamps the service worker with a build id. public/sw.js carries the placeholder __SW_BUILD__; after the client build
 * it becomes a short hash of the hashed asset names, so every release gets a new cache name and the activate step
 * drops the previous release's caches instead of letting them grow forever.
 */
export function swVersion() {
  let root = process.cwd();
  return {
    name: 'campusdrop-sw-version',
    apply: 'build',
    configResolved(config) { root = config.root; },
    closeBundle() {
      const env = this.environment;
      if (env && env.name !== 'client') return;
      const outDir = resolve(root, env?.config.build.outDir ?? 'dist'), sw = join(outDir, 'sw.js');
      if (!existsSync(sw)) return;
      const assets = existsSync(join(outDir, 'assets')) ? readdirSync(join(outDir, 'assets')).sort() : [];
      const build = createHash('sha256').update(assets.join('|')).digest('hex').slice(0, 10);
      writeFileSync(sw, readFileSync(sw, 'utf8').replace("'campusdrop-__SW_BUILD__'", `'campusdrop-${build}'`));
    },
  };
}
