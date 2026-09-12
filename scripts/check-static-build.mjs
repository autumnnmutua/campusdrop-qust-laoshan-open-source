import { readdirSync,readFileSync,existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const cloudbase=JSON.parse(readFileSync('cloudbaserc.json','utf8'));
assert.ok(typeof cloudbase.envId==='string'&&cloudbase.envId.trim().length>0,'CloudBase CLI requires envId in cloudbaserc.json, even when -e is provided');
assert.equal(cloudbase.hosting?.[0]?.outputDir,'dist','CloudBase output directory must match Vite');
assert.ok(existsSync('dist/index.html'),'Missing dist/index.html');
const files=readdirSync('dist/assets').filter(f=>/\.(js|css)$/.test(f));
for(const file of files){const s=readFileSync(`dist/assets/${file}`,'utf8');assert.ok(!/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/api/.test(s),`Local API leaked into ${file}`);assert.ok(!s.includes('/v1/ai/cloudbase'),'AI gateway incorrectly used as business API');}
assert.ok(!existsSync('dist/campusdrop_qust_laoshan'),'Worker must not be uploaded as static content');
console.log('PASS: CloudBase static dist/index.html, bundled assets, no localhost business API or Worker server artifacts.');
