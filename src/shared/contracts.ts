/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-13F800AB80 */
import { z } from 'zod';
import { CAMPUS_ID } from './constants.ts';
export { CAMPUS_ID };
export const zoneSchema = z.enum(['SOUTH', 'NORTH']);
export const roleSchema = z.enum(['SUPER_ADMIN', 'ZONE_ADMIN', 'BUILDING_ADMIN', 'DELIVERY_STAFF']);
export type AdminRole = z.infer<typeof roleSchema>;
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/);
export const passwordSchema = z.string().min(12).max(128).refine(v => new TextEncoder().encode(v).length <= 256);
const safeText = z.string().trim().min(1).max(32).refine(v => !/[<>\p{Cc}]/u.test(v));
export const profileSchema = z.object({ name: safeText, phone: z.string().regex(/^1[3-9]\d{9}$/) }).strict();
export const studentPasswordSchema = z.string().min(6).max(128).refine(v => new TextEncoder().encode(v).length <= 256);
export const registerSchema = profileSchema.extend({ username: usernameSchema, password: studentPasswordSchema }).strict();
export const loginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) }).strict();
/** Building codes: numbered dorms (SOUTH_04, NORTH_10) and, since v3.7, other buildings (LIBRARY_HALL, NORTH_B1 …). The database decides which exist. */
export const buildingCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/);
export const addressSchema = z.object({
  campusId: z.literal(CAMPUS_ID), zone: zoneSchema,
  buildingCode: buildingCodeSchema, roomNo: safeText,
}).strict();
export const scopeSchema = z.object({
  campusId: z.literal(CAMPUS_ID), zone: zoneSchema.nullable(),
  buildingCode: buildingCodeSchema.nullable(),
}).strict();
export const createAdminSchema = z.object({
  username: usernameSchema, password: passwordSchema, role: roleSchema,
  scopes: z.array(scopeSchema).max(19),
}).strict().superRefine((v, ctx) => {
  const valid = v.role === 'SUPER_ADMIN' || v.role === 'DELIVERY_STAFF'
    ? v.scopes.length === 0
    : v.scopes.length > 0 && v.scopes.every(s => v.role === 'BUILDING_ADMIN' ? !!s.buildingCode : !!s.zone);
  if (!valid) ctx.addIssue({ code: 'custom', message: '管理员范围与角色不匹配' });
});
export type Scope = z.infer<typeof scopeSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export interface Address extends AddressInput { id: string; buildingName: string; validFrom: number }
export interface Student { id: string; username: string; name: string; phone: string; /** v3.6 one-click demo account */ demo?: boolean }
export const adminContactSchema = z.object({phone:profileSchema.shape.phone}).strict();
export interface Admin { phone?:string|null; id: string; username: string; role: AdminRole; scopes: Scope[]; /** v3.6 one-click demo courier */ demo?: boolean }
export interface Building { code: string; displayName: string; zone: 'SOUTH' | 'NORTH' }
/** v3.9 · 账号管理 (super admins): mark a student account as test-only, or clear it. */
export const studentTestFlagSchema = z.object({ testAccount: z.boolean() }).strict();
export const studentAdminDeleteSchema = z.object({ confirmed: z.literal(true) }).strict();
