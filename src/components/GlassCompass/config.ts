// Every tunable for the glass compass tile. All lengths are in reference
// pixels: the reference image is 736 x 736 and the tile fills it edge to edge,
// so 1 world unit = 1 reference pixel.

export const TILE = {
  size: 736, // tile width and height (measured: tile touches all four edges)

  // Corners: superellipse quadrants, fitted one by one to the reference
  // outline (rms 0.34 to 0.51 px). spanX runs along the top/bottom edge,
  // spanY along the side edge. Keys are as seen: t = top, l = left.
  corners: {
    tl: { spanX: 180, spanY: 180, n: 2.3 },
    tr: { spanX: 182, spanY: 180, n: 2.3 },
    bl: { spanX: 174, spanY: 172, n: 2.2 },
    br: { spanX: 180, spanY: 176, n: 2.3 },
  },
};

// Outer rim profile, measured inward from the silhouette edge.
// Reference: a rounded outer bead, a fine groove, then a softer inner fillet
// that settles onto the flat field where the ornaments will sit.
export const RIM = {
  // Heights kept low against the thin slab: the reference edge band reads as
  // a light lip with fine lines, not a dark frame.
  beadWidth: 8, // outer rounded bead, from the edge to the groove
  beadHeight: 2.5, // peak height of the bead above the field
  grooveDepth: 0.9, // groove between bead and fillet, below bead level
  filletWidth: 6, // inner fillet blending down to the field
  filletHeight: 1.4, // height where the fillet meets the groove
  edgeDrop: 2, // how far the very edge rolls down below the field (bullnose)
};

// Compass dial, measured from the reference in polar coordinates.
// Centre fitted to the border groove over 344 angles (median residual 2 px).
// Radii are px from the dial centre.
export const DIAL = {
  center: [2.4, 1.8] as [number, number], // offset from the tile centre, y up

  // Raised medallion with a thick embossed edge and a moat. In the reference
  // the dial face is ~30 levels darker than the outer band (thicker glass),
  // r 310 to 318 is a dark band (the thick rounded bead), r 319 to 329 is a
  // bright band (thin channel floor) crossed by a fine line at 324.3, and the
  // outer band resumes at ~331.
  border: {
    discHeight: 2.5, // dial face above the outer band
    bead: { r: 314, width: 10, height: 5 }, // on top of the disc
    channel: { inner: 320.5, outer: 329.5, wall: 2.5, depth: 0.6 }, // below the outer band
    line: { r: 324.3, width: 1.8, height: 0.9 }, // fine ridge in the channel
  },

  // Recessed pills, alternating long and short, outer ends aligned.
  pills: {
    // Rim ends of each capsule (where the wall meets the face), from the
    // reference's bright-core edges plus the 3 px wall.
    outer: 296.5,
    longInner: 240,
    shortInner: 263.5,
    halfWidthLong: 7,
    halfWidthShort: 6.5,
    depth: 6.5, // trough depth below the dial face (pressed pills run ~half as deep as wide)
    wall: 3, // rounded wall width at the rim
    floorCurve: 0.3, // how much the trough floor rounds toward the walls
    lip: 1, // raised lip around each pill
    lipOffset: 0.9, // lip centre, px outside the rim
    lipWidth: 2.2,
    // Seeded per-pill irregularity, like a hand-cut mould.
    jitter: { inner: 1.5, halfWidth: 0.35, depth: 0.12, tiltDeg: 0.5, seed: 59 },
  },
};

