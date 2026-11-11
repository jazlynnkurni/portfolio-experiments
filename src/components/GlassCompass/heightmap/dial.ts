import { DIAL } from "../config";
import type { HeightLayer } from "./compose";
import { PILL_SLOTS } from "./dialData";

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Rounded ridge: cos^2 bump, so crests and flanks stay soft and refractive.
function ridge(r: number, centre: number, width: number, height: number): number {
  const t = (r - centre) / (width / 2);
  if (t <= -1 || t >= 1) return 0;
  const c = Math.cos((t * Math.PI) / 2);
  return height * c * c;
}

// Medallion profile as a function of radius: raised disc, thick bead on its
// edge, then the moat with its fine ridge, rising back to the outer band (0).
export function borderProfile(r: number, b = DIAL.border): number {
  const c = b.channel;
  const inside = 1 - smooth((r - (c.inner - c.wall)) / c.wall); // disc, falls into the moat
  const outside = smooth((r - c.outer) / c.wall); // climbs out onto the outer band
  const moat = (1 - inside) * (1 - outside);
  return (
    b.discHeight * inside +
    ridge(r, b.bead.r, b.bead.width, b.bead.height) -
    c.depth * moat +
    ridge(r, b.line.r, b.line.width, b.line.height)
  );
}

// Deterministic per-pill randomness.
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

type Pill = {
  ux: number; // unit axis, pointing outward
  uy: number;
  inner: number;
  outer: number;
  halfWidth: number;
  depth: number;
};

function buildPills(): Pill[] {
  const p = DIAL.pills;
  const j = p.jitter;
  const rand = rng(j.seed);
  const s = () => rand() * 2 - 1;
  return PILL_SLOTS.map(([deg, long]) => {
    const a = ((deg + s() * j.tiltDeg) * Math.PI) / 180;
    const halfWidth = (long ? p.halfWidthLong : p.halfWidthShort) + s() * j.halfWidth;
    // config gives rim ends; the capsule's centre segment stops a half-width short
    return {
      ux: Math.cos(a),
      uy: Math.sin(a),
      inner: (long ? p.longInner : p.shortInner) + s() * j.inner + halfWidth,
      outer: p.outer + s() * j.inner * 0.4 - halfWidth,
      halfWidth,
      depth: p.depth * (1 + s() * j.depth),
    };
  });
}

const PILLS = buildPills();
const SLOT_PITCH = 360 / PILL_SLOTS.length;
const SLOT_START = PILL_SLOTS[0][0];

// One recessed capsule: rounded walls, softly curved trough floor, and a low
// lip around the rim where the mould edge pushed the glass up.
function pillHeight(px: number, py: number, pill: Pill): number {
  const p = DIAL.pills;
  const along = Math.min(pill.outer, Math.max(pill.inner, px * pill.ux + py * pill.uy));
  const dist = Math.hypot(px - pill.ux * along, py - pill.uy * along);
  const hw = pill.halfWidth;
  const inside = 1 - smooth((dist - (hw - p.wall)) / p.wall);
  const floor = 1 - p.floorCurve * Math.min(1, (dist / hw) ** 2);
  const lipT = (dist - (hw + p.lipOffset)) / p.lipWidth;
  return -pill.depth * inside * floor + p.lip * Math.exp(-lipT * lipT);
}

export function dialHeight(x: number, y: number): number {
  const px = x - DIAL.center[0];
  const py = y - DIAL.center[1];
  const r = Math.hypot(px, py);
  let h = r < DIAL.border.channel.outer + DIAL.border.channel.wall + 1 ? borderProfile(r) : 0;

  const p = DIAL.pills;
  const reach = p.halfWidthLong + p.lipOffset + 3 * p.lipWidth;
  if (r > p.longInner - reach && r < p.outer + reach) {
    let deg = (Math.atan2(py, px) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    const k = Math.round((deg - SLOT_START) / SLOT_PITCH);
    // nearest slot plus neighbours, so lips and drifted pills blend
    let best = 0;
    for (let o = -1; o <= 1; o++) {
      const n = PILL_SLOTS.length;
      const pill = PILLS[(((k + o) % n) + n) % n];
      const ph = pillHeight(px, py, pill);
      if (Math.abs(ph) > Math.abs(best)) best = ph;
    }
    h += best;
  }
  return h;
}

// 1 where a pill (rim plus lip) is pressed, 0 clear of every pill, so the
// lattice ornament underneath gives way to the smooth pill troughs.
export function pillMask(x: number, y: number): number {
  const px = x - DIAL.center[0];
  const py = y - DIAL.center[1];
  const p = DIAL.pills;
  const reach = p.halfWidthLong + p.lipOffset + p.lipWidth + 2;
  const r = Math.hypot(px, py);
  if (r < p.longInner - reach || r > p.outer + reach) return 0;
  let deg = (Math.atan2(py, px) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const k = Math.round((deg - SLOT_START) / SLOT_PITCH);
  const n = PILL_SLOTS.length;
  let m = 0;
  for (let o = -1; o <= 1; o++) {
    const pill = PILLS[(((k + o) % n) + n) % n];
    const along = Math.min(pill.outer, Math.max(pill.inner, px * pill.ux + py * pill.uy));
    const dist = Math.hypot(px - pill.ux * along, py - pill.uy * along);
    const edge = pill.halfWidth + p.lipOffset + p.lipWidth * 0.6;
    m = Math.max(m, 1 - smooth((dist - edge) / 1.5));
  }
  return m;
}

export const dialLayer: HeightLayer = {
  name: "dial",
  height: (x, y) => dialHeight(x, y),
};
