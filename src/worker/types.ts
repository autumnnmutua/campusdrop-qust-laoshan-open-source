/* © 2026 专业团队 · CampusDrop v4.0.0 */
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
  /** v3.5 AI features (secrets, all optional): OpenAI-compatible chat-completions endpoint. Without a key the features
   * answer from local rules and FAQ retrieval. */
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_DAILY_LIMIT?: string;
  /** v3.6: vision model for the opt-in screenshot fallback (default qwen-vl-plus). */
  AI_VISION_MODEL?: string;
  AI_VISION?: string;
  /** v3.6 demo passcode (all environments default to "off"). */
  DEMO_PASSCODE?: string;
  /** v3.7: one-click demos per Beijing day (default 12). Each demo writes a few thousand rows of starting data. */
  DEMO_DAILY_LIMIT?: string;
};
