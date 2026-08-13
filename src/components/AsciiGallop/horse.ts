/**
 * A galloping horse and rider as a signed distance field.
 *
 * Built from tapered capsules blended with an exponential smooth minimum, so
 * the silhouette comes out as one continuous animal rather than a pile of
 * tubes. No canvas and no React, so it can be rasterised anywhere.
 *
 * The gait is a right lead transverse gallop, the four beat asymmetric gait
 * Muybridge settled in 1878. Footfall order is left hind, right hind, left
 * fore, right fore, followed by a period of suspension with the limbs gathered
 * UNDER the body, never splayed out in the old rocking horse pose. Each limb is
 * driven by a hoof trajectory and solved with inverse kinematics, so a planted
 * hoof stays planted while the body travels over it.
 *
 * Model box is MODEL_W x MODEL_H, origin top left, horse facing +x (right).
 */

export const MODEL_W = 200;
export const MODEL_H = 130;

/** the waterline the hooves land on */
const GROUND = 120;
const TAU = Math.PI * 2;

/**
 * A tapered capsule: the segment a to b with radius r1 at a and r2 at b.
 * A circle is the degenerate case where a equals b. Every part of the animal
 * is one of these, which is what lets limbs thin out toward the hoof.
 */
export type Shape = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r1: number;
  r2: number;
  /** axis aligned bounds, cached so far away cells can reject it cheaply */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** Shapes that melt into each other, k being the blend radius. */
