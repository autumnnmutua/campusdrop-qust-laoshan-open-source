/**
 * Client bundle split shared by the static (vite.config.ts) and Workers (vite.workers.config.ts) builds. React and the
 * router change far less often than the app, so they get their own long-cached chunk; zod is only reached through
 * lazily loaded form validation and admin pages, so it stays out of the first-load bundle.
 */
export function manualChunks(id) {
  if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'vendor-react';
  if (/\/node_modules\/zod\//.test(id)) return 'zod';
}
