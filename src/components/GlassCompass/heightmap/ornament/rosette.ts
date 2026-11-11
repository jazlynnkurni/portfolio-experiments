import { ORNAMENT } from "../../config";
import { UNIT_PX, type Instance } from "./lattice";
import { bump, len, smooth } from "./shape";

const R = ORNAMENT.rosette;
const P = ORNAMENT.pyramid;
const STEP = (2 * Math.PI) / R.petals;

// One rosette at unit coords (u, v) about its centre, with its four pyramid
// studs. phaseDeg orients the petals (measured per rosette where readable).
//  boss    raised ring with a small domed dot
//  petals  raised wedges that widen outward to rounded tips; the narrow
//          background left between neighbours reads as a sharp V groove
//  studs   pyramids set diamond-wise on the diagonals, filling the gaps
//          between the quatrefoil lobes
export function rosette(u: number, v: number, k: Instance, phaseDeg: number): number {
  const S = UNIT_PX * k.scale;
  const x = u * S;
  const y = -v * S; // y up, so phases read counter-clockwise like the measurement
  const r = len(x, y);
  let h = 0;

  h += R.ring.height * k.height * bump(r, R.ring.r, R.ring.width);
  if (r < R.dot.r) h += R.dot.height * k.height * Math.sqrt(1 - (r / R.dot.r) ** 2);

  const p = R.petal;
  if (r > p.from - 1 && r < p.to + 1) {
    const a = Math.atan2(y, x) - (phaseDeg * Math.PI) / 180;
    const local = (((a % STEP) + STEP) % STEP) - STEP / 2; // angle off the petal axis
    const t = Math.abs(local) / ((STEP / 2) * p.fill); // 0 on the axis, 1 at the petal edge
    if (t < 1) {
      // rounded tip: the petal ends on an arc whose radius is its half-width there
      const halfW = r * Math.sin((STEP / 2) * p.fill);
      const tipCentre = p.to - halfW;
      const along = r > tipCentre ? Math.sqrt(Math.max(0, 1 - ((r - tipCentre) / halfW) ** 2)) : 1;
      const across = Math.sqrt(1 - t * t);
      const base = smooth((r - p.from) / 3); // rises out of the ring
      h += p.height * k.height * Math.min(across, along) * base;
    }
  }

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const dx = Math.abs(u - sx * P.offset) * S;
      const dy = Math.abs(v - sy * P.offset) * S;
      const m = dx + dy; // diamond-wise: a square turned 45 degrees
      if (m < P.halfBase) h += P.height * k.height * (1 - m / P.halfBase);
    }
  }
  return h;
}
