import { z } from 'zod';
import { CARRIERS } from './constants.ts';
import { SLOT_CODES } from './slots.ts';
import { WEBHOOK_EVENTS, WEBHOOK_HOSTS, WEBHOOK_KINDS } from './operations-rules.ts';
export * from './operations-rules.ts';

const plainText = (max: number) => z.string().trim().max(max).refine(v => !/[<>\p{Cc}]/u.test(v), '请使用普通文字');
const version = z.number().int().nonnegative();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------------------------------------------------------- send service
export const sendCreateSchema = z.object({
  packageSize: z.enum(['SMALL', 'LARGE']), carrier: z.enum(CARRIERS), note: plainText(120),
  slotDate: dateSchema, slotCode: z.enum(SLOT_CODES), confirmed: z.literal(true),
}).strict();
export const sendActionSchema = z.object({ version, confirmed: z.literal(true) }).strict();
export const sendDropSchema = z.object({ version, trackingNo: z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/, '单号只能包含字母、数字和横线') }).strict();
export const sendCancelSchema = z.object({ version, reason: plainText(120).pipe(z.string().min(1)) }).strict();

// ---------------------------------------------------------------- orders: drop-off, roommate pickup, near, photo
export const proxySchema = z.object({ name: plainText(16), version }).strict();
export const nearSchema = z.object({ version }).strict();

// ---------------------------------------------------------------- shifts and settings
export const shiftsSchema = z.object({
  slots: z.array(z.object({ date: dateSchema, code: z.enum(SLOT_CODES) }).strict()).max(9)
    .refine(v => new Set(v.map(s => s.date + s.code)).size === v.length, '时段不能重复'),
}).strict();
export const pauseSchema = z.object({ paused: z.boolean(), reason: plainText(60) }).strict()
  .refine(v => !v.paused || v.reason.length > 0, '暂停接单时请填写原因');
export const webhookSchema = z.object({
  kind: z.enum(WEBHOOK_KINDS),
  url: z.url({ protocol: /^https$/ }).max(300),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).refine(v => new Set(v).size === v.length),
}).strict().refine(v => WEBHOOK_HOSTS[v.kind].includes(new URL(v.url).hostname), '请填写所选平台的官方机器人地址');
export const webhookTestSchema = z.object({ confirmed: z.literal(true) }).strict();
export const shiftCapacitySchema = z.object({
  enabled: z.boolean(),
  quota: z.object({ NOON: z.number().int().min(0).max(100), EVENING: z.number().int().min(0).max(100), NIGHT: z.number().int().min(0).max(100) }).strict(),
}).strict();
