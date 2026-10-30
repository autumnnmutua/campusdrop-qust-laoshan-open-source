import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generates src/client/styles/theme-dark-auto.css: dark-mode counterparts for the literal colours that are still written
 * directly in the stylesheets (badges, tints, translucent bars …). Colours that come from tokens are handled by the
 * token overrides in theme-dark.css; this script only touches literals. Each literal keeps its hue: light backgrounds
 * become dark tinted surfaces, dark text becomes light text, light borders become dim lines. Rules on map markers and
 * the chart art (which draws with tokens) are left alone.
 *
 *   node scripts/dark-theme.mjs          regenerate
 *   node scripts/dark-theme.mjs --check  fail when the generated file is stale (part of npm run verify)
 */
const DIR = 'src/client/styles', OUT = join(DIR, 'theme-dark-auto.css');
const SKIP_FILES = new Set(['tokens.css', 'index.css', 'theme-dark.css', 'theme-dark-auto.css', 'chart.css']);
const ALWAYS_DARK = /map-courier|route-|courier-|station-|load-badge|map-compass|game-|\.toast-icon|unread-dot|route-progress|chart-|intro|home-hero|is-night|auth-scenery|home-quick|current-order:first-child/;
const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|outline(-color)?|fill|stroke|box-shadow|text-shadow|caret-color|text-decoration-color|accent-color)$/;

// ---------------------------------------------------------------- colour maths (sRGB ↔ HSL)
function parse(literal) {
  const s = literal.trim().toLowerCase();
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
function fromHsl({ h, s, l }) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}
const hex = ({ r, g, b }, a = 1) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : '');

/** Dark counterpart of one literal, by role. Saturated mid-tones (brand blue, orange) are kept. */
function darken(literal, role) {
  const c = parse(literal);
  if (!c) return literal;
  const hsl = toHsl(c);
  if (role === 'text') {
    if (hsl.l >= .6) return literal;
    return hex(fromHsl({ h: hsl.h, s: Math.min(hsl.s, .75), l: .78 + (.6 - hsl.l) * .2 }), c.a);
  }
  if (role === 'line') {
    if (hsl.l < .55) return literal;
    return hex(fromHsl({ h: hsl.h, s: Math.min(hsl.s, .45), l: .2 + (1 - hsl.l) * .5 }), c.a);
  }
  // surface
  if (hsl.l < .6) return literal;
  if (hsl.s < .08 && hsl.l > .97 && c.a < 1) return hex({ r: 16, g: 26, b: 44 }, c.a); // translucent white bars
  // Neutral greys/whites take the app's navy surface tone instead of turning grey.
  const neutral = hsl.s < .08;
  return hex(fromHsl({ h: neutral ? 218 : hsl.h, s: neutral ? .4 : Math.min(hsl.s, .5) * .8, l: .12 + (1 - hsl.l) * .45 }), c.a);
}
const roleOf = prop => (prop === 'color' || prop === 'caret-color' || prop === 'text-decoration-color' || prop === 'text-shadow') ? 'text'
  : (prop.startsWith('border') || prop.startsWith('outline') || prop === 'stroke') ? 'line' : 'surface';
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|(?<![-\w])white\b/g;

// ---------------------------------------------------------------- tiny CSS walker (rules, @media / @supports)
function strip(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function walk(css, emit, wrappers = []) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (/^@(media|supports)/.test(prelude)) walk(body, emit, [...wrappers, prelude]);
    else if (!prelude.startsWith('@')) emit(prelude, body, wrappers);
    i = j;
  }
}

const rules = [];
for (const file of readdirSync(DIR).filter(f => f.endsWith('.css') && !SKIP_FILES.has(f)).sort()) {
  walk(strip(readFileSync(join(DIR, file), 'utf8')), (selector, body, wrappers) => {
    if (ALWAYS_DARK.test(selector) || wrappers.some(w => /print/.test(w))) return;
    const decls = [];
    for (const raw of body.split(';')) {
      const at = raw.indexOf(':');
      if (at < 0) continue;
      const prop = raw.slice(0, at).trim().toLowerCase(), value = raw.slice(at + 1).trim();
      if (!COLOR_PROPS.test(prop) || !new RegExp(LITERAL.source).test(value)) continue;
      const role = roleOf(prop), next = value.replace(LITERAL, m => darken(m, role));
      if (next !== value) decls.push(`${prop}: ${next}`);
    }
    if (!decls.length) return;
    const scoped = selector.split(',').map(s => s.trim()).filter(Boolean).map(s => /^(html|:root)\b/.test(s) ? s.replace(/^(html|:root)/, ':root[data-theme=dark]') : `:root[data-theme=dark] ${s}`).join(',\n');
    rules.push({ text: `${scoped} { ${decls.join('; ')}; }`, wrappers, file });
  });
}
let out = '/* Generated by scripts/dark-theme.mjs from the literal colours in the other stylesheets. Do not edit by hand.\n   Screen only: printing always uses the light chart. */\n@media screen {\n';
let lastFile = '';
for (const r of rules) {
  if (r.file !== lastFile) { out += `\n/* ${r.file} */\n`; lastFile = r.file; }
  out += r.wrappers.length ? `${r.wrappers.join(' { ')} { ${r.text} }${' }'.repeat(r.wrappers.length - 1)}\n` : `${r.text}\n`;
}
out += '}\n';
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
  if (current !== out) { console.error('Dark theme stale; run npm run theme:dark'); process.exitCode = 1; }
  else console.log(`PASS: dark theme covers ${rules.length} rules with literal colours.`);
} else { writeFileSync(OUT, out); console.log(`Dark theme: ${rules.length} rules written to ${OUT}`); }
