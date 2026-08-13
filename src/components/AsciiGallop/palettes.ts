/**
 * Colour and glyph banks for the ASCII gallop.
 * Kept apart from the renderer so a palette can be swapped without touching
 * any drawing code.
 *
 * One plate, one set of inks: a blue riso pull. Cyan paper, a near black
 * animal on top of it, a hot vermilion outline, and a confetti band of stray
 * RGB dots in the margin the way a misregistered riso print throws them.
 *
 * The inks are held close in luminance inside each role on purpose. Every cell
 * re-rolls which ink of its role it takes once per pose, and a field of cells
 * swinging between light and dark twelve times a second would be a flash
 * hazard. Keeping each role inside a narrow band lets the grain churn while
 * the plate as a whole holds a steady brightness.
 */

export type Palette = {
  id: string;
  label: string;
  /** the paper the whole thing is printed on */
  bg: string;
  /** the horse itself, the heaviest plate */
  solid: string[];
  /** the off side limbs, one step back from the body */
  far: string[];
  /** the jockey, so the figure separates from the animal */
  rider: string[];
  /** ring 1, the hard outline hugging the silhouette */
  edge: string;
  /** rings 2 and out, the printed confetti band */
  confetti: string[];
  /** the cursor lens */
  accent: string;
};

export const RISO: Palette = {
  id: "riso",
  label: "riso",
  // the plate blue, with a warm bright red as its opposite number and a
  // gold, a pink and a cream filling in around the two of them
  bg: "#2AA8E0",
  solid: ["#101E52", "#0C1743", "#16265F", "#0A1338"],
  far: ["#2440C4", "#1E38B0", "#2B4BD8", "#182F96"],
  rider: ["#FF2F2F", "#FF4438", "#F51F1F", "#FF5A4A"],
  edge: "#FF2F2F",
  confetti: ["#FF2F2F", "#FFC83D", "#FF6FA5", "#FFF0E1", "#2B4FE0", "#FF8A3D"],
  accent: "#FF2F2F",
};

/** Dense glyphs for the body of the horse. */
export const SOLID_GLYPHS = "8096452389";

/** Lighter glyphs for the printed halo rings. */
export const EDGE_GLYPHS = "013457269";

/** Words the cursor stamps into the field as a readable lens. */
export const LENS_WORDS = [
  "HORSE",
  "IN",
  "MOTION",
  "1878",
  "GALLOP",
  "24FPS",
  "RIDER",
  "STRIDE",
];
