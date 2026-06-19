"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  animate,
  motion,
  motionValue,
  useAnimationControls,
  useAnimationFrame,
  useMotionValue,
  type Easing,
  type MotionValue,
  type TargetAndTransition,
} from "framer-motion";
import SnowShader from "./SnowShader";
import { CarvedStroke, GLYPHS, GLYPH_SCALE, letterLayout } from "./Letters";
import styles from "./SkierSlope.module.css";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A stroke handed to a recruited skier: the groove path element, its letter
// transform (so local points map to px), and the reveal motion value to drive.
type CarveStroke = {
  el: SVGPathElement;
  gx: number;
  gy: number;
  scale: number;
  prog: MotionValue<number>;
};

// Imperative handle the carve coordinator uses to recruit a skier.
type SkierHandle = {
  getPos: () => { x: number; y: number };
  isAvailable: () => boolean;
  carve: (
    strokes: CarveStroke[],
    size: number,
    shouldCancel?: () => boolean
  ) => Promise<void>;
};

const CARVE_PX_SPEED = 80; // px/sec a recruited skier traces a stroke

type SkierSlopeProps = {
  variant?: "full" | "embed";
};

type JacketColor = "orange" | "burgundy" | "green" | "blue" | "yellow";

/** Each jacket: gradient id (light to dark) plus a solid shade for the back panel. */
const JACKETS: Record<JacketColor, { grad: string; shade: string }> = {
  orange: { grad: "jacket-orange", shade: "#9A4C19" },
  burgundy: { grad: "jacket-burgundy", shade: "#561C23" },
  green: { grad: "jacket-green", shade: "#3E4F3A" },
  blue: { grad: "jacket-blue", shade: "#2E4150" },
  yellow: { grad: "jacket-yellow", shade: "#8E6C18" },
};

type Rider = {
  top: number; // start phase down the slope
  left: number; // lane: a distinct parallel diagonal, kept apart so nobody collides
  w: number;
  rot: number;
  flip: boolean;
  color: JacketColor;
  speed: number; // multiplier on the base slide speed, so each drops differently
  // optional carve: a lateral weave layered into base travel. amp in px, freq in
  // weave-cycles per descent, phase to desync, lean in degrees of edge into turns.
  carve?: { amp: number; freq: number; phase: number; lean: number };
};

/**
 * 8 riders, organically scattered (uneven heights, loose clusters, open gaps)
 * so the snow texture breathes. Every rider is tappable and reacts on its own.
 * `left` is each rider's lane; `top` is the start phase down the slope.
 */
// lanes stay >=10 apart (well wider than a figure) so none overlap on descent;
// the scatter comes from varied phases (top) rather than even lane spacing.
// speed is a clear fast/moderate/slow mix so they read like real skiers, not a
// formation; the interactive orange (index 0) stays moderate so it is easy to tap.
// carvers (index 3,4,5,6) all sit between straight lanes, so two weaves can never
// converge; amplitudes are kept within the lane gaps (verified by the overlap test).
const RIDERS: Rider[] = [
  { top: 10, left: 50, w: 28, rot: -2, flip: false, color: "orange", speed: 1.0 },
  { top: 18, left: 74, w: 26, rot: 3, flip: true, color: "blue", speed: 1.6 },
  { top: 26, left: 22, w: 28, rot: -4, flip: false, color: "burgundy", speed: 0.65 },
  { top: 46, left: 62, w: 28, rot: 2, flip: false, color: "green", speed: 1.1, carve: { amp: 20, freq: 1.2, phase: 0.8, lean: 10 } }, // wide, slow
  { top: 40, left: 34, w: 28, rot: -3, flip: false, color: "yellow", speed: 1.45, carve: { amp: 16, freq: 3.0, phase: 1.7, lean: 12 } }, // tight, quick
  { top: 56, left: 86, w: 26, rot: 3, flip: true, color: "orange", speed: 0.8, carve: { amp: 12, freq: 3.5, phase: 2.4, lean: 11 } }, // tight, quick
  { top: 72, left: 10, w: 30, rot: -2, flip: true, color: "blue", speed: 1.25, carve: { amp: 18, freq: 1.5, phase: 0.0, lean: 9 } }, // wide, slow
  { top: 84, left: 96, w: 30, rot: 2, flip: false, color: "green", speed: 0.9 },
];

/**
 * SkierSlope: self-contained slope experiment.
 * Step 0: a field of static placeholder riders, no motion yet.
 * Styling is scoped via CSS module so it ports cleanly into portfolio-26.
 */
