/* © 2026 专业团队 · CampusDrop v4.5.0 */
import { pickupCodeRegex } from './constants.ts';

/* v3.6 · reading the vision model's answer (截图识别大模型兜底). */
/** Pulls well-formed pickup codes out of the model's answer (JSON when it followed the prompt, plain text otherwise). */
export function codesFromVision(text: string): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const code = raw.replace(/[\s—–_.·]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (pickupCodeRegex.test(code) && !found.includes(code)) found.push(code);
  };
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { items?: { code?: unknown }[] };
    for (const item of json.items ?? []) if (typeof item?.code === 'string') push(item.code);
  } catch { /* fall back to scanning the text */ }
  if (!found.length) for (const m of text.matchAll(/(?<!\d)(\d{1,3})\s*[-—–_.·\s]\s*(\d)\s*[-—–_.·\s]\s*(\d{4})(?!\d)/g)) push(`${m[1]}-${m[2]}-${m[3]}`);
  return found.slice(0, 12);
}

