/*
 * The live sea chart, drawn entirely in a fragment shader: a height field for Laoshan and the coast, a depth field for
 * the sea (its noise drifts slowly, so the isobaths move like a tide), contour lines extracted per pixel with fwidth,
 * the delivery route as a distance field, the campus fix and its pings, and a sonar sweep used by the opening.
 * Coordinates are "chart pixels": a 1600 × 900 sheet, y down, the same sheet the SVG fallback (chart-art) uses.
 * Two looks share the geometry: uPaper = 1 is the light paper chart (ink on paper; glows become tints, so nothing washes
 * out to white), uPaper = 0 the night chart of the dark theme (light lines on deep water; glows add light).
 * The relief is invented to read as mountains by the sea; it is an illustration, not survey data.
 */
export const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const MAX_ROUTE = 24;

export const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uView;          // offset x, offset y (device px), scale (device px per chart px)
uniform float uTime;
uniform vec3 uPtr;           // chart x, y, strength 0..1
uniform vec4 uPulse;         // chart x, y, start time, strength
uniform float uSweep;        // radians swept by the sonar (>= 6.3: everything revealed)
uniform float uRouteT;       // 0..1 of the route drawn
uniform vec3 uLight;         // chart x, y, alpha of the light travelling along the route
uniform vec2 uRoute[${MAX_ROUTE}];
uniform float uRouteCum[${MAX_ROUTE}];
uniform int uRouteN;
uniform vec2 uCampus;
uniform vec2 uStation;
uniform float uFix;          // 0..1 fix and station visibility
uniform float uQuality;      // 1 = full, 0 = reduced octaves
uniform vec3 uInk;           // contour colour
uniform vec3 uDeep;          // background
uniform vec3 uShallow;       // background towards the land
uniform vec3 uSea;           // isobath colour
uniform vec3 uCoast;
uniform vec3 uRouteC;
uniform vec3 uMark;          // fix ring, station square
uniform float uPaper;        // 1 = paper chart (light), 0 = night chart
uniform float uK;            // drawing-buffer pixels per CSS pixel: line widths are given in CSS px and scaled by it
out vec4 outColor;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 grad(vec2 i){ float a = hash(i) * 6.2831853; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad(i), f), b = dot(grad(i + vec2(1, 0)), f - vec2(1, 0));
  float c = dot(grad(i + vec2(0, 1)), f - vec2(0, 1)), d = dot(grad(i + vec2(1, 1)), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4;
}
float fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * gnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
float coastY(float x){
  return 600.0 - 210.0 * tanh((x - 1160.0) / 300.0) + 38.0 * sin(x / 140.0 + 1.3) + 22.0 * sin(x / 61.0) + 30.0 * fbm(vec2(x / 180.0, 3.7), 3);
}
float peak(vec2 q, vec2 c, float r, float h){ vec2 d = q - c; return h * exp(-(d.x * d.x) / (2.0 * r * r) - (d.y * d.y) / (2.0 * r * r * 0.72)); }

