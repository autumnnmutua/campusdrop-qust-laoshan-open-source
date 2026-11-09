/* © 2026 专业团队 · CampusDrop v4.5.0 */
import { z } from 'zod';

/** v3.6 one-click demo (一键体验). */
export const demoStartSchema = z.object({ passcode: z.string().trim().min(1).max(64) }).strict();
export const demoAutoSchema = z.object({ auto: z.boolean() }).strict();
/** `super` is the demo's 超级管理员 (v3.7.1); `senior` is its v3.7.0 name, still accepted. */
export const demoRoleSchema = z.object({ role: z.enum(['courier', 'super', 'senior']) }).strict();
export type DemoAdminRole = 'courier' | 'super';
/** `adminRole`: which demo admin the admin cookie is signed in as right now (v3.7); `seniorName` is the 超级管理员's. */
export interface DemoStatus { active: boolean; auto: boolean; courierName: string | null; seniorName: string | null; adminRole: DemoAdminRole | null; studentUsername: string | null }
/** Seconds the simulated courier waits before each step (claim after payment, then pick up, then set off). */
export const DEMO_STEPS = { claim: 6, pickup: 14, depart: 10 } as const;
/** Seconds the simulated ride from station to door takes on the map. */
export const DEMO_RIDE_SECONDS = 75;
