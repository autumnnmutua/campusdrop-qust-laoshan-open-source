import type { z } from 'zod';
import type { Env } from './types';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const response = Response.json(data, { status, headers });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
export function checkOrigin(request: Request, env: Env): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('Origin') !== env.APP_ORIGIN) throw new ApiError(403, 'ORIGIN_REJECTED', '请从本站页面提交操作');
}
export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED', '请提交 JSON 数据');
  if (Number(request.headers.get('Content-Length')) > 8192) throw new ApiError(413, 'BODY_TOO_LARGE', '提交内容过长');
  // Bound actual streamed bytes; do not trust the client Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_INPUT', '缺少提交内容');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE', '提交内容过长'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, 'INVALID_JSON', 'JSON 格式错误'); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', '请检查填写格式，不要提交额外字段');
  return parsed.data;
}
