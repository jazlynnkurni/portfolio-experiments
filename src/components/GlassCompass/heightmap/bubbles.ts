import { SURFACE, TILE } from "../config";
import type { HeightLayer } from "./compose";
import { fbm } from "./noise";
import { edgeDistance } from "./silhouette";

type Bubble = { x: number; y: number; r: number; depth: number };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scatter bubbles with a gentle clustering (rejection against a noise field),
// mostly tiny, a few larger, as in hand-pressed glass.
function scatter(): Bubble[] {
  const B = SURFACE.bubbles;
  const rand = rng(B.seed);
  const half = TILE.size / 2;
  const list: Bubble[] = [];
  let guard = 0;
  while (list.length < B.count && guard++ < B.count * 40) {
    const x = (rand() * 2 - 1) * half;
    const y = (rand() * 2 - 1) * half;
    if (edgeDistance(x, y) < B.edgeClear) continue;
    const density = 0.5 + 0.5 * fbm(x / B.clusterScale, y / B.clusterScale, 2, B.seed + 1);
    if (rand() > density * density * 1.6) continue;
    const r = B.rMin + (B.rMax - B.rMin) * Math.pow(rand(), 2.2);
    list.push({ x, y, r, depth: B.depth * (r / B.rMax) * (0.7 + 0.6 * rand()) });
  }
  return list;
}

const CELL = 8;
const GRID = new Map<string, Bubble[]>();
for (const b of scatter()) {
  const k = `${Math.floor(b.x / CELL)},${Math.floor(b.y / CELL)}`;
  const arr = GRID.get(k);
  if (arr) arr.push(b);
  else GRID.set(k, [b]);
}

// Each bubble reads as a small inverted lens: the glass is thinner across it
// (lighter) and its curved wall bends light (a refractive ring).
export function bubbleHeight(x: number, y: number): number {
  const ci = Math.floor(x / CELL);
  const cj = Math.floor(y / CELL);
  let h = 0;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const arr = GRID.get(`${ci + di},${cj + dj}`);
      if (!arr) continue;
      for (const b of arr) {
        const dx = x - b.x;
        const dy = y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < b.r * b.r) h = Math.min(h, -b.depth * Math.sqrt(1 - d2 / (b.r * b.r)));
      }
    }
  }
  return h;
}

// Fine ripple: very low, well below the ornament's scale.
export function rippleHeight(x: number, y: number): number {
  const R = SURFACE.ripple;
  return R.height * fbm(x / R.scale, y / R.scale, 2, R.seed);
}

export const bubbleLayer: HeightLayer = {
  name: "bubbles and ripple",
  height: (x, y, _d, fine) => (fine ? bubbleHeight(x, y) + rippleHeight(x, y) : 0),
};
