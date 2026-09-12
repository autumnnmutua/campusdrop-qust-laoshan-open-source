import { z } from 'zod';
export const CAMPUS_ID = 'QUST_LAOSHAN' as const;
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
export const addressSchema = z.object({
  campusId: z.literal(CAMPUS_ID), zone: zoneSchema,
  buildingCode: z.string().regex(/^(SOUTH|NORTH)_\d{2}$/), roomNo: safeText,
}).strict();
export const scopeSchema = z.object({
  campusId: z.literal(CAMPUS_ID), zone: zoneSchema.nullable(),
  buildingCode: z.string().regex(/^(SOUTH|NORTH)_\d{2}$/).nullable(),
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
export interface Student { id: string; username: string; name: string; phone: string }
export const adminContactSchema = z.object({phone:profileSchema.shape.phone}).strict();
export interface Admin { phone?:string|null; id: string; username: string; role: AdminRole; scopes: Scope[] }
export interface Building { code: string; displayName: string; zone: 'SOUTH' | 'NORTH' }
