import type { LiveHub } from './live';
/**
 * Bindings from wrangler.jsonc plus optional secrets. LIVE is optional so the worker keeps serving (with polling on the
 * client) when a deployment has no Durable Object binding; web push stays off until the VAPID secrets are set.
 */
export type Env = Omit<WorkerBindings, 'LIVE'> & {
  LIVE?: DurableObjectNamespace<LiveHub>;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};
