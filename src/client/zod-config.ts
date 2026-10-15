import {z} from 'zod';
/**
 * Must be the first import of the client entry. zod 4 otherwise probes `new Function` when the first object schema is
 * built; under the site's `script-src 'self'` CSP that probe is caught but still reported as a
 * securitypolicyviolation on every page. jitless skips the probe; validation results are identical.
 */
z.config({jitless:true});
