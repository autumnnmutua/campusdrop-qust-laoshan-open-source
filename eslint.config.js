import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', '.wrangler/**', 'node_modules/**', '.private/**', 'test-results/**', 'playwright-report/**'] },
  {files:['cloudbase/cloudrun/*.mjs'],languageOptions:{globals:{process:'readonly',console:'readonly',Buffer:'readonly',URL:'readonly',Headers:'readonly',Request:'readonly',setInterval:'readonly'}}},
  js.configs.recommended, ...tseslint.configs.recommended,
  { files:['cloudbase/functions/**/*.js'],languageOptions:{sourceType:'commonjs',globals:{exports:'readonly',process:'readonly',Buffer:'readonly',URL:'readonly',fetch:'readonly',AbortSignal:'readonly'}}},
  { files:['tests-cloudbase/*.mjs'],languageOptions:{globals:{Response:'readonly'}}},
  { files: ['scripts/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', document: 'readonly', innerWidth: 'readonly', fetch: 'readonly', AbortSignal: 'readonly' } } },
);
