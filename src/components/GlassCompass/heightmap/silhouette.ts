import { TILE } from "../config";

// Tile outline: a square with a superellipse quadrant at each corner, each
// corner fitted separately. Coordinates are centred on the tile, in reference
// pixels, y up.

export type Corner = { spanX: number; spanY: number; n: number };

export type SilhouetteParams = {
  size: number;
  corners: { tl: Corner; tr: Corner; bl: Corner; br: Corner };
};

const DEFAULT: SilhouetteParams = { size: TILE.size, corners: TILE.corners };

// Distance inward from the outline: positive inside, 0 on the edge, negative
// outside. Exact along the straight edges; inside a corner zone it is the
// first-order distance F / |grad F| to the superellipse, which is continuous
// with the straight-edge distance where the corner meets the edge.
export function edgeDistance(x: number, y: number, p: SilhouetteParams = DEFAULT): number {
  const half = p.size / 2;
  const ex = half - Math.abs(x); // from the nearest vertical edge
  const ey = half - Math.abs(y); // from the nearest horizontal edge
  const c = y >= 0 ? (x < 0 ? p.corners.tl : p.corners.tr) : x < 0 ? p.corners.bl : p.corners.br;
  if (ex < c.spanX && ey < c.spanY) {
    const a = Math.max(0, (c.spanX - ex) / c.spanX);
    const b = Math.max(0, (c.spanY - ey) / c.spanY);
    const n = c.n;
    const s = Math.pow(Math.pow(a, n) + Math.pow(b, n), 1 / n);
    const f = 1 - s;
    const ga = Math.pow(a, n - 1) / c.spanX;
    const gb = Math.pow(b, n - 1) / c.spanY;
    const grad = Math.pow(s, 1 - n) * Math.sqrt(ga * ga + gb * gb);
    const d = grad > 1e-9 ? f / grad : Infinity;
    // the curve lies between the point and the edge lines, so it is never
    // farther than either line
    return Math.min(d, ex, ey);
  }
  return Math.min(ex, ey);
}

// Distance from the centre to the outline along direction (dx, dy).
export function boundaryRadius(dx: number, dy: number, p: SilhouetteParams = DEFAULT, iterations = 32): number {
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  const ux = dx / len;
  const uy = dy / len;
  // the outline lies between the inscribed and the corner radius
  let lo = (p.size / 2) * 0.7;
  let hi = (p.size / 2) * Math.SQRT2;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (edgeDistance(ux * mid, uy * mid, p) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
