"""
Generates src/client/art/page-contours.svg: a faint, invented contour field used as the page background (ambient.tsx).
Gradient-noise fbm, contoured with matplotlib, simplified and written as plain paths (stroke in black: the stylesheet
uses the file as a mask, so the colour comes from the theme). Deterministic (fixed seed).

    python3 scripts/art/page-contours.py
"""
import math, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

W, H, GX, GY = 1600, 1000, 240, 150
rng = np.random.default_rng(20261030)
def fbm(x, y, octaves=5):
    total = np.zeros_like(x); amp = 1.0; freq = 1.0
    for o in range(octaves):
        # value noise on a random lattice, smoothly interpolated
        n = 6 * 2 ** o + 1; lat = rng.random((n + 1, n + 1))
        u = x * freq * (n - 1); v = y * freq * (n - 1)
        i = np.clip(np.floor(u).astype(int), 0, n - 1); j = np.clip(np.floor(v).astype(int), 0, n - 1)
        fu = u - i; fv = v - j; su = fu * fu * (3 - 2 * fu); sv = fv * fv * (3 - 2 * fv)
        a = lat[j, i]; b = lat[j, i + 1]; c = lat[j + 1, i]; d = lat[j + 1, i + 1]
        total += amp * (a * (1 - su) * (1 - sv) + b * su * (1 - sv) + c * (1 - su) * sv + d * su * sv)
        amp *= .5
    return total
xs, ys = np.meshgrid(np.linspace(0, 1, GX), np.linspace(0, 1, GY))
z = fbm(xs, ys, octaves=3)
# soften: a few passes of a separable box blur, so the lines flow instead of following the noise lattice
for _ in range(6):
    z = (np.roll(z, 1, 0) + z + np.roll(z, -1, 0)) / 3; z = (np.roll(z, 1, 1) + z + np.roll(z, -1, 1)) / 3
    z[0], z[-1], z[:, 0], z[:, -1] = z[1], z[-2], z[:, 1], z[:, -2]
# two broad rises so the field reads as terrain, not static
z += .55 * np.exp(-(((xs - .82) / .22) ** 2 + ((ys - .25) / .28) ** 2)) + .35 * np.exp(-(((xs - .12) / .2) ** 2 + ((ys - .85) / .22) ** 2))
levels = np.linspace(z.min() + .04, z.max() - .02, 22)
fig = plt.figure(); cs = plt.contour(xs * W, ys * H, z, levels=levels)

def simplify(pts, tol=1.2):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; ab = b - a; L = np.hypot(*ab) or 1e-9
    rel = pts - a; d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / L
    k = int(np.argmax(d))
    if d[k] > tol: return np.vstack([simplify(pts[:k + 1], tol)[:-1], simplify(pts[k:], tol)])
    return np.vstack([a, b])

paths = []
for li, segs in enumerate(cs.allsegs):
    major = li % 5 == 2
    for seg in segs:
        if len(seg) < 6: continue
        p = simplify(np.asarray(seg))
        if len(p) < 3: continue
        d = "M" + " ".join(f"{x:.0f} {y:.0f}" for x, y in p)
        paths.append((major, d))
plt.close(fig)
minor = "".join(d for m, d in paths if not m); major = "".join(d for m, d in paths if m)
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">'
       f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">'
       f'<path stroke-width="1" stroke-opacity=".55" d="{minor}"/><path stroke-width="1.3" stroke-opacity=".85" d="{major}"/></g></svg>')
out = os.path.join(os.path.dirname(__file__), "..", "..", "src", "client", "art", "page-contours.svg")
open(out, "w").write(svg); print(out, len(svg), "bytes", len(paths), "paths")
