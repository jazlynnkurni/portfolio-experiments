// S, O, F, T, as metaballs.
//
// The reference is type: four letterforms built from metaballs, each held still
// and poured into the next. Differencing the silhouette frame to frame gives
// four clean minima 24 frames apart at 40ms, so the beat is 0.96s and the word
// is SOFT.
//
// HOW THE BALLS WERE FOUND, which took three wrong goes.
//
// The first attempts covered the silhouette with discs: take the point furthest
// from the background, drop a circle on it, erase, repeat. That is a reasonable
// way to approximate a SHAPE and a bad way to recover a CONSTRUCTION. It
// produced twenty six discs of wildly mixed sizes, and rendered back through a
// metaball field they came out as a lumpy mass rather than as a letter, because
// the reference is not twenty six discs. Enlarged and de-dithered it is plainly
// about eight, all roughly the same size, strung along the letter's spine.
//
// The read that works comes out of the lighting. The piece is RIM LIT: a lobe
// is bright around its edge and darkest through its middle, where the surface
// faces the camera. So every ball's centre is a local dark spot, and finding
// the dark spots inside the letter is a direct read of where the balls were
// put. The radius is then the distance from that centre to the nearest edge.
//
// Counts come out uneven, 8, 9, 8 and 7, so each letter is padded to nine with
// nothing-balls parked at its centre of mass. Those grow in and shrink away
// across a morph, which is how a letter with fewer lobes gets to one with more.
//
// Coordinates are in plate space: x from 0 to 1, y from 0 to 1.4, the sqrt(2)
// proportion the reference's plate measured.

export const PLATE_ASPECT = 1.4;

export type Disc = [number, number, number];

export const LETTERS: Disc[][] = [
  // S
  [
    [0.523, 0.754, 0.170], [0.785, 0.385, 0.129], [0.523, 0.185, 0.150],
    [0.185, 0.446, 0.141], [0.323, 0.500, 0.170], [0.277, 0.346, 0.163],
    [0.208, 0.915, 0.091], [0.762, 0.723, 0.079], [0.448, 0.532, 0.000],
  ],
  // O
  [
    [0.762, 0.854, 0.040], [0.815, 0.646, 0.144], [0.208, 0.885, 0.159],
    [0.338, 0.915, 0.170], [0.700, 0.392, 0.170], [0.277, 0.562, 0.170],
    [0.708, 0.238, 0.146], [0.569, 0.338, 0.170], [0.300, 0.300, 0.121],
  ],
  // F
  [
    [0.592, 0.792, 0.116], [0.777, 0.362, 0.129], [0.277, 0.946, 0.128],
    [0.285, 0.762, 0.116], [0.338, 0.238, 0.157], [0.238, 0.500, 0.103],
    [0.577, 0.269, 0.110], [0.731, 0.162, 0.079], [0.477, 0.504, 0.000],
  ],
  // T
  [
    [0.354, 1.100, 0.050], [0.531, 0.577, 0.145], [0.831, 0.231, 0.126],
    [0.200, 0.262, 0.130], [0.592, 0.262, 0.144], [0.423, 0.269, 0.141],
    [0.585, 0.723, 0.117], [0.502, 0.489, 0.000], [0.502, 0.489, 0.000],
  ],
];

// Which disc becomes which.
//
// Pairing them off one at a time, each source grabbing its own nearest free
// target, is order dependent: whichever disc is considered first takes the slot
// it wants and the ones after it are left crossing the plate to whatever is
// left. Those crossings are what turned the middle of every morph into
// irregular shapes, because discs were flying THROUGH each other rather than
// travelling alongside.
//
// Ranking every possible pairing by cost and taking them cheapest first is not
// quite optimal, but it is close, and it removes almost all of the crossings.
// The cost carries size as well as distance: sending a big disc to a small
// slot means it has to deflate on the way, and a lobe that shrinks to nothing
// mid flight leaves a gap in the mass.
export function matchOrder(a: Disc[], b: Disc[]): number[] {
  type Pair = { i: number; j: number; c: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const dx = a[i][0] - b[j][0];
      const dy = a[i][1] - b[j][1];
      const dr = a[i][2] - b[j][2];
      pairs.push({ i, j, c: dx * dx + dy * dy + dr * dr * 6.0 });
    }
  }
  pairs.sort((p, q) => p.c - q.c);

  const order = new Array<number>(a.length).fill(-1);
  const usedSrc = new Array<boolean>(a.length).fill(false);
  const usedDst = new Array<boolean>(b.length).fill(false);
  for (const p of pairs) {
    if (usedSrc[p.i] || usedDst[p.j]) continue;
    usedSrc[p.i] = true;
    usedDst[p.j] = true;
    order[p.i] = p.j;
  }
  // anything left over, if the two letters have different counts
  let free = 0;
  for (let i = 0; i < order.length; i++) {
    if (order[i] >= 0) continue;
    while (free < b.length && usedDst[free]) free++;
    order[i] = Math.min(free, b.length - 1);
    usedDst[order[i]] = true;
  }
  return order;
}
