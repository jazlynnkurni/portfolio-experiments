import { NEEDLE } from "../config";
import type { HeightLayer } from "./compose";
import { fbm } from "./noise";
import { bump, smooth } from "./ornament/shape";

// Needle frame in tile space (centred px, y up). s runs along the axis from
// the junction (positive toward the red tip), n across it.
const PX = NEEDLE.pivot[0] - 367.5;
const PY = 367.5 - NEEDLE.pivot[1];
const A = (NEEDLE.angleDeg * Math.PI) / 180;
const AX = Math.cos(A);
const AY = Math.sin(A);

function frame(x: number, y: number): [number, number] {
  const dx = x - PX;
  const dy = y - PY;
  return [dx * AX + dy * AY, dx * AY - dy * AX];
}

// Measured half-width at a distance from the junction.
export function halfWidthAt(s: number): number {
  const t = NEEDLE.halfWidth;
  const a = Math.abs(s);
  if (a >= t[t.length - 1][0]) return 0;
  for (let i = 1; i < t.length; i++) {
    if (a <= t[i][0]) {
      const [s0, w0] = t[i - 1];
      const [s1, w1] = t[i];
      return w0 + ((w1 - w0) * (a - s0)) / (s1 - s0);
    }
  }
  return 0;
}

export type NeedleSample = {
  mask: number; // 0..1 inside the needle (soft molded edge)
  red: number; // 0..1, red half vs silver half
  s: number;
  n: number;
};

export function needleSample(x: number, y: number): NeedleSample {
  const [s, n] = frame(x, y);
  const hw = halfWidthAt(s);
  const mask = hw > 0 ? smooth((hw - Math.abs(n)) / NEEDLE.edgeSoft) : 0;
  const sj = NEEDLE.junctionTilt * n; // tilted junction
  const red = smooth((s - sj) / 1.2 + 0.5);
  return { mask, red, s, n };
}

// Relief of the needle itself: a proud plate with a gentle crown, thin raised
// borders along both sides, a band of shallow chevron facets down the middle
// (V's pointing at the tips), and a fine groove at the junction.
export function needleHeight(x: number, y: number): number {
  const { mask, s, n } = needleSample(x, y);
  if (mask <= 0) return 0;
  const N = NEEDLE;
  const hw = halfWidthAt(s);
  const an = Math.abs(n);
  let h = N.plate + N.crown * (1 - Math.min(1, (an / Math.max(hw, 1e-3)) ** 2));
  h += N.border.height * bump(an, hw - N.border.inset, N.border.width);

  const as = Math.abs(s);
  const c = N.chevrons;
  if (an < c.band * hw && as > c.from && as < c.to * N.length) {
    const phase = (((as - c.slope * an) % c.period) + c.period) % c.period;
    const d = Math.min(phase, c.period - phase);
    const fadeAlong = smooth((as - c.from) / 10) * (1 - smooth((as - c.to * N.length + 20) / 20));
    const fadeAcross = 1 - smooth((an - c.band * hw + 3) / 3);
    h += c.height * bump(d, 0, c.width) * fadeAlong * fadeAcross;
  }

  const sj = N.junctionTilt * n;
  h -= N.junctionGroove.depth * bump(s - sj, 0, N.junctionGroove.width);
  return h * mask;
}

export const needleLayer: HeightLayer = {
  name: "needle",
  height: (x, y) => needleHeight(x, y),
};

// Lets relief under the needle show through it, softened: the needle is
// glass pressed over the dial, so the lattice reads distorted through it.
export function underNeedle(layer: HeightLayer, keep = NEEDLE.underKeep): HeightLayer {
  return {
    name: `${layer.name} (under needle)`,
    height: (x, y, d, fine) => {
      const h = layer.height(x, y, d, fine);
      if (h === 0) return 0;
      const m = needleSample(x, y).mask;
      return m > 0 ? h * (1 - m * (1 - keep)) : h;
    },
  };
}

const hex = (h: string): [number, number, number] => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const DEEP = hex(NEEDLE.red.deep);
const LIGHT = hex(NEEDLE.red.light);
const SILVER = hex(NEEDLE.silver);

// Absorption colour (sRGB 0..255) and coverage for the glass shader: uneven
// ruby on the red half (deeper toward the junction), pale silver-green on the
// other.
export function needleColour(x: number, y: number, out: [number, number, number, number]): void {
  const { mask, red, s, n } = needleSample(x, y);
  if (mask <= 0) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return;
  }
  const R = NEEDLE.red;
  const uneven = 0.5 + 0.8 * fbm(x / R.scale, y / R.scale, 3, R.seed);
  const towardTip = Math.min(1, Math.max(0, s / NEEDLE.length));
  const t = Math.min(1, Math.max(0, uneven * 0.75 + towardTip * 0.35));
  const E = NEEDLE.edgeDarken;
  const edge = smooth((Math.abs(n) - (halfWidthAt(s) - E.width)) / E.width);
  const dim = 1 - E.amount * edge;
  for (let c = 0; c < 3; c++) {
    const ruby = DEEP[c] + (LIGHT[c] - DEEP[c]) * t;
    out[c] = Math.round((SILVER[c] + (ruby - SILVER[c]) * red) * dim);
  }
  out[3] = Math.round(mask * 255);
}
