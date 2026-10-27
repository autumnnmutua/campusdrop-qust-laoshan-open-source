import { webcrypto } from 'node:crypto';
/**
 * Generates a VAPID key pair for web push and prints the wrangler commands that store it as Worker secrets.
 * Keys are printed to this terminal only; nothing is written to disk. Run once per deployment and keep the private
 * key secret: rotating it invalidates every existing browser subscription.
 */
const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = Buffer.from(await webcrypto.subtle.exportKey('raw', publicKey)).toString('base64url');
const { d } = await webcrypto.subtle.exportKey('jwk', privateKey);
const env = process.argv[2] ?? 'production';
console.log(`VAPID_PUBLIC_KEY=${raw}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log('\n保存为 Worker 密钥（每条命令会提示粘贴对应的值）：');
console.log(`  npx wrangler secret put VAPID_PUBLIC_KEY --env ${env}`);
console.log(`  npx wrangler secret put VAPID_PRIVATE_KEY --env ${env}`);
console.log(`  npx wrangler secret put VAPID_SUBJECT --env ${env}   # 例如 mailto:你的邮箱，或站点 https 地址`);
console.log('\n本地开发：把上面两行 KEY=值 写进 .dev.vars（已被 .gitignore 忽略）。');
