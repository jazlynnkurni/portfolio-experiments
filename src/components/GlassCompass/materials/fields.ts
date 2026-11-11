import { PIGMENT, SLAB, TILE } from "../config";
import { REFERENCE_FIELD, REFERENCE_FIELD_SIZE } from "./referenceField";
import { fbm, warpedFbm } from "../heightmap/noise";

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Uneven slab thickness from pressing, px. Low frequency, so it is sampled on
// a coarse grid. Exponential, so thin areas stay positive and thick pockets
// can run deep.
export function organicThickness(x: number, y: number): number {
  const s = SLAB;
  const swell = warpedFbm(x / s.variationScale, y / s.variationScale, s.variationOctaves, s.seed);
  const field = s.referenceWeight * referenceFieldAt(x, y) + s.detail * swell;
  return s.minThickness + s.baseThickness * Math.exp(s.variation * field);
}

// Bilinear sample of the reference-aligned field at a tile point.
function referenceFieldAt(x: number, y: number): number {
  const n = REFERENCE_FIELD_SIZE;
  const fx = Math.min(n - 1, Math.max(0, (x / TILE.size + 0.5) * n - 0.5));
  const fy = Math.min(n - 1, Math.max(0, (y / TILE.size + 0.5) * n - 0.5));
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const i1 = Math.min(n - 1, i0 + 1);
  const j1 = Math.min(n - 1, j0 + 1);
  const tx = fx - i0;
  const ty = fy - j0;
  const f = REFERENCE_FIELD;
  const a = f[j0 * n + i0] + (f[j0 * n + i1] - f[j0 * n + i0]) * tx;
  const b = f[j1 * n + i0] + (f[j1 * n + i1] - f[j1 * n + i0]) * tx;
  return a + (b - a) * ty;
}

// Extra thickness toward the edge; d is the distance in from the outline.
export function perimeterThickness(d: number): number {
  return SLAB.perimeterThicken * (1 - smooth(d / SLAB.perimeterFalloff));
}

// Local glass thickness, px: organic slab + perimeter + relief height h.
export function thicknessAt(organic: number, h: number, d: number): number {
  return Math.max(1, organic + perimeterThickness(d) + h);
}

const srgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Pigment drift between olive and mint, as sRGB 0..255.
export function pigmentAt(x: number, y: number, out: [number, number, number]): void {
  const olive = srgb(PIGMENT.olive);
  const mint = srgb(PIGMENT.mint);
  const t = smooth(0.5 + 0.9 * fbm(x / PIGMENT.scale, y / PIGMENT.scale, 3, PIGMENT.seed));
  for (let c = 0; c < 3; c++) out[c] = Math.round(olive[c] + (mint[c] - olive[c]) * t);
}
