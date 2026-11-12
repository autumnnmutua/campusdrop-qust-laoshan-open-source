/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-D8774AE8A9 */
import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * Lets any route schedule work (live events, web push) after the response without threading ExecutionContext through
 * every handler. Outside a request (tests, scheduled jobs) the task simply runs unawaited.
 */
const waitUntil = new AsyncLocalStorage<(task: Promise<unknown>) => void>();
export function withBackground<T>(ctx: ExecutionContext, run: () => Promise<T>): Promise<T> {
  return waitUntil.run(task => ctx.waitUntil(task), run);
}
export function background(task: Promise<unknown>): void {
  const safe = task.catch(error => console.warn('background task failed', error));
  waitUntil.getStore()?.(safe);
}
