import { z } from 'zod';

/** v3.6 one-click demo (一键体验). */
export const demoStartSchema = z.object({ passcode: z.string().trim().min(1).max(64) }).strict();
export const demoAutoSchema = z.object({ auto: z.boolean() }).strict();
export interface DemoStatus { active: boolean; auto: boolean; courierName: string | null }
/** Seconds the simulated courier waits before each step (claim after payment, then pick up, then set off). */
export const DEMO_STEPS = { claim: 6, pickup: 14, depart: 10 } as const;
/** Seconds the simulated ride from station to door takes on the map. */
export const DEMO_RIDE_SECONDS = 75;
