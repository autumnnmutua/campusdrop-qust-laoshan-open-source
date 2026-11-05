import type { Env } from './types';

/*
 * The model connection shared by the AI features (v3.5 assistant and ops summary, v3.6 agent and screenshot vision):
 * any OpenAI-compatible chat-completions endpoint set by the operator (AI_API_KEY, AI_BASE_URL, AI_MODEL,
 * AI_VISION_MODEL), with a per-day call cap (AI_DAILY_LIMIT) counted in ai_usage.
 */
const now = () => Math.floor(Date.now() / 1000);
const cnDay = (t: number) => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10);
const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-plus';

export const aiModel = (env: Env) => env.AI_MODEL?.trim() || DEFAULT_MODEL;
export function aiBase(env: Env): string | null {
  const base = (env.AI_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, '');
  try {
    const url = new URL(base);
    // HTTPS only; plain http is accepted for a local mock in development.
    if (url.protocol === 'https:' || (import.meta.env.DEV && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return base;
  } catch { /* fall through */ }
  return null;
}

export type Kind = 'ASSISTANT' | 'OPS_SUMMARY' | 'VISION';
/** Counts a model call against today's cap; false when the cap is reached (or the usage table is missing). */
export async function takeQuota(env: Env, kind: Kind): Promise<boolean> {
  const limit = Number(env.AI_DAILY_LIMIT) > 0 ? Number(env.AI_DAILY_LIMIT) : 300;
  const cap = kind === 'ASSISTANT' ? limit : Math.max(10, Math.round(limit / 5));
  try {
    const row = await env.DB.prepare(`INSERT INTO ai_usage(day,kind,calls) VALUES(?,?,1)
      ON CONFLICT(day,kind) DO UPDATE SET calls=calls+1 WHERE calls<? RETURNING calls`).bind(cnDay(now()), kind, cap).first<{ calls: number }>();
    return !!row;
  } catch { return false; }
}
export async function countFallback(env: Env, kind: Kind) {
  try { await env.DB.prepare('INSERT INTO ai_usage(day,kind,calls,fallbacks) VALUES(?,?,0,1) ON CONFLICT(day,kind) DO UPDATE SET fallbacks=fallbacks+1').bind(cnDay(now()), kind).run(); } catch { /* best effort */ }
}

export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
/** One chat-completions call. Throws on any failure (the caller falls back). */
export async function chat(env: Env, messages: Message[], maxTokens = 400): Promise<string> {
  const base = aiBase(env);
  if (!env.AI_API_KEY || !base) throw new Error('AI not configured');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${env.AI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: aiModel(env), messages, temperature: 0.3, max_tokens: maxTokens }),
  });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const data = await response.json() as { choices?: { message?: { content?: unknown } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty model answer');
  return text;
}
export const visionModel = (env: Env) => env.AI_VISION_MODEL?.trim() || 'qwen3-vl-plus';
export const aiConfigured = (env: Env) => !!env.AI_API_KEY && !!aiBase(env);
/** Screenshot vision is available whenever a key is set, unless the operator turns it off (AI_VISION=off). */
export const visionConfigured = (env: Env) => aiConfigured(env) && env.AI_VISION?.trim().toLowerCase() !== 'off';

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type WireMessage =
  | { role: 'system' | 'user'; content: string | unknown[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
/** A raw chat-completions call (tools, images). Returns the first choice's message; throws on any failure. */
export async function completion(env: Env, payload: { model?: string; messages: WireMessage[]; tools?: unknown[]; max_tokens?: number; temperature?: number }, timeoutMs = 20000): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const base = aiBase(env);
  if (!env.AI_API_KEY || !base) throw new Error('AI not configured');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${env.AI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: aiModel(env), temperature: 0.2, max_tokens: 500, ...payload }),
  });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const data = await response.json() as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[] };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('empty model answer');
  const calls = Array.isArray(message.tool_calls) ? (message.tool_calls as ToolCall[]).filter(c => c && typeof c.id === 'string' && typeof c.function?.name === 'string') : undefined;
  return { content: typeof message.content === 'string' ? message.content : null, ...(calls?.length ? { tool_calls: calls } : {}) };
}
/** Model output is shown as plain text: strip markdown decoration and keep it short. */
export const cleanAnswer = (text: string, max = 700) => text.replace(/\r/g, '').replace(/\*\*|__|`+|^#+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