// Pressed lattice ornament under and around the dial: quatrefoils on a grid,
// rosettes at the half-grid points, four pyramid studs around each rosette.
// Measured from the reference in image px (y down). Motifs are drawn in a
// unit cell and mapped through the measured lattice basis, which keeps the
// reference's slight horizontal stretch (cell 192 x 173 px).
export const ORNAMENT = {
  lattice: {
    origin: [90.9, 100.8] as [number, number], // quatrefoil (0,0) centre, image px
    ei: [192.36, 0.7] as [number, number], // one step right
    ej: [1.01, 173.1] as [number, number], // one step down
    from: -1,
    to: 4, // quatrefoil indices drawn on each axis (clipped by the tile)
  },
  // Centres that converged when measured (radial-line convergence, restart
  // spread < 3 px). Everything else sits on the fitted lattice.
  measured: [
    { at: [0, 0], centre: [89.2, 96.1] },
    // read off its flower: left almond on y 92, bottom almond on x 676
    { at: [3, 0], centre: [676, 92] },
    { at: [0, 3], centre: [95.9, 621.4] },
    { at: [3, 3], centre: [671.1, 622.0] },
    { at: [1, 1], centre: [287.5, 275.2] },
    { at: [1.5, 0.5], centre: [379.8, 189.0] },
    { at: [0.5, 1.5], centre: [187.4, 363.4] },
    { at: [2.5, 1.5], centre: [575.8, 363.7] },
    { at: [1.5, 2.5], centre: [377.9, 531.2] },
  ] as { at: [number, number]; centre: [number, number] }[],

  // Quatrefoil, unit-cell units unless marked px. Outline = four lobe circles
  // plus a central disc; tip to tip ~178 x 162 px, cusps at ~0.33 diagonal.
  quatrefoil: {
    lobeOffset: 0.233,
    lobeRadius: 0.232,
    coreRadius: 0.29, // fills the centre between the lobes
    // Pressed glass relief is deep: the reference frames are bold rounded
    // bands ~8 to 10 px wide with bright crests and dark flanks.
    outerRidge: { at: 4, width: 8, height: 5 }, // px inside the outline
    innerRidge: { at: 10, width: 3.6, height: 2.5 },
    fieldStart: 12, // px inside the outline where the stippled field begins
    fieldDepth: 2.5, // field pressed below the lattice background
    connector: { height: 4, width: 5, tipWidth: 2 }, // nub from each lobe apex
    // centre flower
    // reference almonds are raised glossy beads ~32 x 16 px
    petal: { from: 0.15, to: 0.33, halfWidth: 0.046, height: 4 },
    // thick C-scrolls hugging the petal bases
    curl: { offset: 0.115, radius: 0.06, height: 4.6, width: 7 },
    boss: { radius: 6, height: 3.6, moat: 8.5, moatDepth: 1.4 }, // px
  },

  // Rosette, px about its centre: ringed boss and 12 raised wedge petals that
  // widen outward to rounded tips, split by sharp V grooves.
  // Petal phases measured per rosette (12th angular harmonic); others seeded.
  rosette: {
    petals: 12,
    ring: { r: 5.5, width: 3, height: 3 },
    dot: { r: 2.4, height: 2.4 },
    petal: { from: 8, to: 31, fill: 0.78, height: 3.4 }, // fill = share of each sector the petal takes
    phases: { "1.5,0.5": 28.6, "0.5,1.5": 19.9, "2.5,1.5": 7.5, "1.5,2.5": 13.6 } as Record<string, number>,
  },
  // Pyramid studs on the rosette diagonals (unit offset), set diamond-wise so
  // their facets read as triangles pointing at the rosette. halfBase px.
  pyramid: { offset: 0.17, halfBase: 12, height: 7 },

  // Dense raised dots in the quatrefoil fields, px.
  // Shallow beads: steep ones each mirror the key light as a white pinpoint.
  // Reference beads are near-touching domes about 4 px across.
  stipple: { pitch: 4.6, jitter: 0.6, radius: 2.05, radiusJitter: 0.15, height: 1.1, heightJitter: 0.25 },

  // Hand-made irregularity per motif.
  irregularity: { scale: 0.015, rotationDeg: 0.8, height: 0.08, ridgeWobble: 0.12, seed: 131 },

  // Where the ornament gives way: the dial's bead and moat, and the outer rim.
  clear: { borderFrom: 304, borderTo: 334, fade: 3, rimFrom: 11, rimFade: 6 },
};