// Line of constant v, about w device pixels wide.
float iso(float v, float w){
  float f = abs(fract(v + 0.5) - 0.5), fw = max(fwidth(v), 1e-4);
  return 1.0 - smoothstep(w * 0.5 * fw, (w * 0.5 + 1.0) * fw, f);
}
// A glow: added light on the night chart, a tint towards the colour on paper.
vec3 glow(vec3 col, vec3 c, float a){ return uPaper > 0.5 ? mix(col, c, clamp(a * 0.85, 0.0, 1.0)) : col + c * a; }
float segDist(vec2 p, vec2 a, vec2 b, out float h){
  vec2 pa = p - a, ba = b - a; h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = (frag - uView.xy) / uView.z;
  float t = uTime, px = 1.0 / uView.z;          // one device pixel in chart px
  int oct = uQuality > 0.5 ? 5 : 3;

  // Sonar lens under the pointer, and the ring of a tap.
  vec2 dp = p - uPtr.xy; float dist = length(dp);
  float ripple = sin(dist * 0.05 - t * 3.0) * exp(-dist / 150.0) * 11.0 * uPtr.z;
  float age = t - uPulse.z, pd = length(p - uPulse.xy), front = age * 300.0;
  float ring = exp(-pow((pd - front) / 30.0, 2.0)) * exp(-age * 1.4) * uPulse.w * step(0.0, age);
  vec2 q = p + (dist > 0.001 ? dp / dist : vec2(0)) * ripple + (pd > 0.001 ? (p - uPulse.xy) / pd : vec2(0)) * ring * 20.0;

  // Height and depth.
  float s = q.y - coastY(q.x);
  float n = fbm(q / 520.0, oct - 1), fine = fbm(q / 150.0, oct);
  float mount = peak(q, vec2(1300, 120), 200.0, 1.0) + peak(q, vec2(1500, 230), 150.0, 0.82) + peak(q, vec2(1120, 260), 150.0, 0.66)
              + peak(q, vec2(1400, 380), 110.0, 0.5) + peak(q, vec2(980, 150), 130.0, 0.4) + peak(q, vec2(1560, 60), 120.0, 0.7);
  float mask = clamp(mount * 1.6, 0.0, 1.0);
  float land = mount * 15.0 + (abs(fine) * -2.2 + fine * 1.2) * mask * 2.2 + n * 0.6 + clamp(-s, 0.0, 240.0) / 240.0;
  float tide = fbm(q / 520.0 + vec2(t * 0.010, t * 0.006), 3);
  float isl = peak(q, vec2(1300, 760), 46.0, 1.0) + peak(q, vec2(1500, 640), 30.0, 0.8);
  float depth = max(s, 0.0) / 30.0 + tide * 0.9 + fine * 0.5 - isl * 9.0;

  float onLand = smoothstep(3.0, -3.0, s), atSea = 1.0 - onLand;
  float lv = land / 1.1, idx = floor(lv + 0.5), major = step(mod(idx, 5.0), 0.5);
  float landLine = mix(iso(lv, 0.8 * uK) * (0.12 + 0.14 * clamp(land / 14.0, 0.0, 1.0)), iso(lv, 1.3 * uK) * 0.42, major) * onLand;
  float seaLine = iso(depth / 1.8, 0.8 * uK) * 0.3 * atSea;
  float coast = (1.0 - smoothstep(0.6 * uK, 0.6 * uK + 1.2, abs(s) / max(fwidth(s), 1e-4))) * 0.9;

  // The sonar reveal (opening): an angle measured clockwise from twelve o'clock around the campus.
  float ang = atan(p.x - uCampus.x, -(p.y - uCampus.y)); ang = ang < 0.0 ? ang + 6.2831853 : ang;
  float behind = uSweep - ang;
  float revealed = uSweep >= 6.3 ? 1.0 : step(0.0, behind);
  float afterglow = uSweep >= 6.3 ? 0.0 : exp(-max(behind, 0.0) * 3.0) * revealed;
  float beam = uSweep >= 6.3 ? 0.0 : exp(-pow(max(-behind, 0.0) * 9.0, 2.0)) * smoothstep(1400.0, 0.0, length(p - uCampus)) * 0.16;

  float lens = 1.0 + 1.4 * exp(-dist / 210.0) * uPtr.z + ring * 2.0;
  float lineA = (landLine + seaLine) * revealed * (1.0 + afterglow * 1.6) * lens;
  float coastA = coast * revealed;

  // Background: deep water, warmer over the land, a faint glow around the campus.
  float yN = frag.y / uRes.y;
  vec3 col = mix(uDeep, uShallow, (onLand * 0.55 + (1.0 - yN) * 0.15) * (0.35 + 0.65 * revealed));
  col = glow(col, uRouteC, 0.06 * exp(-length(p - uCampus) / 260.0) * uFix);
  col = glow(col, uPaper > 0.5 ? uSea : uCoast, beam);
  col = mix(col, uSea, clamp(seaLine * revealed * lens, 0.0, 1.0));
  col = mix(col, uInk, clamp(landLine * revealed * (1.0 + afterglow * 1.6) * lens, 0.0, 1.0));
  col = mix(col, uCoast, clamp(coastA, 0.0, 1.0));
  col = glow(col, uPaper > 0.5 ? uRouteC : uCoast, afterglow * (landLine + seaLine) * 0.6);

  // Route: drawn up to uRouteT, a soft glow and a bright core.
  float best = 1e5, along = 0.0;
  for (int i = 0; i < ${MAX_ROUTE} - 1; i++) {
    if (i + 1 >= uRouteN) break;
    float h; float d = segDist(p, uRoute[i], uRoute[i + 1], h);
    if (d < best) { best = d; along = mix(uRouteCum[i], uRouteCum[i + 1], h); }
  }
  float drawn = step(along, uRouteT);
  float core = (1.0 - smoothstep(1.1 * uK * px, (1.1 * uK + 1.1) * px, best)) * drawn;
  float routeGlow = exp(-best / 9.0) * 0.45 * drawn;
  col = mix(col, uRouteC, clamp(core, 0.0, 1.0));
  col = glow(col, uRouteC, routeGlow * (uPaper > 0.5 ? 0.35 : 0.55));

  // The light travelling along the route.
  float ld = length(p - uLight.xy);
  float halo = exp(-ld / 26.0) * 0.28 * uLight.z, spark = exp(-ld / 5.0) * 1.1 * uLight.z;
  if (uPaper > 0.5) { col = mix(col, uRouteC, clamp(halo * 1.4, 0.0, 1.0)); col = mix(col, vec3(1.0), clamp(spark * 0.9 - 0.25, 0.0, 1.0)); col = mix(col, uRouteC, clamp(exp(-pow((ld - 4.0) / 1.6, 2.0)) * uLight.z, 0.0, 1.0)); }
  else col += mix(uRouteC, vec3(1.0), 0.55) * (spark + halo);

  // Campus fix (ring and dot) with pings, and the station square.
  float cd = length(p - uCampus);
  float fixRing = (1.0 - smoothstep(0.8 * uK, 0.8 * uK + 1.1, abs(cd - 15.0) / px)) + (1.0 - smoothstep(2.2 * uK * px, (2.2 * uK + 1.4) * px, cd));
  float pingR = 15.0 + mod(t * 26.0, 90.0), ping = (1.0 - smoothstep(0.6 * uK, 0.6 * uK + 1.0, abs(cd - pingR) / px)) * (1.0 - (pingR - 15.0) / 90.0) * 0.55;
  vec2 sd = abs(p - uStation) - vec2(5.5);
  float box = length(max(sd, 0.0)) + min(max(sd.x, sd.y), 0.0);
  float station = 1.0 - smoothstep(0.7 * uK, 0.7 * uK + 1.0, abs(box) / px);
  col = mix(col, uMark, clamp((fixRing + station) * uFix, 0.0, 1.0));
  col = glow(col, uPaper > 0.5 ? uRouteC : uCoast, ping * uFix);

  // Vignette and a little film grain, so the gradients never band.
  vec2 uv = frag / uRes;
  col *= 1.0 - mix(0.28, 0.05, uPaper) * pow(length((uv - vec2(0.42, 0.48)) * vec2(1.05, 1.25)), 2.2);
  col += (hash(frag + fract(t * 7.0) * 113.0) - 0.5) * mix(0.025, 0.012, uPaper);
  outColor = vec4(col, 1.0);
}`;
