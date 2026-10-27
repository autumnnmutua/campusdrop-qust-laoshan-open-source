import { z } from 'zod';
import { CALIBRATION_LANDMARKS } from './campus-map.ts';
import { SLOT_CODES } from './slots.ts';

const plainText = (max: number) => z.string().trim().min(1).max(max).refine(v => !/[<>\p{Cc}]/u.test(v), '请使用普通文字');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const slotCodeSchema = z.enum(SLOT_CODES);

// ---------------------------------------------------------------- handoff code
export const handoffCodeSchema = z.object({ code: z.string().regex(/^\d{4}$/), version: z.number().int().nonnegative() }).strict();

// ---------------------------------------------------------------- order chat
export const chatMessageSchema = z.object({ body: plainText(300) }).strict();
export interface ChatMessage { id: number; senderKind: 'STUDENT' | 'ADMIN'; mine: boolean; body: string; createdAt: number; readAt: number | null }

// ---------------------------------------------------------------- courier location and map
export const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(5000) }).strict();
export const calibrationSchema = z.object({
  points: z.array(z.object({ landmark: z.enum(CALIBRATION_LANDMARKS), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict()).length(2)
    .refine(p => p[0].landmark !== p[1].landmark, '请选择两个不同的地标'),
}).strict();
export interface CourierPosition { x: number; y: number; source: 'gps' | 'estimate'; updatedAt: number | null }
export interface OrderEta { minutes: number; basis: 'history' | 'distance' | 'slot'; arriveBy: number; label: string }
export interface OrderLive { eta: OrderEta | null; courier: CourierPosition | null; calibrated: boolean }
export interface MapCourier { id: string; username: string; x: number; y: number; updatedAt: number; active: number }
export interface MapBuildingLoad { code: string; active: number; exceptions: number; awaitingReceipt: number }
export interface LiveMapData { buildings: MapBuildingLoad[]; couriers: MapCourier[]; calibrated: boolean; slots: { date: string; code: string; booked: number }[] }

// ---------------------------------------------------------------- web push
export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/) }).strict(),
}).strict();
export const pushRemoveSchema = z.object({ endpoint: z.url({ protocol: /^https$/ }).max(1000) }).strict();

// ---------------------------------------------------------------- account deletion
export const ACCOUNT_DELETE_PHRASE = '注销我的账号';
export const accountDeleteSchema = z.object({ confirm: z.literal(ACCOUNT_DELETE_PHRASE) }).strict();

// ---------------------------------------------------------------- realtime events pushed over the live socket
export type LiveEvent =
  | { type: 'order'; orderId: string | null; kind: string }
  | { type: 'chat'; orderId: string }
  | { type: 'location'; orderId: string }
  | { type: 'hello' };