// Compass needle, measured from the reference (image px, y down). One
// straight elongated diamond: a ruby half toward the upper right and a pale
// silver half toward the lower left, meeting at a straight junction through
// the dial centre. No hub. Both halves measured separately and found nearly
// identical (half-widths agree within ~1.5 px), so they share one profile.
export const NEEDLE = {
  pivot: [365.6, 367.6] as [number, number], // junction midpoint (dial centre is 369.9, 365.7)
  angleDeg: 40.25, // red tip direction, CCW from +x with y up
  length: 295, // each half, junction to tip
  // half-width (px) against distance from the junction, averaged red/silver
  halfWidth: [
    [0, 38], [10, 38], [20, 36.8], [30, 35.7], [40, 34.3], [50, 32.4], [60, 32], [70, 29.9],
    [80, 29], [90, 27.7], [100, 26.6], [110, 25], [120, 23.8], [130, 22.3], [140, 21.3],
    [150, 20.1], [160, 19.4], [170, 18], [180, 16.4], [190, 15], [200, 14.2], [210, 13],
    [220, 11.5], [230, 10.3], [240, 9.1], [250, 7.5], [260, 5.8], [270, 5.1], [280, 4.2],
    [290, 2.3], [295, 0],
  ] as [number, number][],
  junctionTilt: -0.0832, // the junction leans 4.8 deg: its s shifts this much per px across
  // relief, px
  plate: 2.2, // the needle body stands proud of the dial face
  crown: 0.8, // gentle rise toward the axis
  edgeSoft: 1.2, // molded edge
  border: { inset: 2.8, width: 2.6, height: 2.4 }, // thin raised border along both sides
  chevrons: { period: 20, slope: 1, height: 0.7, width: 1.8, band: 0.55, from: 15, to: 0.72 },
  junctionGroove: { depth: 0.6, width: 2 },
  underKeep: 0.65, // share of the dial and lattice relief still pressed under the needle
  // colour: absorption colour at the material's attenuation distance
  // (reference red averages #AF4E37)
  red: { deep: "#B0260E", light: "#D24B28", scale: 60, seed: 5 }, // uneven ruby
  silver: "#C0C8BF", // near-neutral: the glass beneath already adds green // pale sage-silver, translucent rather than white (reference #A5B79F)
  edgeDarken: { width: 5, amount: 0.35 }, // thicker glass along the borders reads deeper
};

// Stage 5 surface optics. All physical knobs on the same glass.
export const SURFACE = {
  // Roughness per texel, as a factor on GLASS.roughness. Recessed,
  // mould-contact glass is slightly hazier; raised, fire-polished crests are
  // smoother and carry thin crisp highlights. Recess and crest are read
  // against a blurred copy of the relief.
  // fine* : features only a few px across (stipple, bubbles, ripple) are
  // mould-textured, so they scatter light rather than each mirroring the sun
  // as a sparkle. Studs and ridges stay polished and keep their glints.
  roughness: {
    blurPx: 6, recessBoost: 0.8, crestCut: 0.45, span: 1.5, noise: 0.15, noiseScale: 9, seed: 61,
    fineBlurPx: 2, fineBoost: 2.2, fineSpan: 0.35, max: 4,
  },
  // Tiny voids trapped in the glass, each a small inverted lens: thinner (so
  // lighter) with a refractive ring. Sparse, slightly clustered.
  bubbles: { count: 260, rMin: 0.5, rMax: 1.8, depth: 0.7, clusterScale: 150, edgeClear: 14, seed: 303 },
  // Very fine, very low surface ripple, well under the ornament's scale.
  ripple: { height: 0.06, scale: 7, seed: 77 },
};

