import { ORNAMENT } from "../../config";
import { valueNoise } from "../noise";
import { UNIT_PX, type Instance } from "./lattice";
import { bump, len, smooth } from "./shape";

const Q = ORNAMENT.quatrefoil;
const APEX = Q.lobeOffset + Q.lobeRadius;
const PETAL_MID = (Q.petal.from + Q.petal.to) / 2;
const PETAL_HALF = (Q.petal.to - Q.petal.from) / 2;
const AXES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

export type QuatrefoilSample = {
  h: number; // relief, px
  field: number; // 0..1, where stipple belongs
};

// One quatrefoil at unit coords (u, v) about its centre.
//  frame   double raised outline (thick outer ridge, thin inner ridge) round
//          four lobes, a short pointed nub at each lobe apex into the lattice
//  field   pressed below the background, stippled (stipple added elsewhere)
//  flower  four almond petals with raised rims and dished centres on the axes,
//          four outward-curling crescents on the diagonals, a domed boss
export function quatrefoil(u: number, v: number, k: Instance): QuatrefoilSample {
  const S = UNIT_PX * k.scale;

  // outline: union of the four lobe circles and the core disc
  let sd = len(u, v) - Q.coreRadius;
  sd = Math.min(sd, len(u - Q.lobeOffset, v) - Q.lobeRadius);
  sd = Math.min(sd, len(u + Q.lobeOffset, v) - Q.lobeRadius);
  sd = Math.min(sd, len(u, v - Q.lobeOffset) - Q.lobeRadius);
  sd = Math.min(sd, len(u, v + Q.lobeOffset) - Q.lobeRadius);
  const e = -sd * S; // px inside the outline

  let h = 0;

  // connector nubs, outside the outline along each axis
  const au = Math.abs(u);
  const av = Math.abs(v);
  const along = Math.max(au, av);
  if (e < 2 && along > APEX - 0.03 && along < 0.51) {
    const across = (au >= av ? v : u) * S;
    const t = smooth((along - APEX) / (0.5 - APEX));
    const w = Q.connector.width + (Q.connector.tipWidth - Q.connector.width) * t;
    h = Math.max(h, Q.connector.height * k.height * (1 - 0.35 * t) * bump(across, 0, w));
  }
  if (e < -2) return { h, field: 0 };

  // frame ridges, height wobbling gently along the outline (hand-cut mould)
  const wob = 1 + ORNAMENT.irregularity.ridgeWobble * (valueNoise(Math.atan2(v, u) * 2.4 + k.seed, k.seed * 0.37) * 2 - 1);
  h += Q.outerRidge.height * k.height * wob * bump(e, Q.outerRidge.at, Q.outerRidge.width);
  h += Q.innerRidge.height * k.height * bump(e, Q.innerRidge.at, Q.innerRidge.width);
  const field = smooth((e - Q.fieldStart) / 1.6);
  h -= Q.fieldDepth * field;
  if (field <= 0) return { h, field: 0 };

  // centre flower
  let keep = 1; // where stipple is allowed
  for (const [ax, ay] of AXES) {
    const al = u * ax + v * ay;
    const s = (al - PETAL_MID) / PETAL_HALF;
    if (s <= -1 || s >= 1) continue;
    const ac = Math.abs(u * ay - v * ax);
    const hw = Q.petal.halfWidth * (1 - s * s); // almond: pointed at both ends
    const pe = (ac - hw) * S; // px, negative inside
    // convex glossy bead, rounded across and along
    if (ac < hw) {
      const across = ac / hw;
      h += Q.petal.height * k.height * Math.sqrt(1 - across * across) * Math.sqrt(1 - s * s);
    }
    keep *= smooth((pe - 1.2) / 1.2);
  }
  for (const [dx, dy] of DIAGS) {
    const cx = dx * Q.curl.offset;
    const cy = dy * Q.curl.offset;
    const ru = u - cx;
    const rv = v - cy;
    const ring = Math.abs(len(ru, rv) - Q.curl.radius) * S;
    if (ring > Q.curl.width) continue;
    // the half of the ring facing away from the centre
    const outward = (ru * dx + rv * dy) / (Math.SQRT2 * Math.max(1e-6, len(ru, rv)));
    const half = smooth((outward + 0.25) / 0.35);
    h += Q.curl.height * k.height * half * bump(ring, 0, Q.curl.width);
    keep *= 1 - half * (1 - smooth((ring - Q.curl.width / 2) / 1.2));
  }
  const rb = len(u, v) * S;
  if (rb < Q.boss.radius) h += Q.boss.height * k.height * Math.sqrt(1 - (rb / Q.boss.radius) ** 2);
  h -= Q.boss.moatDepth * bump(rb, Q.boss.moat, 3);
  keep *= smooth((rb - Q.boss.moat - 1) / 1.5);

  return { h, field: field * keep };
}
