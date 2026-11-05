import { z } from 'zod';
import type { AgentDraft, AgentStep } from './agent.ts';

/*
 * v3.5 · AI features: 智能助手 (students) and AI 运营小结 (operators). Both call a large language model through an
 * OpenAI-compatible chat-completions endpoint configured by the operator (default: Alibaba Cloud Model Studio /
 * 阿里云百炼, model qwen-plus) and fall back to local rules and FAQ retrieval when no key is set, the daily cap is
 * reached or the call fails, so the features always answer.
 */
export const ASSISTANT_MAX_CHARS = 300;
export const ASSISTANT_HISTORY = 6;
const turn = z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(600) }).strict();
export const assistantAskSchema = z.object({
  message: z.string().trim().min(1, '请输入问题').max(ASSISTANT_MAX_CHARS, `问题请控制在 ${ASSISTANT_MAX_CHARS} 字以内`),
  history: z.array(turn).max(ASSISTANT_HISTORY).optional(),
}).strict();
export type AssistantAsk = z.infer<typeof assistantAskSchema>;

/** Where an answer came from: the configured model, or the local rules / FAQ retrieval. */
export type AiSource = 'MODEL' | 'LOCAL';
export interface AssistantLink { label: string; to: string }
export interface AssistantReply {
  answer: string;
  source: AiSource;
  /** Model name when source is MODEL (shown to the user). */
  model: string | null;
  /** Why the local answer was used, when it was (no key, daily cap, model error). */
  fallbackReason: 'NOT_CONFIGURED' | 'DAILY_LIMIT' | 'MODEL_ERROR' | null;
  links: AssistantLink[];
  /** FAQ questions the answer drew on (retrieval), for transparency. */
  references: string[];
  /** v3.6: delivery drafts the agent prepared (confirmed by the student in the panel) and the steps it took. */
  drafts?: AgentDraft[];
  steps?: AgentStep[];
}
export const ASSISTANT_SUGGESTIONS = ['把南十的包裹合并，晚上送寝室', '我的包裹到哪了？', '楼下和送到寝室差多少钱？', '南十对面的驿站能寄件吗？', '好几件包裹能一起送吗？', '下雨天会晚吗？', '怎么预约晚上送？'] as const;

export interface OpsSummary {
  days: number;
  bullets: string[];
  source: AiSource;
  model: string | null;
  fallbackReason: AssistantReply['fallbackReason'];
  generatedAt: number;
  /** The figures the summary was written from, so it can be checked against the dashboard. */
  facts: Record<string, string | number | null>;
}
