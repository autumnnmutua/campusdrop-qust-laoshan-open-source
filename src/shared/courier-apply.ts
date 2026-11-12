/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-85C30D55F3 */
import { z } from 'zod';
import { passwordSchema, usernameSchema } from './contracts.ts';

/*
 * v4.5 · 同学申请当兼职配送员. The student fills in who they are, when they are free and the courier username and password
 * they want (only a hash is kept). A super admin approves (the courier account is created from the application, with
 * the phone as its contact) or declines with a reason; the result arrives in the student's inbox.
 */
export const APPLY_SLOTS = ['NOON', 'EVENING', 'NIGHT', 'WEEKEND'] as const;
export const APPLY_SLOT_LABELS: Record<typeof APPLY_SLOTS[number], string> = { NOON: '午间 11:30–13:00', EVENING: '傍晚 17:00–19:00', NIGHT: '晚间 20:00–22:00', WEEKEND: '周末白天' };
const plain = (max: number) => z.string().trim().max(max).refine(v => !/[<>\p{Cc}]/u.test(v), '请使用普通文字');

export const courierApplicationSchema = z.object({
  realName: plain(20).pipe(z.string().min(1, '请填写姓名')),
  phone: z.string().regex(/^1[3-9]\d{9}$/, '请填写 11 位手机号'),
  college: plain(40).default(''),
  grade: plain(20).default(''),
  slots: z.array(z.enum(APPLY_SLOTS)).min(1, '至少选一个空闲时段').max(4).refine(v => new Set(v).size === v.length),
  zone: z.enum(['SOUTH', 'NORTH']).nullable().default(null),
  /** Where the student lives: building (from the delivery list) and room, used to give them buildings nearby. */
  buildingCode: z.string().regex(/^[A-Z0-9_]{2,32}$/, '请选择住的楼栋'),
  roomNo: plain(32).default(''),
  intro: plain(200).default(''),
  desiredUsername: usernameSchema,
  password: passwordSchema,
  agree: z.literal(true, { message: '请先阅读并同意配送员须知' }),
}).strict();
export type CourierApplicationInput = z.infer<typeof courierApplicationSchema>;

export const applicationReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: plain(120).default(''),
  /** On approval: buildings whose 小件 the new courier takes over right away (optional). */
  buildings: z.array(z.string().regex(/^[A-Z0-9_]{2,32}$/)).max(40).default([]),
}).strict().refine(v => v.decision === 'APPROVE' || v.note.length > 0, { message: '不通过时请写明原因，同学会在站内消息里看到', path: ['note'] });

export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export interface CourierApplication {
  id: string; realName: string; phone: string; college: string; grade: string; slots: (typeof APPLY_SLOTS[number])[]; zone: 'SOUTH' | 'NORTH' | null;
  buildingCode: string | null; buildingName: string | null; roomNo: string;
  intro: string; desiredUsername: string; status: ApplicationStatus; note: string; createdAt: number; reviewedAt: number | null;
  /** Admin view only. */
  studentName?: string; studentUsername?: string; completedOrders?: number;
}
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = { PENDING: '审核中', APPROVED: '已通过', REJECTED: '未通过', WITHDRAWN: '已撤回' };