export default function SkierSlope({ variant = "full" }: SkierSlopeProps) {
  const slopeRef = useRef<HTMLElement>(null);
  // square slope side length in px; the travel maths work in fractions of it
  const [size, setSize] = useState(0);
  const sizeRef = useRef(0);
  sizeRef.current = size;
  const [reducedMotion, setReducedMotion] = useState(false);
  // typed input: single lowercase word, letters only, hard cap 6
  const [typedWord, setTypedWord] = useState("");
  const wordRef = useRef("");
  wordRef.current = typedWord;

  // ---- carve coordination: recruit ambient skiers to trace each letter ----
  // Single source of truth is typedWord. carveState[i] mirrors typedWord[i]
  // exactly (same char) and tracks its reveal progress + status. The render
  // draws GLYPHS[typedWord[i]], so a wrong/stale glyph can never appear.
  const skierHandles = useRef<(SkierHandle | null)[]>([]);
  const carveState = useRef<
    { ch: string; status: "pending" | "carving" | "done"; progs: MotionValue<number>[] }[]
  >([]);
  const elRefs = useRef<Map<string, SVGPathElement | null>>(new Map());
  const cancelRef = useRef<{ index: number; cancelled: boolean } | null>(null);
  const processingRef = useRef(false);
  const lastSkierRef = useRef(-1);
  const [, setCarveVersion] = useState(0);
  const bump = () => setCarveVersion((v) => v + 1);

  // letters being healed over (backspaced): their grooves fill back in and fade
  const healingRef = useRef<
    {
      id: number;
      ch: string;
      gx: number;
      gy: number;
      progs: MotionValue<number>[];
      opacity: MotionValue<number>;
    }[]
  >([]);
  const healId = useRef(0);

  async function startHeal(entry: (typeof healingRef.current)[number]) {
    // groove retracts (pathLength back to 0) and lightens, like powder filling it
    await Promise.all([
      ...entry.progs.map((p) => animate(p, 0, { duration: 0.5, ease: "easeInOut" }).finished),
      animate(entry.opacity, 0, { duration: 0.55, ease: "easeOut" }).finished,
    ]);
    healingRef.current = healingRef.current.filter((h) => h.id !== entry.id);
    bump();
  }

  function pickSkier(target: { x: number; y: number }) {
    let best = -1;
    let bestD = Infinity;
    const consider = (allowLast: boolean) => {
      skierHandles.current.forEach((h, i) => {
        if (!h || !h.isAvailable()) return;
        if (!allowLast && i === lastSkierRef.current) return;
        const p = h.getPos();
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
    };
    consider(false); // prefer a different skier than last time
    if (best < 0) consider(true);
    return best;
  }

  // carve exactly letter i; returns false to retry (no skier free yet)
  async function carveOne(i: number): Promise<boolean> {
    const want = wordRef.current[i];
    const data = carveState.current[i];
    if (!data || data.ch !== want) return true; // reconciled away: drop
    const strokeCount = (GLYPHS[want] ?? []).length;
    // wait for this letter's stroke paths to mount
    for (let t = 0; t < 50; t++) {
      let ready = strokeCount > 0;
      for (let k = 0; k < strokeCount; k++) if (!elRefs.current.get(`${i}-${k}`)) ready = false;
      if (ready) break;
      await sleep(40);
    }
    const s = sizeRef.current;
    if (!s) return true;
    const { gx, gy } = letterLayout(i);
    const strokes: CarveStroke[] = [];
    for (let k = 0; k < strokeCount; k++) {
      const el = elRefs.current.get(`${i}-${k}`);
      if (el) strokes.push({ el, gx, gy, scale: GLYPH_SCALE, prog: data.progs[k] });
    }
    if (!strokes.length) return true;
    const lp = strokes[0].el.getPointAtLength(0);
    const startPx = {
      x: ((gx + lp.x * GLYPH_SCALE) * s) / 100,
      y: ((gy + lp.y * GLYPH_SCALE) * s) / 100,
    };
    const idx = pickSkier(startPx);
    if (idx < 0) return false; // nobody free: retry shortly
    lastSkierRef.current = idx;
    const token = { index: i, cancelled: false };
    cancelRef.current = token;
    await skierHandles.current[idx]?.carve(strokes, s, () => token.cancelled);
    cancelRef.current = null;
    return true;
  }

  // strict, one-at-a-time, in typed order: always take the lowest pending letter
  async function pump() {
    if (processingRef.current) return;
    processingRef.current = true;
    while (true) {
      const st = carveState.current;
      const i = st.findIndex((l) => l && l.status === "pending");
      if (i < 0) break;
      st[i].status = "carving";
      bump();
      const ok = await carveOne(i);
      const cur = carveState.current[i];
      if (cur && cur.ch === wordRef.current[i]) {
        if (ok) cur.status = "done";
        else cur.status = "pending"; // no skier was free: try again next loop
        bump();
      }
      if (!ok) await sleep(250);
    }
    processingRef.current = false;
  }

  // reconcile carveState to EXACTLY match typedWord (order + chars), every change
  useEffect(() => {
    const st = carveState.current;
    const word = typedWord;
    for (let i = 0; i < word.length; i++) {
      if (!st[i] || st[i].ch !== word[i]) {
        const count = (GLYPHS[word[i]] ?? []).length;
        st[i] = {
          ch: word[i],
          status: reducedMotion ? "done" : "pending",
          progs: Array.from({ length: count }, () => motionValue(reducedMotion ? 1 : 0)),
        };
        for (let k = 0; k < count; k++) elRefs.current.delete(`${i}-${k}`);
      }
    }
    if (st.length > word.length) {
      // backspace: cancel an in-progress carve of a removed letter, then heal
      if (cancelRef.current && cancelRef.current.index >= word.length) {
        cancelRef.current.cancelled = true;
      }
      for (let i = word.length; i < st.length; i++) {
        const removed = st[i];
        const count = (GLYPHS[removed?.ch ?? ""] ?? []).length;
        for (let k = 0; k < count; k++) elRefs.current.delete(`${i}-${k}`);
        // hand the groove to the heal layer so the snow fills back over it
        if (removed && !reducedMotion) {
          const { gx, gy } = letterLayout(i);
          const entry = {
            id: healId.current++,
            ch: removed.ch,
            gx,
            gy,
            progs: removed.progs,
            opacity: motionValue(1),
          };
          healingRef.current.push(entry);
          startHeal(entry);
        }
      }
      st.length = word.length;
    }
    bump();
    if (!reducedMotion) pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedWord, reducedMotion]);

  function handleType(e: ChangeEvent<HTMLInputElement>) {
    setTypedWord(e.target.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6));
  }

  useEffect(() => {
    const el = slopeRef.current;
    if (!el) return;
    const measure = () => setSize(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className={styles.shell}>
      <section
        ref={slopeRef}
        className={`${styles.slope} ${variant === "embed" ? styles.embed : styles.full}`}
        aria-label="Skier slope"
      >
        {/* procedural GLSL snow surface, clipped to the rounded square */}
        <SnowShader className={styles.snow} />

      {/* shared gradient defs so the figures do not redeclare ids */}
      <SkierDefs />

      {/* carved letters, revealed by recruited skiers, under the field.
          glyphs come straight from typedWord so the carve always matches it */}
      <svg className={styles.letters} viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          {/* roughen + feather so grooves read as scratched-into-snow, not vector */}
          <filter id="carve-rough" x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence type="fractalNoise" baseFrequency="0.11 0.14" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.5" xChannelSelector="R" yChannelSelector="G" result="disp" />
            <feGaussianBlur in="disp" stdDeviation="0.16" />
          </filter>
        </defs>
        <g filter="url(#carve-rough)">
        {typedWord.split("").map((ch, i) => {
          const data = carveState.current[i];
          if (!data || data.ch !== ch) return null; // wait until reconciled in sync
          const { gx, gy } = letterLayout(i);
          return (
            <g
              key={`${i}-${ch}`}
              // pending letters keep their paths mounted (for sampling) but stay
              // invisible, so no phantom dot/marker shows before the skier traces
              style={{ opacity: data.status === "pending" ? 0 : 1 }}
              transform={`translate(${gx.toFixed(2)} ${gy.toFixed(2)}) scale(${GLYPH_SCALE.toFixed(3)})`}
            >
              {(GLYPHS[ch] ?? []).map((d, k) => (
                <CarvedStroke
                  key={k}
                  d={d}
                  progress={data.progs[k]}
                  pathRef={(el) => {
                    elRefs.current.set(`${i}-${k}`, el);
                  }}
                />
              ))}
            </g>
          );
        })}
        {/* letters healing over after backspace: groove retracts and fades */}
        {healingRef.current.map((h) => (
          <motion.g
            key={`heal-${h.id}`}
            style={{ opacity: h.opacity }}
            transform={`translate(${h.gx.toFixed(2)} ${h.gy.toFixed(2)}) scale(${GLYPH_SCALE.toFixed(3)})`}
          >
            {(GLYPHS[h.ch] ?? []).map((d, k) => (
              <CarvedStroke key={k} d={d} progress={h.progs[k]} pathRef={() => {}} />
            ))}
          </motion.g>
        ))}
        </g>
      </svg>

      {/* every skier slides, reacts, and sprays on its own; wait for the size.
          refs let the coordinator recruit one to carve a letter */}
      {size > 0 &&
        RIDERS.map((r, i) => (
          <Skier
            key={i}
            ref={(h) => {
              skierHandles.current[i] = h;
            }}
            rider={r}
            size={size}
            spray
            reducedMotion={reducedMotion}
          />
        ))}
      </section>

      <input
        className={styles.glassInput}
        value={typedWord}
        onChange={handleType}
        placeholder="type something"
        aria-label="Type a word"
        spellCheck={false}
        autoComplete="off"
        maxLength={6}
      />
    </div>
  );
}

/**
 * Self-contained jump-flip: a full 360 spin with a weighted pop up and
 * settle, returned as a Framer Motion target so it can be reused per skier.
 * Transform-only (rotate + y), so it never affects layout.
 * Timing: quick takeoff, floaty mid-rotation, soft landing.
 */
function flipAnimation(pop: number) {
  return {
    rotate: 360,
    y: [0, -pop, -pop * 0.85, 0],
    transition: {
      rotate: {
        duration: 0.8,
        ease: [0.16, 0.84, 0.3, 1] as [number, number, number, number],
      },
      y: {
        duration: 0.8,
        times: [0, 0.32, 0.6, 1],
        ease: [0.3, 0, 0.35, 1] as [number, number, number, number],
      },
    },
  };
}

// ---- Tap reactions -------------------------------------------------------
// Each reaction is a self-contained plan layered on top of the ongoing descent.
// `figure` is the transform target for the figure element; `speed` optionally
// modulates descent speed (only the fall loses then regains momentum).

type ReactionName = "flip" | "fall" | "dodge";
type ReactionCtx = { pop: number; dir: number };
type ReactionPlan = {
  figure: TargetAndTransition;
  speed?: { to: number[]; duration: number; times?: number[]; ease?: Easing | Easing[] };
};

const cubic = (a: number, b: number, c: number, d: number) =>
  [a, b, c, d] as [number, number, number, number];

/** FLIP: full 360 with a weighted pop, settles, keeps sliding. */
function flipReaction({ pop }: ReactionCtx): ReactionPlan {
  return { figure: flipAnimation(pop) };
}

/**
 * FALL + RECOVER: a quick tip to ~86deg, drop onto the snow, a beat on the
 * ground, then an effortful push back upright. Descent slows hard during the
 * stumble and eases back to normal on recovery, selling the lost momentum.
 */
function fallReaction({ pop }: ReactionCtx): ReactionPlan {
  const drop = pop * 0.8;
  return {
    figure: {
      rotate: [0, 86, 86, 80, 0],
      y: [0, drop, drop, drop * 0.96, 0],
      transition: {
        duration: 1.4,
        times: [0, 0.16, 0.58, 0.72, 1],
        // quick tip, hold on the ground, then an effortful rise
        ease: [cubic(0.3, 0, 0.2, 1), "linear", "linear", cubic(0.45, 0, 0.35, 1)],
      },
    },
    speed: {
      to: [1, 0.22, 0.22, 1],
      duration: 1.4,
      times: [0, 0.2, 0.66, 1],
      ease: "easeInOut",
    },
  };
}

/**
 * DODGE: a snappy sidestep away from the tap, with a slight lean into it, then
 * eased back to the lane. The fastest, lightest reaction.
 */
function dodgeReaction({ dir }: ReactionCtx): ReactionPlan {
  const shift = 18 * dir; // px, away from the tap side
  return {
    figure: {
      x: [0, shift, shift, 0],
      rotate: [0, 7 * dir, 7 * dir, 0], // lean into the dodge
      transition: {
        duration: 0.5,
        times: [0, 0.28, 0.5, 1],
        ease: [cubic(0.2, 0.8, 0.3, 1), "linear", cubic(0.4, 0, 0.4, 1)],
      },
    },
  };
}

/** Reaction registry. Swapping these for Rive state triggers later is clean. */
const REACTIONS: Record<ReactionName, (ctx: ReactionCtx) => ReactionPlan> = {
  flip: flipReaction,
  fall: fallReaction,
  dodge: dodgeReaction,
};

/** Relative likelihood of each reaction on a tap. Tune freely. */
const REACTION_WEIGHTS: Record<ReactionName, number> = {
  flip: 40,
  fall: 35,
  dodge: 25,
};

// Weighted draw, excluding the last reaction so the same one never repeats.
// Dropping the excluded weight and summing the rest re-normalizes implicitly.
function pickReaction(exclude?: ReactionName | null): ReactionName {
  const names = (Object.keys(REACTION_WEIGHTS) as ReactionName[]).filter(
    (n) => n !== exclude
  );
  const total = names.reduce((sum, n) => sum + REACTION_WEIGHTS[n], 0);
  let r = Math.random() * total;
  for (const n of names) {
    r -= REACTION_WEIGHTS[n];
    if (r < 0) return n;
  }
  return names[names.length - 1];
}

// Travel tuning, all in fractions of the (square) slope side per second.
const SLIDE_SPEED = 0.11; // slope-heights per second; a calm glide, slow enough to tap and explore
const DRIFT = -0.14; // leftward drift per unit of descent, following the slope diagonal
const ENTER = -0.14; // respawn just above the top edge, off-view
const EXIT = 1.16; // exit just below the bottom edge, off-view
const TWO_PI = Math.PI * 2;

// ---- Snow spray (chunky flecks kicked off the back of the board) ---------
// A pooled, transform-only particle trail. Velocities are px/sec, positions px
// relative to the skier centre. Budgeted (hard cap per skier) to scale to 8.
const SPRAY_MAX = 22; // hard cap of live flecks per skier (x8 budget)
const SPRAY_GRAVITY = 210; // px/s^2 pulling flecks back down after they rise
const STEADY_RATE = 18; // flecks/sec while sliding straight
// vy is strongly negative (upward) so flecks launch UP off the board, decelerate
// under gravity, reach an apex, then fall: a real upward spray, not a dribble down.
type FleckCfg = { vx: number; vy: number; spread: number; up: number; lifeMin: number };
const STEADY_CFG: FleckCfg = { vx: 14, vy: -66, spread: 34, up: 30, lifeMin: 0.44 };
const FLIP_BURST: FleckCfg = { vx: 14, vy: -100, spread: 66, up: 46, lifeMin: 0.5 }; // upward puff
const FALL_BURST: FleckCfg = { vx: 8, vy: -84, spread: 108, up: 46, lifeMin: 0.54 }; // biggest, wide
const DODGE_BURST: FleckCfg = { vx: 42, vy: -74, spread: 40, up: 34, lifeMin: 0.44 }; // sideways

/**
 * One self-contained skier. Travel down-slope is the base motion, driven every
 * frame as a transform on the outer element. Reactions (rotate/pop/shift) play
 * on a separate inner element, layered on top of the descent without ever
 * pausing or resetting it. All slide and reaction state (guard, lastReaction)
 * is per instance, so every skier reacts independently of the others. This is
 * the one component to swap for a Rive-driven version later.
 */
const Skier = forwardRef<
  SkierHandle,
  { rider: Rider; size: number; spray?: boolean; reducedMotion?: boolean }
>(function Skier({ rider, size, spray = false, reducedMotion = false }, ref) {
  // outer travel transform, in px, written directly without re-rendering React
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // "slide" = ambient descent; "carve" = recruited to trace a letter
  const mode = useRef<"slide" | "carve">("slide");
  const reactingRef = useRef(false);
  // start at this rider's phase, then flow down its lane at its own speed. Lanes
  // are parallel and spaced wider than a figure, so even with different speeds
  // the perpendicular gap between any two riders never closes: no collisions.
  const travel = useRef(rider.top / 100);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const controls = useAnimationControls();
  const figureRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<HTMLDivElement>(null); // carve lean is written here per frame
  // the last reaction this skier played, so the next tap never repeats it
  const lastReaction = useRef<ReactionName | null>(null);
  // descent-speed multiplier; only the fall reaction dips it below 1 then recovers
  const speedFactor = useMotionValue(1);
  const [isReacting, setIsReacting] = useState(false);

  // snow spray: a pooled particle trail kicked off the board (reduced-motion off)
  const sprayOn = spray && !reducedMotion;
  const flecks = useRef<HTMLSpanElement[]>([]);
  const particles = useRef(
    Array.from({ length: SPRAY_MAX }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
    }))
  );
  const emitAcc = useRef(0);

  // activate one fleck at the board, kicked per the config (opposite travel, up)
  function spawnFleck(cfg: FleckCfg) {
    let idx = -1;
    for (let i = 0; i < SPRAY_MAX; i++) {
      if (!particles.current[i].active) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return; // pool full: hard cap, never exceed the budget
    const p = particles.current[idx];
    const w = rider.w;
    p.active = true;
    p.maxLife = cfg.lifeMin + Math.random() * 0.18;
    p.life = p.maxLife;
    p.x = (Math.random() - 0.5) * 0.18 * w;
    p.y = 0.42 * w + (Math.random() - 0.5) * 0.1 * w;
    p.vx = cfg.vx + (Math.random() - 0.5) * cfg.spread;
    p.vy = cfg.vy - Math.random() * cfg.up;
    const node = flecks.current[idx];
    if (node) {
      const sz = 5 + Math.random() * 4; // chunky 5-9px flecks, not fine mist
      node.style.width = `${sz}px`;
      node.style.height = `${sz}px`;
    }
  }

  function spawnBurst(count: number, cfg: FleckCfg) {
    for (let i = 0; i < count; i++) spawnFleck(cfg);
  }

  useAnimationFrame((_, delta) => {
    const s = sizeRef.current;
    if (!s) return;
    const dt = delta / 1000;

    // ambient descent only runs when not recruited to carve a letter
    if (mode.current === "slide") {
      const fyRate = SLIDE_SPEED * rider.speed * speedFactor.get();
      let fy = travel.current + fyRate * dt;
      if (fy > EXIT) fy = ENTER + (fy - EXIT); // wrap off-screen, carry the remainder
      travel.current = fy;

      // carving lives in the BASE travel layer: a lateral weave added to lane x,
      // plus a lean written to .place. Reactions (.figure) and spray ride on top.
      let carve = 0;
      let latVel = 0;
      const c = rider.carve;
      if (c) {
        const arg = TWO_PI * c.freq * fy + c.phase;
        carve = c.amp * Math.sin(arg);
        latVel = c.amp * TWO_PI * c.freq * fyRate * Math.cos(arg); // px/s, sets turn
        const lean = c.lean * Math.cos(arg); // edge into the turn
        const place = placeRef.current;
        if (place) {
          const ls = rider.flip ? -lean : lean; // keep the lean into the turn when mirrored
          place.style.transform = `translate(-50%, -50%) rotate(${(rider.rot + ls).toFixed(2)}deg) scaleX(${rider.flip ? -1 : 1})`;
        }
      }

      // left IS the lane intercept; the shared DRIFT keeps every lane parallel,
      // so spacing the lanes wider than a figure guarantees no two ever touch
      const fx = rider.left / 100 + DRIFT * fy;
      x.set(fx * s + carve);
      y.set(fy * s);

      // gentle steady emission, only while he is actually on the slope.
      // on hard carve turns the spray fans wider and biases toward the turn.
      if (sprayOn && fy > 0 && fy < 1) {
        emitAcc.current += STEADY_RATE * dt;
        const turn = Math.min(1, Math.abs(latVel) / 60);
        while (emitAcc.current >= 1) {
          spawnFleck(
            turn > 0.05
              ? {
                  ...STEADY_CFG,
                  spread: STEADY_CFG.spread + turn * 44,
                  vx: STEADY_CFG.vx + Math.sign(latVel) * turn * 34,
                }
              : STEADY_CFG
          );
          emitAcc.current -= 1;
        }
      }
    }

    if (!sprayOn) return;
    // integrate + render every live fleck (transform/opacity only), always, so
    // flecks finish their arc even while the skier is carving a letter
    for (let i = 0; i < SPRAY_MAX; i++) {
      const p = particles.current[i];
      if (!p.active) continue;
      p.vy += SPRAY_GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const node = flecks.current[i];
      if (p.life <= 0) {
        p.active = false;
        if (node) node.style.opacity = "0";
        continue;
      }
      if (node) {
        const k = p.life / p.maxLife;
        node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        node.style.opacity = (Math.min(1, k * 1.8) * 0.95).toFixed(2);
      }
    }
  });

  // one tap triggers one weighted-random reaction, layered over the descent
  async function handleTap(
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: { point: { x: number; y: number } }
  ) {
    if (mode.current === "carve" || isReacting) return; // busy carving or reacting
    setIsReacting(true);
    reactingRef.current = true;
    try {
      // dodge away from the side the tap came from (fall back to a fixed side)
      const rect = figureRef.current?.getBoundingClientRect();
      const center = rect ? rect.left + rect.width / 2 : info.point.x;
      const dir = info.point.x <= center ? 1 : -1;

      const name = pickReaction(lastReaction.current);
      lastReaction.current = name;

      // spray bursts timed to each reaction
      if (sprayOn) {
        if (name === "flip") spawnBurst(12, FLIP_BURST); // puff on takeoff
        else if (name === "dodge") spawnBurst(10, { ...DODGE_BURST, vx: 46 * dir });
        else if (name === "fall")
          // biggest burst at the landing impact, a beat after the tip starts
          window.setTimeout(() => spawnBurst(20, FALL_BURST), 180);
      }

      const plan = REACTIONS[name]({ pop: rider.w * 0.6, dir });
      const jobs: Promise<unknown>[] = [controls.start(plan.figure)];
      if (plan.speed) {
        jobs.push(
          animate(speedFactor, plan.speed.to, {
            duration: plan.speed.duration,
            times: plan.speed.times,
            ease: plan.speed.ease,
          }).finished
        );
      }
      await Promise.all(jobs);
    } finally {
      // always reset layered transforms; descent (outer x/y) is untouched
      controls.set({ rotate: 0, x: 0, y: 0 });
      speedFactor.set(1);
      reactingRef.current = false;
      setIsReacting(false);
    }
  }

  // imperative handle: the coordinator recruits this skier to carve a letter
  useImperativeHandle(
    ref,
    () => ({
      getPos: () => ({ x: x.get(), y: y.get() }),
      isAvailable: () => mode.current === "slide" && !reactingRef.current,
      carve: async (
        strokes: CarveStroke[],
        csize: number,
        shouldCancel?: () => boolean
      ) => {
        if (!strokes.length) return;
        mode.current = "carve";
        const pointPx = (st: CarveStroke, frac: number) => {
          const len = st.el.getTotalLength();
          const lp = st.el.getPointAtLength(frac * len);
          return {
            x: ((st.gx + lp.x * st.scale) * csize) / 100,
            y: ((st.gy + lp.y * st.scale) * csize) / 100,
          };
        };
        const glide = (t: { x: number; y: number }) =>
          Promise.all([
            animate(x, t.x, { duration: 0.45, ease: "easeInOut" }).finished,
            animate(y, t.y, { duration: 0.45, ease: "easeInOut" }).finished,
          ]);
        try {
          await glide(pointPx(strokes[0], 0)); // ski over to the letter start
          for (let k = 0; k < strokes.length; k++) {
            if (shouldCancel?.()) break;
            const st = strokes[k];
            const lenPx = (st.el.getTotalLength() * st.scale * csize) / 100;
            await animate(0, 1, {
              duration: Math.max(0.45, lenPx / CARVE_PX_SPEED),
              ease: "easeInOut",
              onUpdate: (v) => {
                const p = pointPx(st, v);
                x.set(p.x);
                y.set(p.y);
                st.prog.set(v); // reveal the groove at the skier
                if (sprayOn && Math.random() < 0.5) spawnFleck(STEADY_CFG);
              },
            }).finished;
            if (shouldCancel?.()) break;
            if (k + 1 < strokes.length) await glide(pointPx(strokes[k + 1], 0));
          }
        } catch {
          // letter may have been removed mid-carve; just fall through to resume
        }
        // rejoin the lane at the current height and resume sliding
        const fy = Math.min(0.98, Math.max(0.02, y.get() / csize));
        const laneX = (rider.left / 100 + DRIFT * fy) * csize;
        await glide({ x: laneX, y: fy * csize });
        travel.current = fy;
        mode.current = "slide";
      },
    }),
    [x, y, rider, sprayOn]
  );

  return (
    <motion.div className={styles.travel} style={{ x, y }}>
      {spray && (
        // particle layer sits before the figure so flecks read as kicked up
        // from under the board, not floating in front of his body
        <div className={styles.spray} aria-hidden="true">
          {Array.from({ length: SPRAY_MAX }).map((_, i) => (
            <span
              key={i}
              ref={(el) => {
                if (el) flecks.current[i] = el;
              }}
              className={styles.fleck}
            />
          ))}
        </div>
      )}
      <div
        ref={placeRef}
        className={styles.place}
        style={{ transform: `translate(-50%, -50%) rotate(${rider.rot}deg) scaleX(${rider.flip ? -1 : 1})` }}
      >
        {/* short trail trailing up-slope, travels with the skier */}
        <span className={styles.trail} aria-hidden="true" />
        <motion.div
          ref={figureRef}
          className={styles.figure}
          animate={controls}
          onTap={handleTap}
          style={{ transformOrigin: "center center", cursor: "pointer" }}
        >
          <PlaceholderSkier width={rider.w} color={rider.color} />
        </motion.div>
      </div>
    </motion.div>
  );
});

/** Gradient + shading definitions, declared once for the whole slope. */
function SkierDefs() {
  return (
    <svg className={styles.defs} aria-hidden="true">
      <defs>
        <linearGradient id="jacket-orange" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#E89A5C" />
          <stop offset="0.45" stopColor="#C97836" />
          <stop offset="1" stopColor="#9A4C19" />
        </linearGradient>
        <linearGradient id="jacket-burgundy" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#A8424B" />
          <stop offset="0.45" stopColor="#7E2A33" />
          <stop offset="1" stopColor="#561C23" />
        </linearGradient>
        <linearGradient id="jacket-green" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#8AA081" />
          <stop offset="0.45" stopColor="#5C7355" />
          <stop offset="1" stopColor="#3E4F3A" />
        </linearGradient>
        <linearGradient id="jacket-blue" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#6E8A9E" />
          <stop offset="0.45" stopColor="#466276" />
          <stop offset="1" stopColor="#2E4150" />
        </linearGradient>
        <linearGradient id="jacket-yellow" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#E3BC57" />
          <stop offset="0.45" stopColor="#C99A2E" />
          <stop offset="1" stopColor="#8E6C18" />
        </linearGradient>
        <linearGradient id="pants" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#4A4A55" />
          <stop offset="1" stopColor="#23232B" />
        </linearGradient>
        <linearGradient id="helmet" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#D2D5DD" />
          <stop offset="1" stopColor="#63666F" />
        </linearGradient>
        <linearGradient id="board" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#D6D9E0" />
          <stop offset="1" stopColor="#A6A9B3" />
        </linearGradient>
        <radialGradient id="ground" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#4A4640" stopOpacity="0.3" />
          <stop offset="1" stopColor="#4A4640" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/**
 * Side-facing snowboarder, leaning into the descent.
 * Jacket gradient runs burnt orange (#C97836) to orange-dark (#9A4C19)
 * for a 3D, lit-from-above look. Limbs are continuous shapes so the
 * figure reads as one connected body rather than stacked blocks.
 * Shapes reference the shared gradients declared in SkierDefs.
 */
function PlaceholderSkier({ width = 40, color = "orange" }: { width?: number; color?: JacketColor }) {
  const jacket = `url(#${JACKETS[color].grad})`;
  const shade = JACKETS[color].shade;
  return (
    <svg
      width={width}
      height={(width * 130) / 120}
      viewBox="0 0 120 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Snowboarder placeholder"
    >
      {/* soft contact shadow on the snow */}
      <ellipse cx="62" cy="118" rx="42" ry="7" fill="url(#ground)" />

      {/* snowboard, angled, with a bright top edge for sheen */}
      <g transform="rotate(-15 62 106)">
        <rect x="18" y="102" width="88" height="9" rx="4.5" fill="url(#board)" stroke="#8C8F99" strokeWidth="0.6" />
        <rect x="22" y="102.5" width="80" height="2.6" rx="1.3" fill="#FFFFFF" opacity="0.75" />
      </g>

      {/* legs (pants), bent and connecting hips to the board */}
      <path d="M56 62 C 51 76, 47 88, 48 98 L 57 99 C 58 88, 61 77, 64 64 Z" fill="url(#pants)" />
      <path d="M66 62 C 71 75, 77 84, 83 90 L 89 85 C 82 78, 75 70, 73 62 Z" fill="url(#pants)" />

      {/* boots strapped to the board */}
      <rect x="45" y="94" width="15" height="8" rx="2.5" fill="#1F1F26" transform="rotate(-15 52 98)" />
      <rect x="78" y="84" width="15" height="8" rx="2.5" fill="#1F1F26" transform="rotate(-15 85 88)" />

      {/* upper body leaning downhill: head, jacket, arms, poles */}
      <g transform="rotate(9 60 62)">
        {/* poles planting into the snow */}
        <line x1="39" y1="58" x2="29" y2="92" stroke="#585B64" strokeWidth="1.7" strokeLinecap="round" />
        <line x1="86" y1="56" x2="97" y2="88" stroke="#585B64" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="29" cy="92" r="2.4" fill="#585B64" />
        <circle cx="97" cy="88" r="2.4" fill="#585B64" />

        {/* rear arm reaching back to its pole */}
        <path d="M53 38 C 46 44, 40 51, 38 59 L 43 61 C 46 53, 51 47, 57 42 Z" fill={jacket} />
        {/* front arm reaching forward to its pole */}
        <path d="M71 40 C 79 43, 84 49, 87 56 L 83 60 C 79 53, 73 48, 67 44 Z" fill={jacket} />

        {/* torso: one continuous jacket shell */}
        <path d="M52 34 C 45 41, 45 55, 54 64 C 61 70, 70 69, 74 61 C 79 51, 76 39, 70 34 C 64 29, 58 29, 52 34 Z" fill={jacket} />
        {/* back-panel shading so the spine reads as turned away */}
        <path d="M55 36 C 50 45, 51 56, 57 63 C 60 57, 60 45, 62 36 Z" fill={shade} opacity="0.38" />

        {/* neck connecting head to jacket */}
        <rect x="55" y="32" width="11" height="6" rx="3" fill="#7E818B" />
        {/* helmeted head, 3/4 turned away */}
        <circle cx="61" cy="25" r="10" fill="url(#helmet)" />
        <path d="M61 15 a10 10 0 0 1 8.5 5 a10 10 0 0 1 -17 0 a10 10 0 0 1 8.5 -5Z" fill="#494C55" opacity="0.4" />
      </g>
    </svg>
  );
}
