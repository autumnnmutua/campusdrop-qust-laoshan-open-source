// node:crypto is supported by Cloudflare with nodejs_compat; production probe verified scrypt.
import { scrypt } from 'node:crypto';
export const SCRYPT_PARAMETERS = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 } as const;
const encoder = new TextEncoder();
function hex(bytes: Uint8Array): string { return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join(''); }
function unhex(s: string): Uint8Array<ArrayBuffer> { return new Uint8Array(s.match(/.{2}/g)!.map(x => parseInt(x, 16))); }
async function derive(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Promise((resolve,reject) => scrypt(password,salt,32,SCRYPT_PARAMETERS,(error,key) => error ? reject(error) : resolve(new Uint8Array(key))));
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 6 || password.length > 128 || encoder.encode(password).length > 256) throw new Error('Invalid password length');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `scrypt$16384$8$5$${hex(salt)}$${hex(await derive(password, salt))}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > 128 || encoder.encode(password).length > 256) return false;
  const match = /^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored);
  const legacy = /^pbkdf2-sha256\$600000\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored);
  if (!match && !legacy) return false;
  let actual: Uint8Array;
  if(match) actual=await derive(password,unhex(match[1]));
  else {
    // Compatibility for old LOCAL RC data only. Hosted Workers reject this work factor.
    const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
    try { actual=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(legacy![1]),iterations:600000},key,256)); }
    catch(error) { if(error instanceof Error && error.name==='NotSupportedError') return false; throw error; }
  }
  const expected=unhex((match??legacy)![2]);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
export async function digest(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
export function randomToken(): string { return hex(crypto.getRandomValues(new Uint8Array(32))); }
// Constant non-account hash keeps unknown-user login work equivalent.
export const DUMMY_HASH = `scrypt$16384$8$5$${'00'.repeat(16)}$${'00'.repeat(32)}`;
