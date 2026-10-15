import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

/**
 * Self-hosted OCR assets for the in-browser pickup-code recognition. Copies the tesseract.js worker, the LSTM-only
 * WebAssembly cores and the English model from node_modules into public/ocr/<version>/ before dev or build, so the
 * site never loads code or data from a third-party CDN (the CSP forbids it anyway). public/ocr/ is git-ignored.
 */
const require = createRequire(import.meta.url);
const pkgDir = name => dirname(require.resolve(`${name}/package.json`));
export const OCR_VERSION = JSON.parse(readFileSync(join(pkgDir('tesseract.js'), 'package.json'), 'utf8')).version;

function files() {
  const js = pkgDir('tesseract.js'), core = pkgDir('tesseract.js-core'), lang = pkgDir('@tesseract.js-data/eng');
  const out = join(process.cwd(), 'public', 'ocr', OCR_VERSION);
  return [
    [join(js, 'dist', 'worker.min.js'), join(out, 'worker.min.js')],
    // Apache-2.0 notices travel with the redistributed files.
    [join(js, 'LICENSE.md'), join(out, 'LICENSE-tesseract.js.md')],
    [join(js, 'dist', 'worker.min.js.LICENSE.txt'), join(out, 'worker.min.js.LICENSE.txt')],
    [join(core, 'LICENSE'), join(out, 'core', 'LICENSE-tesseract.js-core.txt')],
    ...['', 'simd-', 'relaxedsimd-'].map(v => [join(core, `tesseract-core-${v}lstm.wasm.js`), join(out, 'core', `tesseract-core-${v}lstm.wasm.js`)]),
    // "best_int" is the small integer LSTM model (about 3 MB gzipped); enough for digits and dashes.
    [join(lang, '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz')],
  ];
}
export function copyOcrAssets() {
  for (const [from, to] of files()) {
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}
/** Vite plugin: run the copy once when the dev server or a build starts. */
export function ocrAssets() {
  return { name: 'campusdrop-ocr-assets', buildStart() { copyOcrAssets(); }, configureServer() { copyOcrAssets(); } };
}