export type Group = {
  k: number;
  shapes: Shape[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/**
 * Three separations, printed in three inks. A single merged silhouette reads
 * as one lump, because a rider in a two point seat genuinely touches the horse
 * along the whole thigh. Splitting them is what a riso print would do anyway.
 */
export type Frame = {
  /** the horse itself, the darkest plate */
  horse: Group[];
  /** the jockey, printed in the accent so the figure separates from the animal */
  rider: Group[];
  /** the off side limbs, a shade lighter so the body reads as having depth */
  far: Group[];
};

type Pt = [number, number];

// ---------------------------------------------------------------------------
// shape construction
// ---------------------------------------------------------------------------

function cone(a: Pt, r1: number, b: Pt, r2: number): Shape {
  return {
    ax: a[0],
    ay: a[1],
    bx: b[0],
    by: b[1],
    r1,
    r2,
    x0: Math.min(a[0] - r1, b[0] - r2),
    y0: Math.min(a[1] - r1, b[1] - r2),
    x1: Math.max(a[0] + r1, b[0] + r2),
    y1: Math.max(a[1] + r1, b[1] + r2),
  };
}

function ball(a: Pt, r: number): Shape {
  return cone(a, r, a, r);
}

function group(k: number, shapes: Shape[]): Group {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of shapes) {
    if (s.x0 < x0) x0 = s.x0;
    if (s.y0 < y0) y0 = s.y0;
    if (s.x1 > x1) x1 = s.x1;
    if (s.y1 > y1) y1 = s.y1;
  }
  return { k, shapes, x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------
// distance field
// ---------------------------------------------------------------------------

/** iq's 2D round cone: exact distance to a capsule with a different radius at each end */
function sdCone(px: number, py: number, s: Shape): number {
  const bax = s.bx - s.ax;
  const bay = s.by - s.ay;
  const l2 = bax * bax + bay * bay;
  const pax = px - s.ax;
  const pay = py - s.ay;
  if (l2 < 1e-9) return Math.sqrt(pax * pax + pay * pay) - s.r1;

  const rr = s.r1 - s.r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const y = pax * bax + pay * bay;
  const z = y - l2;
  const wx = pax * l2 - bax * y;
  const wy = pay * l2 - bay * y;
  const x2 = wx * wx + wy * wy;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = (rr < 0 ? -1 : 1) * rr * rr * x2;

  if ((z < 0 ? -1 : 1) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - s.r2;
  if ((y < 0 ? -1 : 1) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - s.r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - s.r1;
}

/** cheap lower bound on the distance from a point to a shape */
function boundOf(px: number, py: number, s: Shape): number {
  const dx = px < s.x0 ? s.x0 - px : px > s.x1 ? px - s.x1 : 0;
  const dy = py < s.y0 ? s.y0 - py : py > s.y1 ? py - s.y1 : 0;
  return dx > dy ? dx : dy;
}

/** past this many blend radii a part contributes nothing worth computing */
const CUT = 7;

/**
 * Signed distance to a set of groups. Negative inside. Groups are hard unioned
 * with each other and smooth unioned inside themselves, so the rider stays a
 * separate body sitting on a horse whose own parts flow together.
 *
 * The blend is an exponential smooth minimum, evaluated as an online
 * log-sum-exp. Chaining the usual polynomial smin pairwise is not associative:
 * across two dozen parts it inflates the surface a little on every step and
 * the animal swells into a blob. This form takes all parts at once, so the
 * bulge stays bounded no matter how many pieces meet at a joint.
 */
export function distGroups(groups: Group[], px: number, py: number): number {
  let best = Infinity;
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    const k = grp.k;
    const cut = CUT / k;

    // whole group rejection first
    const gx = px < grp.x0 ? grp.x0 - px : px > grp.x1 ? px - grp.x1 : 0;
    const gy = py < grp.y0 ? grp.y0 - py : py > grp.y1 ? py - grp.y1 : 0;
    if (gx > 0 || gy > 0) {
      const gd = Math.sqrt(gx * gx + gy * gy);
      if (gd - cut >= best) continue;
    }

    const shapes = grp.shapes;
    let dmin = Infinity;
    let m = -Infinity;
    let sum = 0;
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      // anything further out than the running best plus the blend reach cannot
      // move the answer, so it never needs an exact distance
      if (boundOf(px, py, s) - cut >= dmin) continue;
      const sd = sdCone(px, py, s);
      if (sd < dmin) dmin = sd;
      const v = -k * sd;
      if (v > m) {
        sum = m === -Infinity ? 1 : sum * Math.exp(m - v) + 1;
        m = v;
      } else {
        sum += Math.exp(v - m);
      }
    }
    if (dmin === Infinity) continue;
    const d = -(m + Math.log(sum)) / k;
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// the rig: every editable control point of the animal
// ---------------------------------------------------------------------------

/** one control point, in neutral model space, with the radius of the flesh on it */
export type RigNode = { x: number; y: number; r: number };

export type Rig = {
  nodes: Record<string, RigNode>;
  legs: {
    foreL1: number;
    foreL2: number;
    hindL1: number;
    hindL2: number;
    foreTop: number;
    foreElbow: number;
    foreKnee: number;
    foreCannon: number;
    foreFet: number;
    foreHoof: number;
    hindTop: number;
    hindStifle: number;
    hindHock: number;
    hindCannon: number;
    hindFet: number;
    hindHoof: number;
    farScale: number;
  };
  blend: { horse: number; rider: number; far: number };
};

/**
 * The default horse. Every number here is a shape decision, so this is the one
 * place to touch when the animal needs to look different.
 */
export const DEFAULT_RIG: Rig = {
  nodes: {
    // trunk, traced as a chain rather than one tube
    chestFront: { x: 127, y: 71, r: 5.2 },
    shoulderLow: { x: 122, y: 68, r: 10.5 },
    shoulderTop: { x: 124.5, y: 62, r: 9.5 },
    withersFront: { x: 117, y: 55, r: 7.5 },
    withers: { x: 116, y: 52, r: 6.8 },
    girthFront: { x: 119, y: 68, r: 14 },
    girthBack: { x: 106, y: 68, r: 14 },
    bellyMid: { x: 88, y: 64, r: 10.5 },
    flank: { x: 70.5, y: 73.3, r: 8 },
    backFront: { x: 114, y: 54, r: 7 },
    backDip: { x: 98, y: 57, r: 6.4 },
    loin: { x: 80, y: 54, r: 7 },
    hipPoint: { x: 74, y: 57, r: 10 },
    croupSide: { x: 63, y: 61, r: 12.5 },
    rump: { x: 60, y: 64, r: 11 },
    croupTop: { x: 62, y: 57, r: 8 },
    dockTop: { x: 57, y: 63, r: 5.5 },
    buttockTop: { x: 58.9, y: 66.4, r: 9.5 },
    buttockLow: { x: 50, y: 60, r: 5.5 },

    // neck and head
    neckBase: { x: 119, y: 54, r: 12.5 },
    neckMid: { x: 140, y: 40, r: 8.4 },
    poll: { x: 157, y: 31, r: 5.3 },
    jaw: { x: 160, y: 37, r: 5.4 },
    skull: { x: 169, y: 38, r: 4.2 },
    muzzle: { x: 182, y: 46, r: 3.1 },
    earBase: { x: 155, y: 26, r: 1.9 },
    earTip: { x: 153, y: 19, r: 0.7 },

    // tail, positions relative to the dock are preserved as it swings
    dock: { x: 59.7, y: 52.5, r: 2.8 },
    tailMid: { x: 43, y: 57, r: 2.9 },
    tailEnd: { x: 31.6, y: 61.5, r: 1.8 },
    tailTip: { x: 19, y: 65, r: 0.6 },

    // limb roots
    shoulderPivot: { x: 130, y: 60, r: 0 },
    hipPivot: { x: 66, y: 64, r: 0 },

    // rider
    seat: { x: 98, y: 45, r: 0 },
    riderHip: { x: 96, y: 34, r: 8 },
    riderShoulder: { x: 114.9, y: 23.7, r: 7.2 },
    riderHelmet: { x: 123, y: 14, r: 5.8 },
    riderPeak: { x: 129, y: 13, r: 1.6 },
    riderStirrup: { x: 105, y: 66, r: 3 },
    riderToe: { x: 109.5, y: 67, r: 2.6 },
  },
  legs: {
    foreL1: 36,
    foreL2: 24,
    hindL1: 32,
    hindL2: 26,
    foreTop: 7.4,
    foreElbow: 4.3,
    foreKnee: 2.7,
    foreCannon: 2.1,
    foreFet: 2.2,
    foreHoof: 2.3,
    hindTop: 10.5,
    hindStifle: 6.6,
    hindHock: 3,
    hindCannon: 2.1,
    hindFet: 2.2,
    hindHoof: 2.3,
    farScale: 0.86,
  },
  blend: { horse: 1.5, rider: 1.35, far: 1.1 },
};

/** deep copy, so an editor can mutate a rig without touching the default */
export function cloneRig(rig: Rig): Rig {
  const nodes: Record<string, RigNode> = {};
  for (const k of Object.keys(rig.nodes)) nodes[k] = { ...rig.nodes[k] };
  return { nodes, legs: { ...rig.legs }, blend: { ...rig.blend } };
}

// ---------------------------------------------------------------------------
// kinematics
// ---------------------------------------------------------------------------

/**
 * Two bone inverse kinematics. Returns the joint position for a chain of
 * lengths l1 and l2 running from root to target. `bend` picks which side the
 * joint falls on: +1 puts it behind the root to target line, -1 in front.
 */
function ik(root: Pt, target: Pt, l1: number, l2: number, bend: number): Pt {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const raw = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / raw;
  const uy = dy / raw;
  // a limb can neither hyperextend nor fold through itself
  const d = Math.min(Math.max(raw, Math.abs(l1 - l2) + 0.001), (l1 + l2) * 0.999);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return [root[0] + ux * a - uy * h * bend, root[1] + uy * a + ux * h * bend];
}

const lerp = (a: Pt, b: Pt, u: number): Pt => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
];

const smoothstep = (u: number) => u * u * (3 - 2 * u);
const wrap01 = (u: number) => u - Math.floor(u);

/** rotate p about o */
function rot(p: Pt, o: Pt, ang: number): Pt {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dx = p[0] - o[0];
  const dy = p[1] - o[1];
  return [o[0] + dx * c - dy * s, o[1] + dx * s + dy * c];
}

/**
 * Where a hoof is at cycle position t.
 *
 * During stance the hoof is nailed to the ground and slides backward through
 * the frame, because the camera travels with the horse. During swing it folds
 * up, carries forward and reaches out again for the next beat.
 */
function hoofAt(
  t: number,
  offset: number,
  stance: number,
  baseX: number,
  reach: number,
  lift: number,
): Pt {
  const local = wrap01(t - offset);
  if (local < stance) {
    const s = local / stance;
    return [baseX + reach * (1 - 2 * s), GROUND];
  }
  const s = (local - stance) / (1 - stance);
  // the limb hesitates a beat before it swings, which is the fold
  const drive = smoothstep(Math.min(1, Math.max(0, (s - 0.12) / 0.88)));
  const arc = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.82)), 1.25);
  return [baseX - reach + 2 * reach * drive, GROUND - lift * arc];
}

// ---------------------------------------------------------------------------
// the animal
// ---------------------------------------------------------------------------

type LegSpec = {
  offset: number;
  stance: number;
  baseX: number;
  reach: number;
  lift: number;
};

/** left hind leads the stride, right fore is the leading foreleg */
const HIND_NEAR: LegSpec = { offset: 0.0, stance: 0.28, baseX: 64, reach: 23, lift: 26 };
const HIND_FAR: LegSpec = { offset: 0.1, stance: 0.28, baseX: 64, reach: 23, lift: 26 };
const FORE_NEAR: LegSpec = { offset: 0.28, stance: 0.27, baseX: 128, reach: 25, lift: 28 };
const FORE_FAR: LegSpec = { offset: 0.38, stance: 0.27, baseX: 128, reach: 25, lift: 28 };

function foreLeg(pivot: Pt, hoof: Pt, scale: number, L: Rig["legs"]): Shape[] {
  // the carpus folds caudally, so the knee always sits behind the limb line
  const carpus = ik(pivot, hoof, L.foreL1, L.foreL2, 1);
  const fetlock = lerp(carpus, hoof, 0.68);
  const elbow = lerp(pivot, carpus, 0.42);
  const s = scale;
  return [
    // shoulder and forearm as one tapering mass, thick above, fine at the knee
    cone(pivot, L.foreTop * s, carpus, L.foreKnee * s),
    ball(elbow, L.foreElbow * s),
    ball(carpus, L.foreKnee * s),
    cone(carpus, L.foreCannon * s, fetlock, L.foreCannon * 0.81 * s),
    ball(fetlock, L.foreFet * s),
    cone(fetlock, L.foreCannon * 0.81 * s, hoof, L.foreHoof * s),
  ];
}

function hindLeg(pivot: Pt, hoof: Pt, scale: number, L: Rig["legs"]): Shape[] {
  // the hock trails behind, the stifle swings forward: the Z of a horse's hind leg
  const hock = ik(pivot, hoof, L.hindL1, L.hindL2, 1);
  const stifle = ik(pivot, hock, 22, 22, -1);
  const fetlock = lerp(hock, hoof, 0.66);
  const s = scale;
  return [
    cone(pivot, L.hindTop * s, stifle, L.hindStifle * s),
    cone(stifle, L.hindStifle * 1.03 * s, hock, L.hindHock * 0.9 * s),
    ball(hock, L.hindHock * s),
    cone(hock, L.hindCannon * s, fetlock, L.hindCannon * 0.81 * s),
    ball(fetlock, L.hindFet * s),
    cone(fetlock, L.hindCannon * 0.81 * s, hoof, L.hindHoof * s),
  ];
}

/**
 * Builds the horse and rider for one position in the stride.
 * @param t cycle position, wraps every 1.0
 */
export function buildGallop(
  t: number,
  rig: Rig = DEFAULT_RIG,
  /** freeze every oscillation so control points sit exactly where the rig puts them */
  neutral = false,
): Frame {
  const N = rig.nodes;
  const L = rig.legs;
  const r = (k: string): number => N[k].r;

  // --- trunk physics -------------------------------------------------------
  // the mass rises through suspension and sinks as the forelimbs take the load
  const bob = neutral ? 0 : -4.2 * Math.cos(TAU * (t - 0.82));
  // and pitches nose up over the hind drive, nose down onto the forehand
  const pitch = neutral ? 0 : 0.075 * Math.cos(TAU * (t - 0.16));
  // the back rounds as the limbs gather, hollows as the horse pushes off
  const flex = neutral ? 0 : Math.sin(TAU * (t - 0.7));

  const centre: Pt = [98, 58];
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  const tx = (x: number, y: number): Pt => {
    const dx = x - centre[0];
    const dy = y - centre[1];
    return [
      centre[0] + dx * cos - dy * sin,
      centre[1] + dx * sin + dy * cos + bob,
    ];
  };
  const txn = (k: string, dy = 0): Pt => tx(N[k].x, N[k].y + dy);

  const shoulderPivot = txn("shoulderPivot");
  const hipPivot = txn("hipPivot");

  const loinLift = -2.2 * flex;
  const croupTuck = 1.3 * flex;

  // The trunk is traced as a chain of short cones rather than one long tube.
  // A horse is not a cylinder: it is deepest just behind the elbow, tucks up
  // hard at the flank, carries a distinct bump at the withers with a dip
  // behind it, and its croup slopes away to the dock instead of doming over.
  const horse: Shape[] = [
    cone(txn("chestFront"), r("chestFront"), txn("shoulderLow"), r("shoulderLow")),
    cone(
      txn("shoulderTop"),
      r("shoulderTop"),
      txn("withersFront", loinLift * 0.2),
      r("withersFront"),
    ),
    ball(txn("withers", loinLift * 0.3), r("withers")),

    cone(txn("girthFront"), r("girthFront"), txn("girthBack"), r("girthBack")),
    cone(txn("girthBack"), r("girthBack"), txn("bellyMid"), r("bellyMid")),
    cone(txn("bellyMid"), r("bellyMid"), txn("flank", loinLift * 0.3), r("flank")),

    cone(
      txn("backFront", loinLift * 0.4),
      r("backFront"),
      txn("backDip", loinLift),
      r("backDip"),
    ),
    cone(
      txn("backDip", loinLift),
      r("backDip"),
      txn("loin", loinLift * 0.6),
      r("loin"),
    ),

    cone(
      txn("hipPoint", croupTuck),
      r("hipPoint"),
      txn("croupSide", croupTuck),
      r("croupSide"),
    ),
    ball(txn("rump", croupTuck), r("rump")),
    cone(
      txn("croupTop", croupTuck),
      r("croupTop"),
      txn("dockTop", croupTuck),
      r("dockTop"),
    ),
    cone(
      txn("buttockTop", croupTuck),
      r("buttockTop"),
      txn("buttockLow", croupTuck),
      r("buttockLow"),
    ),
  ];

  // --- neck and head -------------------------------------------------------
  // the neck reaches out and down through the drive, gathers back up in the air
  const neckPhase = TAU * (t - 0.3);
  const neckAng = neutral ? 0 : 0.155 * Math.sin(neckPhase);
  const headAng = neutral ? 0 : neckAng + 0.11 * Math.sin(neckPhase - 0.7);

  const neckBase = txn("neckBase");
  const rotN = (k: string, ang: number): Pt => rot(txn(k), neckBase, ang);
  const neckMid = rotN("neckMid", neckAng);
  const poll = rotN("poll", neckAng);
  const skull = rotN("skull", headAng);
  const muzzle = rotN("muzzle", headAng);
  const jaw = rotN("jaw", headAng);
  const earTip = rotN("earTip", headAng);
  const earBase = rotN("earBase", headAng);

  horse.push(
    cone(neckBase, r("neckBase"), neckMid, r("neckMid")),
    cone(neckMid, r("neckMid"), poll, r("poll")),
    ball(jaw, r("jaw")),
    cone(poll, r("poll"), skull, r("skull")),
    cone(skull, r("skull"), muzzle, r("muzzle")),
    cone(earBase, r("earBase"), earTip, r("earTip")),
  );

  // --- tail ----------------------------------------------------------------
  // a heavy rope of hair that lags whatever the croup just did
  const tailA = neutral ? 0 : 4.5 * Math.sin(TAU * (t - 0.34));
  const tailB = neutral ? 0 : 6.5 * Math.sin(TAU * (t - 0.46));
  const dock = txn("dock", croupTuck);
  const hair = (k: string, lift: number): Pt => [
    dock[0] + (N[k].x - N.dock.x),
    dock[1] + (N[k].y - N.dock.y) + lift,
  ];
  const tailMid = hair("tailMid", tailA);
  const tailEnd = hair("tailEnd", tailB);
  const tailTip = hair("tailTip", tailB * 1.3);
  horse.push(
    cone(dock, r("dock"), tailMid, r("tailMid")),
    cone(tailMid, r("tailMid"), tailEnd, r("tailEnd")),
    cone(tailEnd, r("tailEnd"), tailTip, r("tailTip")),
  );

  // --- limbs ---------------------------------------------------------------
  const hoof = (spec: LegSpec) =>
    hoofAt(t, spec.offset, spec.stance, spec.baseX, spec.reach, spec.lift);
  horse.push(...hindLeg(hipPivot, hoof(HIND_NEAR), 1, L));
  horse.push(...foreLeg(shoulderPivot, hoof(FORE_NEAR), 1, L));

  const fs = L.farScale;
  const farLegs: Shape[] = [
    ...hindLeg(hipPivot, hoof(HIND_FAR), fs, L),
    ...foreLeg(shoulderPivot, hoof(FORE_FAR), fs, L),
  ];

  // --- rider ---------------------------------------------------------------
  // A jockey rides out of the saddle in a two point seat. Their mass stays
  // almost level while the horse oscillates underneath, and the knee and ankle
  // swallow the difference, so the hip is only weakly coupled to the bob.
  const seat = txn("seat");
  const hip: Pt = [
    seat[0] + (N.riderHip.x - N.seat.x),
    N.riderHip.y + (seat[1] - N.seat.y) * 0.32,
  ];
  const stirrup = txn("riderStirrup");
  const torsoAng = neutral ? 0 : -0.05 * Math.sin(TAU * (t - 0.55));
  const off = (k: string): Pt =>
    rot([hip[0] + (N[k].x - N.riderHip.x), hip[1] + (N[k].y - N.riderHip.y)], hip, torsoAng);
  const shoulder = off("riderShoulder");
  const helmet = off("riderHelmet");
  const peak = off("riderPeak");

  // the hands stay down on the crest, so the arms follow the neck as it works
  const hand = lerp(neckBase, poll, 0.72);
  const rein: Pt = [hand[0] + 10, hand[1] + 3];

  const knee = ik(hip, stirrup, 20, 19, -1);
  const elbow = ik(shoulder, hand, 14, 13.5, 1);
  const toe: Pt = [
    stirrup[0] + (N.riderToe.x - N.riderStirrup.x),
    stirrup[1] + (N.riderToe.y - N.riderStirrup.y),
  ];

  const rider: Shape[] = [
    cone(hip, r("riderHip"), shoulder, r("riderShoulder")),
    ball(helmet, r("riderHelmet")),
    cone(helmet, r("riderHelmet") * 0.59, peak, r("riderPeak")),
    cone(shoulder, 4.2, elbow, 3.4),
    cone(elbow, 3.4, hand, 2.6),
    cone(hip, r("riderHip") * 0.8, knee, 4.6),
    cone(knee, 4.3, stirrup, r("riderStirrup")),
    cone(stirrup, r("riderStirrup") * 1.07, toe, r("riderToe")),
    // the rein, a thin line from hand to bit
    cone(hand, 1, rein, 0.8),
  ];

  return {
    horse: [group(rig.blend.horse, horse)],
    rider: [group(rig.blend.rider, rider)],
    far: [group(rig.blend.far, farLegs)],
  };
}
