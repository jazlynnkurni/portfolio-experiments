import { DIAL, ORNAMENT } from "../../config";
import type { HeightLayer } from "../compose";
import { pillMask } from "../dial";
import { centreOf, instanceOf, latticeCoords, toUnit } from "./lattice";
import { quatrefoil } from "./quatrefoil";
import { rosette } from "./rosette";
import { smooth } from "./shape";
import { stipple } from "./stipple";

const C = ORNAMENT.clear;
const LAT = ORNAMENT.lattice;

// How much ornament survives here: none on the dial's bead and moat, none
// inside the pills, faded out before the outer rim.
function gate(x: number, y: number, d: number): number {
  const rim = smooth((d - C.rimFrom) / C.rimFade);
  if (rim <= 0) return 0;
  const r = Math.sqrt((x - DIAL.center[0]) ** 2 + (y - DIAL.center[1]) ** 2);
  const gap = smooth((r - C.borderFrom + C.fade) / C.fade) * (1 - smooth((r - C.borderTo) / C.fade));
  if (gap >= 1) return 0;
  return rim * (1 - gap) * (1 - pillMask(x, y));
}

function phaseFor(a: number, b: number, seed: number): number {
  const measured = ORNAMENT.rosette.phases[`${a},${b}`];
  return measured ?? (seed * 7.3) % (360 / ORNAMENT.rosette.petals);
}

export function ornamentHeight(x: number, y: number, d: number, fine: boolean): number {
  const g = gate(x, y, d);
  if (g <= 0) return 0;
  const [la, lb] = latticeCoords(x, y);
  let h = 0;
  let field = 0;

  const qa = Math.round(la);
  const qb = Math.round(lb);
  if (qa >= LAT.from && qa <= LAT.to && qb >= LAT.from && qb <= LAT.to) {
    const k = instanceOf(qa, qb);
    const [u, v] = toUnit(x, y, centreOf(qa, qb), k);
    const q = quatrefoil(u, v, k);
    h += q.h;
    field = q.field;
  }

  const ra = Math.floor(la) + 0.5;
  const rb = Math.floor(lb) + 0.5;
  if (ra >= LAT.from - 0.5 && ra <= LAT.to + 0.5 && rb >= LAT.from - 0.5 && rb <= LAT.to + 0.5) {
    const k = instanceOf(ra, rb);
    const [u, v] = toUnit(x, y, centreOf(ra, rb), k);
    h += rosette(u, v, k, phaseFor(ra, rb, k.seed));
  }

  if (fine && field > 0) h += field * stipple(x, y);
  return h * g;
}

export const ornamentLayer: HeightLayer = {
  name: "ornament",
  height: (x, y, d, fine) => ornamentHeight(x, y, d, fine),
};
