// S, O, F, T, as circles.
//
// The reference is type: four letterforms built from metaballs, each held still
// and poured into the next. Differencing the silhouette frame to frame gives
// four clean minima 24 frames apart at 40ms, so the beat is 0.96s and the word
// is SOFT.
//
// Recovered, not drawn. Each held frame is blurred wider than its 4 pixel
// dither, thresholded, then covered greedily: take the point furthest from the
// background, put a circle there, erase the whole circle, repeat.
//
// Two things had to be right and neither was obvious.
//
// Erase the WHOLE disc. Erasing part of it leaves the rim of the last one as
// the tallest thing around, so the next pick lands beside it and the budget
// goes on one fat lobe while the thin strokes get nothing.
//
// And threshold at 65, not higher. The reference is RIM LIT: its lobes are
// bright at the edge and about 107 through the middle. Cutting at 95 slices
// through the letter's own interior and the mask comes back full of holes.
// The histogram of a blurred frame settles it: the plate ground peaks at 40,
// the letter runs from 60 up, and the valley between them is 65.
//
// Coordinates are in plate space: x from 0 to 1, y from 0 to 1.4, the sqrt(2)
// proportion the reference's plate measured. The loose discs low on each panel
// are not noise, the reference has them too.

export const PLATE_ASPECT = 1.4;

export type Disc = [number, number, number];

export const LETTERS: Disc[][] = [
  // S
  [
    [0.297, 0.431, 0.229], [0.513, 0.246, 0.188], [0.503, 0.713, 0.177],
    [0.764, 0.354, 0.150], [0.677, 0.764, 0.136], [0.205, 0.938, 0.099],
    [0.538, 0.887, 0.091], [0.533, 0.990, 0.091], [0.364, 1.046, 0.080],
    [0.344, 1.123, 0.080], [0.810, 0.795, 0.075], [0.651, 1.123, 0.074],
    [0.595, 1.056, 0.074], [0.292, 0.985, 0.064], [0.441, 1.026, 0.062],
    [0.123, 0.995, 0.061], [0.877, 0.841, 0.054], [0.903, 0.892, 0.052],
    [0.451, 1.267, 0.051], [0.164, 1.133, 0.050], [0.379, 1.195, 0.050],
    [0.108, 1.072, 0.050], [0.908, 0.959, 0.049], [0.262, 1.144, 0.049],
    [0.728, 1.123, 0.048], [0.887, 1.021, 0.047],
  ],
  // O
  [
    [0.656, 0.313, 0.221], [0.277, 0.862, 0.219], [0.251, 0.579, 0.188],
    [0.774, 0.682, 0.187], [0.369, 0.323, 0.177], [0.410, 1.036, 0.086],
    [0.677, 0.846, 0.080], [0.538, 1.185, 0.079], [0.308, 1.082, 0.079],
    [0.785, 0.492, 0.073], [0.718, 1.041, 0.065], [0.651, 0.533, 0.063],
    [0.656, 0.933, 0.063], [0.303, 1.159, 0.055], [0.892, 0.831, 0.054],
    [0.410, 1.287, 0.054], [0.308, 1.221, 0.052], [0.805, 1.031, 0.051],
    [0.354, 1.277, 0.050], [0.908, 0.903, 0.049], [0.697, 1.103, 0.049],
    [0.477, 1.097, 0.048], [0.472, 1.267, 0.048], [0.903, 0.954, 0.046],
    [0.672, 0.995, 0.044], [0.856, 1.010, 0.043],
  ],
  // F
  [
    [0.328, 0.277, 0.181], [0.718, 0.272, 0.144], [0.605, 0.764, 0.136],
    [0.287, 0.959, 0.129], [0.292, 0.779, 0.116], [0.262, 0.456, 0.108],
    [0.564, 0.272, 0.105], [0.800, 0.390, 0.099], [0.862, 0.313, 0.062],
    [0.256, 0.564, 0.058], [0.256, 1.256, 0.058], [0.313, 1.262, 0.054],
    [0.369, 1.072, 0.053], [0.390, 1.190, 0.053], [0.205, 1.067, 0.052],
    [0.185, 1.190, 0.052], [0.390, 1.123, 0.050], [0.185, 1.118, 0.049],
    [0.364, 1.236, 0.048], [0.267, 0.667, 0.047], [0.728, 0.128, 0.041],
    [0.200, 1.241, 0.038], [0.703, 0.415, 0.037], [0.190, 0.538, 0.037],
    [0.262, 0.621, 0.037], [0.897, 0.364, 0.035],
  ],
  // T
  [
    [0.246, 0.282, 0.162], [0.549, 0.292, 0.157], [0.795, 0.251, 0.144],
    [0.544, 0.585, 0.144], [0.569, 0.728, 0.123], [0.400, 0.231, 0.089],
    [0.554, 1.056, 0.071], [0.400, 0.344, 0.067], [0.369, 1.103, 0.065],
    [0.503, 0.446, 0.062], [0.585, 0.446, 0.062], [0.446, 0.887, 0.062],
    [0.456, 0.985, 0.059], [0.631, 0.836, 0.058], [0.667, 0.185, 0.053],
    [0.472, 0.821, 0.053], [0.651, 0.897, 0.052], [0.641, 0.949, 0.050],
    [0.605, 1.000, 0.047], [0.533, 1.123, 0.047], [0.590, 1.123, 0.047],
    [0.477, 1.154, 0.045], [0.692, 0.359, 0.038], [0.421, 1.036, 0.036],
    [0.436, 1.138, 0.034], [0.626, 1.154, 0.034],
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