// What lies behind the glass, seen only through it (refracted). A soft,
// neutral, sunlit surface so the relief has something to bend; kept low in
// colour so the green still comes from the glass.
export const BACKDROP = {
  enabled: true,
  base: "#EEEFE8",
  // Refraction only reads where the backdrop varies on the scale the relief
  // shifts it (10 to 30 px), like the fine texture seen through the reference.
  dapple: { scale: 130, amount: 0.12, seed: 19 }, // broad light and shade, kept calm so it never reads as camouflage
  grain: { scale: 8, amount: 0.16, seed: 23 }, // soft out-of-focus texture
  distance: 60, // px behind the tile
  gain: 2.6, // sunlit brightness (linear), above paper white
  res: 512,
};

// Stage 6 sunlight. Warm, low, late-afternoon sun from the upper left.
// World frame: the tile lies in x/y (y up), the camera looks down -z.
export const SUN = {
  azimuthDeg: 135, // in the tile plane, CCW from +x: 135 = upper left
  elevationDeg: 32, // above the tile plane; low, late afternoon
  colour: "#FFE2B8", // warm white
  intensity: 2.6, // directional light: thin highlights and selective glints
  // the same sun inside the environment, as a soft disc with a broad halo
  // (an area-light approximation, so no pinpoint reflections). Bright, since
  // glass reflects only ~4 percent of it face-on.
  glow: { strength: 11, innerDeg: 4, outerDeg: 22 },
  sky: {
    zenith: [1.15, 1.18, 1.24] as [number, number, number], // cool sky
    horizon: [0.8, 0.82, 0.82] as [number, number, number],
    ground: [0.14, 0.16, 0.13] as [number, number, number],
  },
  // slow drift, like light through a nearby window; off for reduced motion
  // wide and slow enough to see light glide across the relief, never a sweep
  sway: { azimuthDeg: 15, elevationDeg: 4, periodSec: 30, fps: 30 },
  // sunlit surface behind the glass: brighter toward the sun
  window: { strength: 0.16 },
  // light gathered by convex relief into the glass and the surface beneath
  // blurPx: only relief broader than the stipple focuses light, so the
  // patterns come from ridges and petals, never a speckle of hot dots
  caustics: { strength: 0.45, depth: 14, max: 1.8, blurPx: 3.5, eps: 2 },
};

// Hover. One clock t counts up while hovered and back down when the pointer
// leaves; every motion is a function of t, so leaving replays it in reverse
// to exactly the rest pose. Only the hands move. Every other element stays
// exactly where it is and changes through light alone: the sun circles the
// dial and sinks low, so each ridge, petal, stud and pill shows a strong lit
// side, a shaded side and a long cast shadow that swings round it.
export const HOVER = {
  spinUpSec: 0.6, // ease-in: motions start from rest and build up
  minuteRevSec: 6, // red hand, one clockwise turn
  hourRevSec: 30, // silver hand
  sunOrbitRevSec: 10, // light circling the dial, clockwise
  sunDropDeg: 18, // the sun sinks this much lower, so shadows grow long
  relief: { rest: 0.35, hover: 1 }, // strength of per-element light and shadow
  causticBoost: 0, // extra light gathering at full hover (off: drifting patterns read as movement)
  speed: 3, // clock speed while hovered (timings above are at 1x)
  // leaving: hands and light glide straight back to rest by the shortest way
  // round, instead of replaying every turn in reverse; they arrive moving
  settleSec: 0.6,
  // ...and land with a spring: the hands overshoot a fixed few degrees in the
  // direction they were travelling, spring back once and settle, a clear
  // "home again" click
  // peak about 6 deg past home, one smaller rebound, still by ~0.6 s
  snap: { overshootDeg: 10, periodSec: 0.26, decaySec: 0.13, durationSec: 0.75 },
};

// The two hands, drawn as glass over the tile so they can turn. alpha is how
// much of the tile shows through; gain sets their seen colour.
export const HANDS = {
  // see-through enough that the ornament reads inside, as in the reference
  red: { alpha: 0.77, gain: 1.05 },
  silver: { alpha: 0.55, gain: 1.6 },
  specular: 1.1, // sun highlight on the facets
  sheen: 0.45, // sky reflection, Fresnel weighted
  facet: { base: 0.68, slope: 0.6 }, // light across the facets: base + slope * (n . sun)
  bake: { along: 640, across: 176, pad: 6 }, // texture size and px margin
  lift: 20, // drawn above the tile's highest relief
};

