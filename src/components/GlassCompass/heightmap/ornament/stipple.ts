import { ORNAMENT } from "../../config";

const T = ORNAMENT.stipple;

function hash(i: number, j: number, s: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Dense raised dots on a jittered grid in tile px, each a little different in
// place, size and height, so the field never reads as a perfect screen.
export function stipple(x: number, y: number): number {
  const fx = x / T.pitch - 0.5;
  const fy = y / T.pitch - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  let h = 0;
  for (let i = i0; i <= i0 + 1; i++) {
    for (let j = j0; j <= j0 + 1; j++) {
      const cx = (i + 0.5 + (hash(i, j, 1) * 2 - 1) * (T.jitter / T.pitch)) * T.pitch;
      const cy = (j + 0.5 + (hash(i, j, 2) * 2 - 1) * (T.jitter / T.pitch)) * T.pitch;
      const r = T.radius * (1 + (hash(i, j, 3) * 2 - 1) * T.radiusJitter);
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      // rounded bead with a soft foot (no vertical edge to flash white)
      const f = 1 - d2 / (r * r);
      const hh = T.height * (1 + (hash(i, j, 4) * 2 - 1) * T.heightJitter) * f * Math.sqrt(f);
      if (hh > h) h = hh;
    }
  }
  return h;
}
