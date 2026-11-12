/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-69BA64F07B */
import {z} from 'zod';
/**
 * Must be imported before any zod schema module is evaluated: main.tsx imports it first (validation.ts and admin-insights.tsx too, for safety). zod 4 otherwise probes `new Function` when the first object schema is
 * built; under the site's `script-src 'self'` CSP that probe is caught but still reported as a
 * securitypolicyviolation on every page. jitless skips the probe; validation results are identical.
 */
z.config({jitless:true});