// Glass thickness field, px. Drives Beer-Lambert absorption, so thick glass
// reads deep moss and thin glass reads pale mint.
export const SLAB = {
  // thickness = minThickness + baseThickness * exp(variation * field), where
  // field = the reference-aligned low-pass field + a little procedural fbm.
  // Thin relative to the relief, as in real pressed glass, so a pill recess
  // removes about half the local glass and reads pale. The floor keeps every
  // recess from bottoming out in thin areas, so pills always read.
  minThickness: 6,
  baseThickness: 3,
  variation: 1.7,
  referenceWeight: 1, // 0 = purely procedural swells
  detail: 0.35, // procedural fbm amplitude on top of the reference field
  variationScale: 300, // px per noise feature
  variationOctaves: 2, // broad, smooth swells; more octaves read as camouflage
  perimeterThicken: 0, // extra thickness toward the edge (reference edge reads light)
  perimeterFalloff: 46, // px over which the perimeter thickening fades
  seed: 7,
};

// Uneven colourant: the pigment drifts between olive and cool mint in broad
// patches. Multiplies transmitted light, so it is kept close to white.
export const PIGMENT = {
  // Thin glass shows mostly pigment, and the reference's thin pill cores are
  // cool mint (#B5C9BB), so the drift sits on the cool side.
  olive: "#EEF1E4",
  mint: "#E2F2EE",
  scale: 340, // px per patch
  seed: 23,
};

// Vintage pressing flaws in the surface itself: a slow waviness that bends
// reflections slightly. Fine bubbles and flaws come in Stage 5.
export const IMPERFECTIONS = {
  waviness: 0.55, // px of height
  wavinessScale: 110, // px per ripple feature
  seed: 41,
};

export type GlassParams = {
  transmission: number;
  ior: number;
  roughness: number;
  thicknessScale: number; // multiplies the thickness field
  attenuationColor: string;
  attenuationDistance: number; // px
  envMapIntensity: number;
  specularIntensity: number;
};

// Beer-Lambert: light that travels `attenuationDistance` px through the glass
// is left with `attenuationColor` (the sampled mid sage, p50).
export const GLASS: GlassParams = {
  transmission: 1,
  ior: 1.52, // soda-lime glass
  // Fire-polished glass is smooth. Roughness also blurs what is seen through
  // the glass (three samples the backdrop at a roughness mip), so keeping it
  // low lets refraction read. The roughness map varies it per texel.
  roughness: 0.05,
  thicknessScale: 1,
  // Less blue than the p50 sage, so thick glass leans moss (reference thick
  // glass between pills: #648058).
  // softer sage: the reference's mid and light glass is less saturated
  attenuationColor: "#6E8766",
  // Balances the tile median (reference #718861) against the thick glass
  // between pills (reference #648058).
  attenuationDistance: 8.5, // with the brighter backdrop: thin glass pale, thick glass deep
  envMapIntensity: 1.6, // steep molded edges catch Fresnel sky highlights (pale, colourless)
  specularIntensity: 1,
};

export const BACKGROUND = "#F4F3EF"; // neutral off-white

// Palette sampled from the reference (glass pixels only, needle, specular
// glints and background excluded), by luminance percentile.
export const PALETTE = {
  p5: "#364C2C",
  p25: "#546C48",
  p50: "#6E8560",
  p75: "#889D7B",
  p95: "#A9BDA8",
  glint: "#D5E3DD", // mean of the bright low-saturation glints
};

export const RESOLUTION = {
  // ~2 normal-map texels per screen pixel at dpr 2, so 2.6 px pill walls hold
  full: { heightMap: 1536, segments: 512, absorption: 1024, dpr: [1, 2] as [number, number] },
  embed: { heightMap: 768, segments: 256, absorption: 512, dpr: [1, 1.5] as [number, number] },
};
