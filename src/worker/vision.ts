import type { Env } from './types';
import { ApiError, json } from './http';
import { requireStudent } from './session';
import { rateLimit } from './rate-limit';
import { codesFromVision } from '../shared/vision';
import { completion, countFallback, takeQuota, visionConfigured, visionModel } from './ai-model';

/*
 * v3.6 · 截图识别大模型兜底. On-device OCR (tesseract.js) stays the default and the image never leaves the browser.
 * Only when the student taps "用大模型识别" on a screenshot does the page send a downscaled JPEG here; it is passed to
 * the configured vision model (default qwen3-vl-plus) and is not stored or logged. The answer is reduced to pickup
 * codes that match the code format, which go into the same review list as OCR results — the student still checks
 * every code before registering. Separate daily cap (VISION, a fifth of AI_DAILY_LIMIT, at least 10).
 */
export const VISION_MAX_BYTES = 800 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function readImage(request: Request): Promise<{ type: string; base64: string }> {
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (!TYPES.includes(type)) throw new ApiError(415, 'IMAGE_REQUIRED', '请上传 JPG、PNG 或 WebP 图片');
  if (Number(request.headers.get('Content-Length')) > VISION_MAX_BYTES) throw new ApiError(413, 'IMAGE_TOO_LARGE', '图片过大，请裁剪到取件码附近再试');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_INPUT', '缺少图片');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > VISION_MAX_BYTES) { await reader.cancel(); throw new ApiError(413, 'IMAGE_TOO_LARGE', '图片过大，请裁剪到取件码附近再试'); }
    chunks.push(next.value);
  }
  if (size < 100) throw new ApiError(400, 'INVALID_INPUT', '图片内容为空');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  // Magic numbers: the declared type must match the bytes.
  const magic = type === 'image/png' ? bytes[0] === 0x89 && bytes[1] === 0x50 : type === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : bytes[8] === 0x57 && bytes[9] === 0x45;
  if (!magic) throw new ApiError(415, 'IMAGE_REQUIRED', '图片格式与内容不符');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type, base64: btoa(binary) };
}

const PROMPT = '这是一张快递驿站取件短信或快递 App 的截图。找出图中所有取件码：格式是“1 到 3 位数字-1 位数字-4 位数字”，例如 87-5-2739、107-2-6382。'
  + '不要输出手机号、运单号、日期或其他数字。只输出 JSON，不要其他文字：{"items":[{"code":"87-5-2739"}]}；没有取件码就输出 {"items":[]}。';

export async function visionRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '');
  if (path !== '/parcels/vision' || request.method !== 'POST') return null;
  const user = await requireStudent(request, env);
  if (!visionConfigured(env)) throw new ApiError(404, 'VISION_OFF', '本站未开启大模型截图识别，请使用本机识别或手动填写');
  await rateLimit(env, `vision:${user.id}`, 10);
  const image = await readImage(request);
  if (!await takeQuota(env, 'VISION')) { await countFallback(env, 'VISION'); throw new ApiError(429, 'VISION_LIMIT', '今日大模型识别次数已用完，请使用本机识别或手动填写'); }
  let text: string;
  try {
    const reply = await completion(env, {
      model: visionModel(env), max_tokens: 300, temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${image.type};base64,${image.base64}` } }, { type: 'text', text: PROMPT }] }],
    }, 30000);
    text = reply.content ?? '';
  } catch {
    await countFallback(env, 'VISION');
    throw new ApiError(502, 'VISION_FAILED', '大模型暂时没有响应，请稍后再试或手动填写');
  }
  return json({ codes: codesFromVision(text), model: visionModel(env) });
}
