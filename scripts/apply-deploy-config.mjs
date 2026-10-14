// CI-only: fill the production placeholders in wrangler.jsonc from environment variables, in the runner's working copy.
// The committed template keeps its placeholders; release.mjs still refuses to publish if anything is left unset.
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const id = process.env.PROD_D1_DATABASE_ID ?? '', origin = process.env.PROD_APP_ORIGIN ?? '';
if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id)) throw new Error('PROD_D1_DATABASE_ID must be the production D1 UUID');
if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('PROD_APP_ORIGIN must be an exact https origin');

const path = 'wrangler.jsonc', placeholders = { '11111111-1111-1111-1111-111111111111': id, 'https://configure-production.invalid': origin };
let text = readFileSync(path, 'utf8');
for (const [placeholder, value] of Object.entries(placeholders)) {
  // A copy that already carries the real value (e.g. the release zip) is fine; anything else is a config error.
  if (!text.includes(placeholder) && text.includes(value)) continue;
  if (text.split(placeholder).length !== 2) throw new Error(`Expected exactly one ${placeholder} in ${path}`);
  text = text.replace(placeholder, value);
}
writeFileSync(path, text);
console.log('Production deployment values applied to the working copy of wrangler.jsonc.');
