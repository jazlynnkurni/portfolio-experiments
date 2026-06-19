"use client";

import { motion, type MotionValue } from "framer-motion";

/**
 * Minimal single-stroke lowercase letterforms. Each glyph is one or more open
 * stroke paths in a local 10-wide box. Reference lines: ascender top y=1,
 * x-height top y=5, baseline y=11, descender bottom y=14. The paths are traced
 * by recruited ambient skiers; the carve is revealed at the skier position.
 */
export const GLYPHS: Record<string, string[]> = {
  a: ["M8 6.2 C5.5 4.9 2 5.6 2 8 C2 10.4 5.5 11.2 8 9.8", "M8 5.4 L8 11"],
  b: ["M2 1 L2 11", "M2 6 C5 5 8 6 8 8 C8 10 5 11 2 10"],
  c: ["M8 6 C5.5 4.9 2 5.6 2 8 C2 10.4 5.5 11.2 8 10"],
  d: ["M8 1 L8 11", "M8 6 C5 5 2 6 2 8 C2 10 5 11 8 10"],
  e: ["M2.2 8.3 L8 8.3 C8 6 5.5 4.9 3.6 6 C2 7 2 9.4 3.8 10.6 C5.6 11.6 7.6 11 8.3 9.9"],
  f: ["M7 2.6 C7 1.3 4.6 0.9 4.6 3.6 L4.6 11", "M2.6 5.6 L6.8 5.6"],
  g: ["M8 6 C5 5 2 6 2 8 C2 10 5 11 8 10", "M8 5.3 L8 12.6 C8 14 5 14.4 3.2 13.4"],
  h: ["M2 1 L2 11", "M2 6.6 C4 5.2 8 5 8 7.6 L8 11"],
  i: ["M5 5.2 L5 11", "M5 2.6 L5 3.4"],
  j: ["M6 5.2 L6 12.6 C6 14 3.6 14.2 2.6 13", "M6 2.6 L6 3.4"],
  k: ["M2 1 L2 11", "M7 5.6 L2.6 8.6", "M3.6 7.8 L7 11"],
  l: ["M5 1 L5 10 C5 11 5.6 11.2 6.4 11"],
  m: ["M2 5.2 L2 11", "M2 6.6 C3.5 5.2 5 5.2 5 7.6 L5 11", "M5 6.6 C6.5 5.2 8 5.2 8 7.6 L8 11"],
  n: ["M2 5.2 L2 11", "M2 6.6 C4 5.2 8 5 8 7.6 L8 11"],
  o: ["M2 8 C2 5.8 8 5.8 8 8 C8 10.2 2 10.2 2 8"],
  p: ["M2 5.2 L2 14", "M2 6 C5 5 8 6 8 8 C8 10 5 11 2 10"],
  q: ["M8 5.2 L8 14", "M8 6 C5 5 2 6 2 8 C2 10 5 11 8 10"],
  r: ["M2 5.2 L2 11", "M2 6.6 C3.5 5.3 6 5.1 7.2 6.1"],
  s: ["M7.5 6 C6 4.9 2.6 5.1 2.6 6.8 C2.6 8.1 7 8 7 9.6 C7 11.3 3 11.4 2.2 10.2"],
  t: ["M4.6 2.6 L4.6 10 C4.6 11 5.4 11.2 6.4 10.7", "M2.6 5.6 L7 5.6"],
  u: ["M2 5.2 L2 9.5 C2 11 5 11.4 7 9.8", "M7 5.2 L7 11"],
  v: ["M2 5.2 L5 11 L8 5.2"],
  w: ["M1.5 5.2 L3.5 11 L5 7 L6.5 11 L8.5 5.2"],
  x: ["M2 5.2 L8 11", "M8 5.2 L2 11"],
  y: ["M2 5.2 L5 10.5", "M8 5.2 L4 13.5 C3.3 14 2.6 14 2.2 13.6"],
  z: ["M2.2 5.6 L7.8 5.6 L2.2 11 L7.8 11"],
};

const MARGIN = 12; // viewBox units of clear space each side
const ADVANCE = (100 - 2 * MARGIN) / 6; // fixed slot so a 6-char word fits
const GLYPH_W = 10; // local glyph box width
const BASELINE_Y = 53; // middle band of the square

export const GLYPH_SCALE = (ADVANCE * 0.82) / GLYPH_W; // letter sized to its slot

/**
 * Where letter `i` sits (viewBox units). LEFT-ANCHORED: index 0 always begins
 * at the same fixed origin and the word grows rightward, so already-carved
 * letters never move when a new letter is typed. Six letters fit to the right.
 */
export function letterLayout(i: number) {
  const gx = MARGIN + i * ADVANCE + (ADVANCE - GLYPH_W * GLYPH_SCALE) / 2;
  const gy = BASELINE_Y - 11 * GLYPH_SCALE;
  return { gx, gy };
}

/**
 * One carved sub-stroke: three layers (shadow below, lit snow rim above, dark
 * groove on top) share a reveal `progress` so they carve in with depth. The
 * groove path is exposed via ref so a skier can ride along it.
 */
export function CarvedStroke({
  d,
  progress,
  pathRef,
}: {
  d: string;
  progress: MotionValue<number>;
  pathRef: (el: SVGPathElement | null) => void;
}) {
  const reveal = { pathLength: progress } as const;
  return (
    <>
      <g transform="translate(0 0.5)">
        <motion.path d={d} fill="none" stroke="#3f4757" strokeOpacity={0.18} strokeWidth={1.5} strokeLinecap="butt" strokeLinejoin="round" style={reveal} />
      </g>
      <g transform="translate(0 -0.4)">
        <motion.path d={d} fill="none" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1.15} strokeLinecap="butt" strokeLinejoin="round" style={reveal} />
      </g>
      <motion.path ref={pathRef} d={d} fill="none" stroke="#5e6b80" strokeOpacity={0.85} strokeWidth={0.85} strokeLinecap="butt" strokeLinejoin="round" style={reveal} />
    </>
  );
}
