"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./TrackRecord.module.css";
import { createSheetLayer, MAX_SHEETS } from "./sheet";
import type { Sheet, SheetLayer } from "./sheet";

/**
 * TRACK RECORD
 * ------------
 * A runner going round a track, where every lap she closes is stamped onto the
 * page as a sheet of tissue. The pun is the whole brief: a lap is a circle, a
 * record is a circle, and a track record is the thing you accumulate by going
 * round enough times. So the print is not decoration laid next to the motion,
 * it IS the motion, one disc per lap, and the picture cannot exist until she
 * has done the work.
 *
 * That gives the plate a real argument. The reference print is a stack of
 * translucent circles, which is a beautiful still image with no cause. Here
 * every circle has a timestamp, a split, and a position that depends on where
 * she was standing when she earned it, so the composition assembles itself out
 * of a performance rather than out of a layout decision.
 *
 * THREE THINGS ARE DOING THE WORK
 *
 * 1. The pile is subtractive, solved in a fragment shader, not drawn on the
 *    2D canvas. See sheet.ts. Overlaps go denser because two sheets take light
 *    out twice, which is what makes the crossings read as new colours.
 *
 * 2. The track centre never sits still. It eases toward the pointer, or drifts
 *    on its own when nobody is holding it, so consecutive laps land offset from
 *    each other. That is what builds the cluster instead of a bullseye, and it
 *    is also why her path traces a rosette of overlapping loops, the second
 *    reference image, without anything ever drawing a rosette.
 *
 * 3. The runner is a sentence. There is no figure: what goes round the rim is
 *    the line RUNNING OUT OF TIME, set on the circle, reading in the direction
 *    of travel. A body going round a circle is just a body going round a
 *    circle. A sentence going round one is a sentence you cannot get to the
 *    end of, and this particular sentence is literally true of the thing it is
 *    doing: it is running, on a track, against a split, out of time. Each
 *    letter fades with how far behind the leading edge it sits and the phrase
 *    repeats into that decay, so the line is visibly running out of itself.
 *
 * The pointer only leads. It used to double as a backlight that thinned the
 * sheets under it, which was a nice trick and the wrong one: it painted a soft
 * white bloom that followed the cursor around, and a page of printed paper does
 * not have a light source moving over it. Nothing on this plate glows now.
 *
 * Every closed lap also leaves its split time printed on the page at the point
 * where it closed, so the plate accumulates its own results sheet in the
 * margins as well as in the ladder.
 */

type TrackRecordProps = {
  variant?: "full" | "embed";
  className?: string;
};

type Ink = [number, number, number];

const TAU = Math.PI * 2;

