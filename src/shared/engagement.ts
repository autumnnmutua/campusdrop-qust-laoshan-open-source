import { z } from 'zod';
import { ANNOUNCEMENT_LEVELS,RATING_TAGS } from './engagement-rules.ts';
export * from './engagement-rules.ts';

const plainText = (max: number) => z.string().trim().max(max).refine(v => !/[<>\p{Cc}]/u.test(v), '请使用普通文字');

// ---------------------------------------------------------------- announcements
export const announcementCreate = z.object({
  level: z.enum(ANNOUNCEMENT_LEVELS),
  title: plainText(40).pipe(z.string().min(1)),
  body: plainText(200),
  /** Hours until the announcement expires; omit for "until archived". */
  durationHours: z.number().int().min(1).max(24 * 60).optional(),
  /** Scheduled start (unix seconds, up to 14 days ahead); omit to publish now. */
  startsAt: z.number().int().positive().optional(),
  /** Only students whose saved dorm is one of these buildings see it; omit for everyone. */
  targets: z.array(z.string().regex(/^(SOUTH|NORTH)_\d{2}$/)).min(1).max(19).refine(v => new Set(v).size === v.length).optional(),
}).strict();
export const announcementArchive = z.object({ confirmed: z.literal(true) }).strict();

// ---------------------------------------------------------------- ratings
export const ratingCreate = z.object({
  stars: z.number().int().min(1).max(5),
  tags: z.array(z.enum(RATING_TAGS)).max(5).refine(v => new Set(v).size === v.length, '标签不能重复'),
  comment: plainText(120),
}).strict();
