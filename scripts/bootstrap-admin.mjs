import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/domain/password.ts';
import { requireProduction } from './deployment-config.mjs';

// Trusted operator provisioning, not an HTTP bootstrap route. No default credentials.
const remote = process.argv.includes('--remote-production');
if (process.argv.slice(2).some(arg => arg !== '--remote-production')) throw new Error('Unknown bootstrap option');
if (remote) requireProduction();
const username = process.env.CAMPUSDROP_ADMIN_USERNAME?.trim().toLowerCase();
const password = process.env.CAMPUSDROP_ADMIN_PASSWORD;
if (!username || !/^[a-z0-9_]{3,32}$/.test(username) || !password || password.length < 12) {
  console.error('Provide CAMPUSDROP_ADMIN_USERNAME and CAMPUSDROP_ADMIN_PASSWORD through your local environment. Password: 12–128 characters, at most 256 UTF-8 bytes.');
  process.exit(1);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = await hashPassword(password);
const adminId = randomUUID();
delete process.env.CAMPUSDROP_ADMIN_PASSWORD;
const folder = await mkdtemp(join(tmpdir(), 'campusdrop-admin-'));
const sqlPath = join(folder, 'bootstrap.sql');
try {
  // Single statement: once any administrator exists this command cannot add another.
  const sql = `INSERT INTO admin_users(id, username, password_hash, role)
SELECT '${adminId}', '${username}', '${hash}', 'SUPER_ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM admin_users) RETURNING id;`;
  await writeFile(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'DB', ...(remote ? ['--remote', '--env', 'production'] : ['--local']), '--config', join(root,'wrangler.jsonc'), '--file', sqlPath, '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    console.error('Provisioning failed. Check migrations, environment and Wrangler access. Database output is hidden to protect the password hash.');
    process.exitCode = 1;
  } else {
    // Remote file imports print progress even with --json and omit RETURNING rows.
    // Verify the exact generated id with a separate read; never parse or print import output.
    const check = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'd1', 'execute', 'DB', ...(remote ? ['--remote', '--env', 'production'] : ['--local']), '--config', join(root,'wrangler.jsonc'),
      '--command', `SELECT count(*) AS n FROM admin_users WHERE id='${adminId}'`, '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if(check.status!==0)throw new Error('Provisioning verification failed; inspect account state before retrying.');
    let records;
    try { records=JSON.parse(check.stdout); } catch { throw new Error('Provisioning verification output was unexpected; inspect account state before retrying.'); }
    const changes = records.reduce((sum, r) => sum + (r.results?.[0]?.n ?? 0), 0);
    console.log(changes ? `Initial ${remote ? 'production' : 'local'} administrator created. Sign in through /admin/login.` : 'An administrator already exists. No account was added or changed.');
  }
} finally {
  await rm(sqlPath, { force: true });
  await rmdir(folder);
}