/** hex to a multiply ink. tints stay light so a stack of them can still go dark */
function ink(hex: string): Ink {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type Palette = { key: string; inks: Ink[] };

const PALETTES: Palette[] = [
  {
    key: "vellum",
    inks: ["#e0dbb4", "#f2e3cd", "#d2cadd", "#cfd7dc", "#f0d9cf"].map(ink),
  },
  {
    key: "riso",
    inks: ["#f0c4a2", "#f8e7d8", "#bfd8d3", "#e5b79a", "#f2e2bd"].map(ink),
  },
  {
    key: "carbon",
    inks: ["#d9dcde", "#c9cbce", "#e8e0d7", "#f0c4a2", "#d5d2cb"].map(ink),
  },
];

const INK_DARK = "#1c1a17";
const INK_MARK = "#9a4c19";

/** radius of the track, in plate heights */
const R_BASE = 0.275;
/**
 * What is running. One word per lap, so the sentence is only ever finished by
 * going round again, and the page keeps the parts already run.
 */
const WORDS = ["RUNNING", "AROUND", "IN CIRCLES"];
/** cap height of the ring type, in plate heights */
const TYPE_H = 0.058;
/** seconds per lap, jogging and flat out */
const LAP_EASY = 3.1;
const LAP_HARD = 1.55;
/** sheets kept on the page. one more slot is held back for the one retiring */
const LIVE_SHEETS = Math.min(13, MAX_SHEETS - 1);
/** points kept of her path, which is what draws the rosette */
const MAX_TRAIL = 640;
/** a press shorter than this is a tap, which stamps instead of sprinting */
const TAP_MS = 180;

type Stamp = {
  x: number;
  y: number;
  r: number;
  /** index into the palette, resolved at draw time so ink can be swapped live */
  hue: number;
  /** the word this lap was run under, printed onto the page with the sheet */
  word: string;
  /** bearing its last letter sits at, which is where the lap was closed */
  wordAt: number;
  born: number;
  /** time the sheet started leaving the page, if it has */
  out: number;
};

/** a split time left on the page where its lap was closed */
type Mark = { x: number; y: number; a: number; split: number; born: number };

type Engine = {
  t: number;
  lap: number;
  lapPhase: number;
  lapStart: number;
  effort: number;
  wantEffort: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  drift: number;
  jitter: number;
  /** this lap's pace against her own average. nobody runs identical splits */
  pace: number;
  sheets: Stamp[];
  marks: Mark[];
  trail: number[];
  splits: number[];
  best: number;
  hue: number;
  /** which word the current lap is running under */
  wordIdx: number;
  px: number;
  py: number;
  hoverWant: number;
  hover: number;
  lead: number;
};

type Layout = {
  w: number;
  h: number;
  /** track radius in css px */
  r: number;
  /** cap height of the ring type in css px */
  type: number;
  /** how far the centre may be led before it would run off the plate */
  padX: number;
  padY: number;
  /** how far it wanders when nobody is leading it. a lap has to land mostly
      on top of the last one or the sheets never stack */
  clusterX: number;
  clusterY: number;
};

function makeLayout(w: number, h: number): Layout {
  const r = h * R_BASE;
  const type = h * TYPE_H;
  // type only stands a cap height off the rim, where a figure stood a whole
  // body, so the track can run much wider than it could before
  const rim = r + type * 1.7;
  const padX = Math.max(0, w / 2 - rim * 0.9);
  const padY = Math.max(0, h / 2 - rim * 0.9);
  return {
    w,
    h,
    r,
    type,
    padX,
    padY,
    clusterX: Math.min(padX, r * 0.8),
    clusterY: Math.min(padY, r * 0.5),
  };
}

function makeEngine(w: number, h: number): Engine {
  return {
    t: 0,
    lap: 0,
    lapPhase: 0,
    lapStart: 0,
    effort: 0,
    wantEffort: 0,
    cx: w / 2,
    cy: h / 2,
    tx: w / 2,
    ty: h / 2,
    drift: Math.random() * TAU,
    jitter: 0,
    pace: 1,
    sheets: [],
    marks: [],
    trail: [],
    splits: [],
    best: 0,
    hue: 0,
    wordIdx: 0,
    px: w / 2,
    py: h / 2,
    hoverWant: 0,
    hover: 0,
    lead: 0,
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** exponential ease that is stable whatever the frame rate is */
const toward = (v: number, target: number, rate: number, dt: number) =>
  v + (target - v) * (1 - Math.exp(-rate * dt));

/** her bearing on the track. she starts at the top and runs clockwise */
const bearing = (phase: number) => -Math.PI / 2 + TAU * phase;

/**
 * Where a sheet wears its word: facing out of the pile.
 *
 * Every lap closes at the same finish line, so hanging each word off that
 * bearing stacked all of them on one arc and they read as one tangle. Facing
 * them out of the cluster instead fans them around its edge, which is both
 * legible and true, because the direction a sheet sits from the middle is the
 * direction the track had drifted while that lap was being run.
 */
function wordBearing(eng: Engine, L: Layout): number {
  const dx = eng.cx - L.w / 2;
  const dy = eng.cy - L.h / 2;
  if (Math.hypot(dx, dy) > L.r * 0.12) return Math.atan2(dy, dx);
  // dead centre has no outward direction, so step by the golden angle, which
  // never lands two consecutive laps anywhere near each other
  return eng.lap * 2.39996;
}

// ---------------------------------------------------------------------------
// simulation
// ---------------------------------------------------------------------------

/**
 * One step of the run. Pure enough to be called in a tight loop with no
 * rendering, which is how the reduced motion build fills a page of laps
 * instantly instead of making someone watch it happen.
 */
function step(eng: Engine, dt: number, L: Layout, pointerHeld: boolean) {
  eng.t += dt;
  eng.effort = toward(eng.effort, eng.wantEffort, 3.2, dt);
  eng.hover = toward(eng.hover, eng.hoverWant, 6, dt);

  // where the track wants to be. under the pointer if there is one, otherwise
  // wandering on a slow lissajous so an untouched plate still composes itself
  if (pointerHeld) {
    eng.tx = clamp(eng.px, L.w / 2 - L.padX, L.w / 2 + L.padX);
    eng.ty = clamp(eng.py, L.h / 2 - L.padY, L.h / 2 + L.padY);
  } else {
    eng.drift += dt * 0.21;
    eng.tx = L.w / 2 + Math.cos(eng.drift * 1.0) * L.clusterX;
    eng.ty = L.h / 2 + Math.sin(eng.drift * 1.37 + 0.6) * L.clusterY;
  }
  eng.cx = toward(eng.cx, eng.tx, 0.62, dt);
  eng.cy = toward(eng.cy, eng.ty, 0.62, dt);

  const lapTime = (LAP_EASY + (LAP_HARD - LAP_EASY) * eng.effort) * eng.pace;
  const radius = L.r * (1 + eng.effort * 0.09 + eng.jitter);

  eng.lapPhase += dt / lapTime;

  const theta = bearing(eng.lapPhase);
  eng.lead = theta;
  const fx = eng.cx + Math.cos(theta) * radius;
  const fy = eng.cy + Math.sin(theta) * radius;
  eng.trail.push(fx, fy);
  if (eng.trail.length > MAX_TRAIL * 2) eng.trail.splice(0, 2);

  if (eng.lapPhase >= 1) {
    eng.lapPhase -= 1;
    const split = eng.t - eng.lapStart;
    eng.lapStart = eng.t;
    eng.lap += 1;
    eng.splits.push(split);
    if (eng.splits.length > 6) eng.splits.shift();
    if (eng.best === 0 || split < eng.best) eng.best = split;
    stamp(eng, radius, fx, fy, theta, split, wordBearing(eng, L));
    // every lap is run at a slightly different width and a slightly different
    // pace, so the pile gets the size variation a hand cut stack has and the
    // ladder gets splits worth comparing
    eng.jitter = (Math.random() - 0.5) * 0.11;
    eng.pace = 1 + (Math.random() - 0.5) * 0.13;
  }

  // retire whatever has been on the page longest
  for (let i = eng.sheets.length - 1; i >= 0; i--) {
    const s = eng.sheets[i];
    if (s.out > 0 && eng.t - s.out > 0.7) eng.sheets.splice(i, 1);
  }
  for (let i = eng.marks.length - 1; i >= 0; i--) {
    if (eng.t - eng.marks[i].born > 26) eng.marks.splice(i, 1);
  }
}

/** lay a sheet for the lap just closed, and leave its split on the page */
function stamp(
  eng: Engine,
  radius: number,
  fx: number,
  fy: number,
  theta: number,
  split: number,
  wordAt: number,
) {
  eng.sheets.push({
    x: eng.cx,
    y: eng.cy,
    r: radius,
    hue: eng.hue,
    word: WORDS[eng.wordIdx % WORDS.length],
    wordAt,
    born: eng.t,
    out: 0,
  });
  eng.hue += 1;
  // the next lap runs under the next word, so the line only completes itself
  // by going round again
  eng.wordIdx = (eng.wordIdx + 1) % WORDS.length;
  eng.marks.push({ x: fx, y: fy, a: theta, split, born: eng.t });
  if (eng.marks.length > 6) eng.marks.shift();

  let live = 0;
  for (const s of eng.sheets) if (s.out === 0) live++;
  if (live > LIVE_SHEETS) {
    for (const s of eng.sheets) {
      if (s.out === 0) {
        s.out = eng.t;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// the plate
// ---------------------------------------------------------------------------

/** letterspaced small caps, drawn a glyph at a time so tracking is exact */
function spaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  track: number,
) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + track;
  }
  return cursor - x - track;
}

/**
 * Set one line of type around the rim of a circle, reading in the direction of
 * travel, with its last letter landing on `head`.
 *
 * This is the runner. There is no figure, and losing the figure is what makes
 * the plate say something: a body going round a circle is just a body going
 * round a circle, but a line of type going round one is a line you cannot get
 * to the end of. It runs RUNNING, then AROUND, then IN CIRCLES, one word per
 * lap, so the sentence only ever completes itself by going round again.
 *
 * The same routine sets the live ring and the words already imprinted on the
 * page, which is the point: what you are reading on the track now is exactly
 * what the page will keep when the lap closes. `decay` is the only difference.
 * The live ring fades backward from its leading letter, because that tail is
 * the motion. A printed word does not fade along its length, because ink does
 * not.
 */
function setOnRim(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  head: number,
  size: number,
  face: string,
  text: string,
  alpha: number,
  decay: number,
) {
  ctx.save();
  ctx.font = `600 ${size}px ${face}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK_DARK;

  const track = size * 0.13;
  // the baseline stands clear of the sheet edge, so the type sits on the rim
  // rather than fighting the tint change across it
  const rText = radius + size * 0.55;
  const circ = TAU * rText;

  const chars = [...text];
  // measured every frame, so the line tightens and opens with the radius
  const adv = chars.map((c) => ctx.measureText(c).width + track);

  let arc = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const mid = arc + adv[i] / 2;
    const a = head - mid / rText;
    const fade = decay > 0 ? Math.exp((-mid / circ) * decay) : 1;
    const ink = alpha * fade;
    if (ink > 0.02 && chars[i] !== " ") {
      ctx.globalAlpha = ink;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rText, cy + Math.sin(a) * rText);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();
    }
    arc += adv[i];
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawPlate(
  ctx: CanvasRenderingContext2D,
  eng: Engine,
  L: Layout,
  face: string,
) {
  const { w, h } = L;
  const s = h / 800;

  ctx.fillStyle = "#fdfcfa";
  ctx.fillRect(0, 0, w, h);

  const radius = L.r * (1 + eng.effort * 0.09 + eng.jitter);
  const theta = eng.lead;

  // --- printed chrome -------------------------------------------------------
  ctx.save();
  ctx.strokeStyle = "rgba(28,26,23,0.16)";
  ctx.lineWidth = 1;
  const inset = 26 * s;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

  // registration crosses, one per corner
  ctx.strokeStyle = "rgba(154,76,25,0.45)";
  const cross = 7 * s;
  for (const [mx, my] of [
    [inset, inset],
    [w - inset, inset],
    [inset, h - inset],
    [w - inset, h - inset],
  ]) {
    ctx.beginPath();
    ctx.moveTo(mx - cross, my);
    ctx.lineTo(mx + cross, my);
    ctx.moveTo(mx, my - cross);
    ctx.lineTo(mx, my + cross);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, cross * 0.55, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  // --- type -----------------------------------------------------------------
  // one margin inside the frame rule and one leading step, so every corner of
  // the plate is set off the same two numbers instead of off eyeballed offsets
  const pad = inset + 22 * s;
  const lead = 19 * s;
  const top = pad + 12 * s;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK_DARK;
  ctx.font = `700 ${13 * s}px ${face}`;
  spaced(ctx, "TRACK RECORD", pad, top, 2.2 * s);
  ctx.fillStyle = "rgba(28,26,23,0.5)";
  ctx.font = `500 ${11 * s}px ${face}`;
  spaced(ctx, "ONE LAP, ONE SHEET", pad, top + lead, 1.4 * s);

  // lap counter, top right, hung off the same top line
  ctx.textAlign = "right";
  ctx.fillStyle = INK_MARK;
  ctx.font = `500 ${11 * s}px ${face}`;
  ctx.fillText("LAP", w - pad, top);
  ctx.fillStyle = INK_DARK;
  ctx.font = `300 ${46 * s}px ${face}`;
  ctx.fillText(String(eng.lap).padStart(2, "0"), w - pad, top + 47 * s);

  // the split ladder, bottom left. the record, as a record sheet
  ctx.textAlign = "left";
  ctx.font = `500 ${10.5 * s}px ${face}`;
  const rows = eng.splits.slice(-5);
  const base = h - pad - (rows.length - 1) * lead;
  rows.forEach((split, i) => {
    const y = base + i * lead;
    const n = eng.lap - rows.length + i + 1;
    const hot = eng.best > 0 && split <= eng.best + 0.004;
    ctx.fillStyle = hot ? INK_MARK : "rgba(28,26,23,0.55)";
    ctx.fillText(String(n).padStart(2, "0"), pad, y);
    ctx.fillText(split.toFixed(2), pad + 26 * s, y);
    // a bar the length of the split, so the sheet reads as data at a glance
    ctx.globalAlpha = 0.35;
    ctx.fillRect(
      pad + 70 * s,
      y - 4 * s,
      clamp(split / LAP_EASY, 0.05, 1.15) * 78 * s,
      3 * s,
    );
    ctx.globalAlpha = 1;
  });

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(28,26,23,0.55)";
  ctx.font = `500 ${10.5 * s}px ${face}`;
  ctx.fillText(
    eng.best > 0 ? `BEST ${eng.best.toFixed(2)}` : "BEST  --",
    w - pad,
    h - pad - lead,
  );
  let live = 0;
  for (const sh of eng.sheets) if (sh.out === 0) live++;
  ctx.fillText(`SHEETS ${String(live).padStart(2, "0")}`, w - pad, h - pad);
  ctx.restore();

  // --- her path, which loops itself into a rosette --------------------------
  const tr = eng.trail;
  if (tr.length > 6) {
    ctx.save();
    ctx.strokeStyle = "rgba(28,26,23,0.5)";
    ctx.lineWidth = 1 * s;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.moveTo(tr[0], tr[1]);
    for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
    ctx.stroke();
    // the freshest stretch a shade stronger, so the loop has a head and a tail
    ctx.globalAlpha = 0.4;
    const from = Math.max(0, tr.length - 220);
    ctx.beginPath();
    ctx.moveTo(tr[from], tr[from + 1]);
    for (let i = from + 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
    ctx.stroke();
    ctx.restore();
  }

  // --- the star at the centre of the lap ------------------------------------
  // soft chalk beams off a pinpoint, kept mostly inside the sheet so they do
  // not print as hard rules on bare paper. the one aimed at her runs all the
  // way out to her feet, which is the only line tying her to what she is
  // drawing
  ctx.save();
  ctx.lineCap = "butt";
  // a four armed cross, fixed to the page. any more arms and it stops being a
  // pinhole star and starts being a pie chart
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const len = radius * 1.05;
    const g = ctx.createLinearGradient(
      eng.cx,
      eng.cy,
      eng.cx + Math.cos(a) * len,
      eng.cy + Math.sin(a) * len,
    );
    g.addColorStop(0, "rgba(28,26,23,0.11)");
    g.addColorStop(0.45, "rgba(28,26,23,0.03)");
    g.addColorStop(1, "rgba(28,26,23,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 9 * s;
    ctx.beginPath();
    ctx.moveTo(eng.cx, eng.cy);
    ctx.lineTo(eng.cx + Math.cos(a) * len, eng.cy + Math.sin(a) * len);
    ctx.stroke();
  }
  const reach = radius + L.type * 0.9;
  const beam = ctx.createLinearGradient(
    eng.cx,
    eng.cy,
    eng.cx + Math.cos(theta) * reach,
    eng.cy + Math.sin(theta) * reach,
  );
  beam.addColorStop(0, "rgba(28,26,23,0.22)");
  beam.addColorStop(0.8, "rgba(28,26,23,0.05)");
  beam.addColorStop(1, "rgba(28,26,23,0)");
  ctx.strokeStyle = beam;
  ctx.lineWidth = 3.4 * s;
  ctx.beginPath();
  ctx.moveTo(eng.cx, eng.cy);
  ctx.lineTo(eng.cx + Math.cos(theta) * reach, eng.cy + Math.sin(theta) * reach);
  ctx.stroke();
  // the pinpoint the star radiates from
  ctx.fillStyle = "rgba(28,26,23,0.6)";
  ctx.beginPath();
  ctx.arc(eng.cx, eng.cy, 1.8 * s, 0, TAU);
  ctx.fill();
  ctx.restore();

  // --- the track ------------------------------------------------------------
  ctx.save();
  ctx.strokeStyle = "rgba(28,26,23,0.22)";
  ctx.lineWidth = 1 * s;
  ctx.setLineDash([3 * s, 5 * s]);
  ctx.beginPath();
  ctx.arc(eng.cx, eng.cy, radius, 0, TAU);
  ctx.stroke();
  // the lap so far, filling in behind her
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(154,76,25,0.5)";
  ctx.lineWidth = 1.6 * s;
  ctx.beginPath();
  ctx.arc(eng.cx, eng.cy, radius, bearing(0), theta);
  ctx.stroke();
  // start and finish, at the top of every circle
  ctx.strokeStyle = "rgba(28,26,23,0.4)";
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.moveTo(eng.cx, eng.cy - radius + 6 * s);
  ctx.lineTo(eng.cx, eng.cy - radius - 6 * s);
  ctx.stroke();
  ctx.restore();

  // --- the words already earned, printed onto the page --------------------
  // drawn on the plate, not in the shader, so every sheet laid down after them
  // tints them. that is what makes them read as ink the paper took rather than
  // as a caption floating over the pile
  for (const sh of eng.sheets) {
    const inFade = clamp((eng.t - sh.born) / 0.34, 0, 1);
    const outFade = sh.out > 0 ? clamp(1 - (eng.t - sh.out) / 0.7, 0, 1) : 1;
    setOnRim(
      ctx,
      sh.x,
      sh.y,
      sh.r,
      sh.wordAt,
      L.type * 0.78,
      face,
      sh.word,
      0.46 * inFade * outFade,
      0,
    );
  }

  // --- the splits, left where their laps were closed ----------------------
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK_DARK;
  ctx.font = `500 ${L.type * 0.32}px ${face}`;
  for (const m of eng.marks) {
    const age = clamp((eng.t - m.born) / 22, 0, 1);
    ctx.globalAlpha = 0.3 * (1 - age * 0.72);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.a + Math.PI / 2);
    ctx.fillText(m.split.toFixed(2), 0, -L.type * 0.26);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // --- this lap's word, running --------------------------------------------
  setOnRim(
    ctx,
    eng.cx,
    eng.cy,
    radius,
    theta,
    L.type,
    face,
    WORDS[eng.wordIdx % WORDS.length],
    0.96,
    2.6,
  );
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

export default function TrackRecord({
  variant = "full",
  className,
}: TrackRecordProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const plateRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef(0);
  const clearRef = useRef(false);

  const [printing, setPrinting] = useState(false);
  const [palette, setPalette] = useState(0);
  const [hud, setHud] = useState({ lap: 0, split: 0, best: 0, sheets: 0 });

  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  const cycleInk = useCallback(() => {
    setPalette((p) => (p + 1) % PALETTES.length);
  }, []);

  const clearSheet = useCallback(() => {
    clearRef.current = true;
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const plate = plateRef.current;
    const gl = glRef.current;
    if (!stage || !plate || !gl) return;

    const ctx = plate.getContext("2d", { alpha: false });
    if (!ctx) return;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let layer: SheetLayer | null = null;
    let L = makeLayout(stage.clientWidth || 640, stage.clientHeight || 400);
    let eng = makeEngine(L.w, L.h);
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let hudAt = 0;
    // next/font hands out a generated family name, and canvas cannot resolve a
    // css variable, so take whatever actually applies to the plate element
    let face = "ui-sans-serif, system-ui, sans-serif";
    let held = false;
    let heldAt = 0;
    let disposed = false;

    const sheets: Sheet[] = [];

    // the page should arrive mid session rather than blank, so run a few laps
    // before the first frame. a plate nobody is going to watch fill up gets a
    // full stack, because it is the only one it will ever get
    const headStart = reduced ? 13 : 9;
    while (eng.lap < headStart) step(eng, 1 / 60, L, false);
    eng.lapStart = eng.t;

    const layout = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w === 0 || h === 0) return;
      // the sheet loop is the expensive part, so cap the pixel count
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (plate.width !== pw || plate.height !== ph) {
        plate.width = pw;
        plate.height = ph;
      }
      if (layer) layer.resize(pw, ph);
      else {
        gl.width = pw;
        gl.height = ph;
      }
      face = getComputedStyle(plate).fontFamily || face;
      const next = makeLayout(w, h);
      // keep the run where it was, in the new frame of reference
      if (L.w > 0 && L.h > 0 && (next.w !== L.w || next.h !== L.h)) {
        const kx = next.w / L.w;
        const ky = next.h / L.h;
        eng.cx *= kx;
        eng.cy *= ky;
        eng.tx *= kx;
        eng.ty *= ky;
        for (const sh of eng.sheets) {
          sh.x *= kx;
          sh.y *= ky;
          sh.r *= ky;
        }
        for (const m of eng.marks) {
          m.x *= kx;
          m.y *= ky;
        }
        for (let i = 0; i < eng.trail.length; i += 2) {
          eng.trail[i] *= kx;
          eng.trail[i + 1] *= ky;
        }
      }
      L = next;
    };

    layout();
    layer = createSheetLayer(gl, plate);
    setPrinting(layer !== null);

    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (last === 0) last = now;
      const dt = reduced ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;

      if (clearRef.current) {
        clearRef.current = false;
        const prev = eng;
        eng = makeEngine(L.w, L.h);
        // the best stands, and so does whatever the hand is currently doing
        eng.best = prev.best;
        eng.px = prev.px;
        eng.py = prev.py;
        eng.hover = prev.hover;
        eng.hoverWant = prev.hoverWant;
        eng.wantEffort = prev.wantEffort;
      }

      step(eng, dt, L, eng.hover > 0.5);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPlate(ctx, eng, L, face);

      if (layer) {
        const inks = PALETTES[paletteRef.current].inks;
        sheets.length = 0;
        for (const sh of eng.sheets) {
          const inFade = clamp((eng.t - sh.born) / 0.34, 0, 1);
          const outFade = sh.out > 0 ? clamp(1 - (eng.t - sh.out) / 0.7, 0, 1) : 1;
          sheets.push({
            x: sh.x / L.w,
            y: sh.y / L.h,
            r: (sh.r * (1.06 - 0.06 * inFade)) / L.h,
            fade: inFade * outFade,
            ink: inks[sh.hue % inks.length],
          });
        }
        layer.render({ time: eng.t, sheets, grain: 1 });
      }

      if (now - hudAt > 120) {
        hudAt = now;
        let live = 0;
        for (const sh of eng.sheets) if (sh.out === 0) live++;
        setHud({
          lap: eng.lap,
          split: eng.t - eng.lapStart,
          best: eng.best,
          sheets: live,
        });
      }
    };

    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(() => layout());
    ro.observe(stage);

    const point = (e: PointerEvent) => {
      const box = stage.getBoundingClientRect();
      eng.px = e.clientX - box.left;
      eng.py = e.clientY - box.top;
    };

    const onMove = (e: PointerEvent) => {
      point(e);
      eng.hoverWant = 1;
    };
    const onLeave = () => {
      eng.hoverWant = 0;
      eng.wantEffort = 0;
      held = false;
    };
    const onDown = (e: PointerEvent) => {
      point(e);
      eng.hoverWant = 1;
      held = true;
      heldAt = performance.now();
      eng.wantEffort = 1;
      stage.focus({ preventScroll: true });
    };
    const onUp = () => {
      if (!held) return;
      held = false;
      eng.wantEffort = 0;
      // a tap is a photo finish: take the sheet now, do not wait for the lap
      if (performance.now() - heldAt < TAP_MS) {
        const radius = L.r * (1 + eng.effort * 0.09 + eng.jitter);
        const th = eng.lead;
        // a photo finish records the split as it stands, mid lap
        stamp(
          eng,
          radius,
          eng.cx + Math.cos(th) * radius,
          eng.cy + Math.sin(th) * radius,
          th,
          eng.t - eng.lapStart,
          wordBearing(eng, L),
        );
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        eng.wantEffort = 1;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") eng.wantEffort = 0;
    };

    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerenter", onMove);
    stage.addEventListener("pointerleave", onLeave);
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("keydown", onKeyDown);
    stage.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerup", onUp);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerenter", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("keydown", onKeyDown);
      stage.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onUp);
      layer?.dispose();
    };
  }, []);

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-variant={variant}
    >
      <div
        ref={stageRef}
        className={styles.stage}
        tabIndex={0}
        role="img"
        aria-label="The phrase RUNNING OUT OF TIME runs around a circular track, fading behind itself. Every lap it closes is printed as a translucent paper disc, and the discs pile up into one image."
      >
        <canvas ref={plateRef} className={styles.plate} data-under={printing} />
        <canvas ref={glRef} className={styles.gl} data-on={printing} />
      </div>

      <div className={styles.hud}>
        <div className={styles.readout}>
          <span>
            lap <b>{String(hud.lap).padStart(2, "0")}</b>
          </span>
          <span>
            split <b>{hud.split.toFixed(2)}</b>
          </span>
          <span>
            best <b>{hud.best > 0 ? hud.best.toFixed(2) : "--"}</b>
          </span>
          <span>
            sheets <b>{String(hud.sheets).padStart(2, "0")}</b>
          </span>
        </div>
        <div className={styles.controls}>
          <button type="button" className={styles.btn} onClick={cycleInk}>
            ink / {PALETTES[palette].key}
          </button>
          <button type="button" className={styles.btn} onClick={clearSheet}>
            fresh page
          </button>
        </div>
      </div>

      <div className={styles.caption}>
        <span className={styles.title}>Track record</span>
      </div>
    </div>
  );
}
