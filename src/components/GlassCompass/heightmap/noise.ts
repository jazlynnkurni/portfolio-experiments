// Small deterministic 2D value noise and fBm, so every procedural field
// (thickness, pigment, waviness) is repeatable for a given seed.

function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

// Value noise in 0..1.
export function valueNoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fade(fx);
  const v = fade(fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal sum, centred on 0, roughly -1..1. Each octave is rotated so the
// value-noise lattice never lines up into horizontal or vertical streaks.
const ROT_C = Math.cos(0.83);
const ROT_S = Math.sin(0.83);

export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x;
  let py = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(px, py, seed + o * 17) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    const rx = (ROT_C * px - ROT_S * py) * 2.03 + 11.7;
    const ry = (ROT_S * px + ROT_C * py) * 2.03 + 5.3;
    px = rx;
    py = ry;
  }
  return sum / norm;
}

// fBm sampled through a gentle domain warp, for organic, flowing swells.
export function warpedFbm(x: number, y: number, octaves: number, seed: number, warp = 0.6): number {
  const wx = fbm(x + 3.1, y - 1.7, 2, seed + 101);
  const wy = fbm(x - 4.6, y + 2.9, 2, seed + 211);
  return fbm(x + warp * wx, y + warp * wy, octaves, seed);
}
