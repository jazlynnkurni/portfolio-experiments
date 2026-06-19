"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useAnimationControls,
  useAnimationFrame,
  useMotionValue,
} from "framer-motion";
import SnowShader from "./SnowShader";
import styles from "./SkierSlope.module.css";

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
};

/**
 * 12 riders laid out to match the reference painting: positions flow along the
 * slope diagonal, and sizes grow toward the bottom for perspective. RIDERS[0]
 * is the interactive slider; its `left` sets the lane it descends, `top` is
 * unused since it enters from above the top edge.
 */
// lanes are spaced 8 apart (wider than a figure); phases and speeds are varied
const RIDERS: Rider[] = [
  { top: 8, left: 54, w: 28, rot: -2, flip: false, color: "orange", speed: 1.15 },
  { top: 30, left: 13, w: 26, rot: -5, flip: false, color: "yellow", speed: 0.85 },
  { top: 15, left: 79, w: 24, rot: 3, flip: true, color: "blue", speed: 1.25 },
  { top: 55, left: 38, w: 28, rot: -3, flip: false, color: "burgundy", speed: 0.95 },
  { top: 72, left: 21, w: 26, rot: -4, flip: false, color: "blue", speed: 1.1 },
  { top: 40, left: 62, w: 28, rot: 2, flip: false, color: "green", speed: 0.72 },
  { top: 60, left: 95, w: 26, rot: 4, flip: true, color: "burgundy", speed: 1.2 },
  { top: 85, left: 5, w: 28, rot: -3, flip: false, color: "orange", speed: 0.9 },
  { top: 22, left: 46, w: 26, rot: 2, flip: true, color: "yellow", speed: 1.05 },
  { top: 92, left: 30, w: 28, rot: -2, flip: false, color: "burgundy", speed: 1.0 },
  { top: 5, left: 87, w: 24, rot: 3, flip: true, color: "blue", speed: 0.8 },
  { top: 78, left: 70, w: 28, rot: 2, flip: false, color: "green", speed: 1.3 },
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

  useEffect(() => {
    const el = slopeRef.current;
    if (!el) return;
    const measure = () => setSize(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <section
      ref={slopeRef}
      className={`${styles.slope} ${variant === "embed" ? styles.embed : styles.full}`}
      aria-label="Skier slope"
    >
      {/* procedural GLSL snow surface, clipped to the rounded square */}
      <SnowShader className={styles.snow} />

      {/* shared gradient defs so the 12 figures do not redeclare ids */}
      <SkierDefs />

      {/* all riders flow down-slope; wait for the measured size so they start placed */}
      {size > 0 &&
        RIDERS.map((r, i) => (
          <SlidingSkier
            key={i}
            rider={r}
            size={size}
            interactive={i === INTERACTIVE_INDEX}
          />
        ))}
    </section>
  );
}

/** Which rider reacts to taps. Reused per skier later. */
const INTERACTIVE_INDEX = 0;

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

// Travel tuning, all in fractions of the (square) slope side per second.
const SLIDE_SPEED = 0.16; // slope-heights per second; a calm glide
const DRIFT = -0.14; // leftward drift per unit of descent, following the slope diagonal
const ENTER = -0.14; // respawn just above the top edge, off-view
const EXIT = 1.16; // exit just below the bottom edge, off-view

/**
 * The one moving skier. Travel down-slope is the base motion, driven every
 * frame as a transform on the outer element. The flip (rotate + pop) plays on
 * a separate inner element, so it layers on top of the descent without ever
 * pausing or resetting it. Taps are ignored while a flip is already running.
 */
function SlidingSkier({
  rider,
  size,
  interactive = false,
}: {
  rider: Rider;
  size: number;
  interactive?: boolean;
}) {
  // outer travel transform, in px, written directly without re-rendering React
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // start at this rider's phase, then flow down its lane at its own speed. Lanes
  // are parallel and spaced wider than a figure, so even with different speeds
  // the perpendicular gap between any two riders never closes: no collisions.
  const travel = useRef(rider.top / 100);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const controls = useAnimationControls();
  const [isFlipping, setIsFlipping] = useState(false);

  useAnimationFrame((_, delta) => {
    const s = sizeRef.current;
    if (!s) return;
    let fy = travel.current + SLIDE_SPEED * rider.speed * (delta / 1000);
    if (fy > EXIT) fy = ENTER + (fy - EXIT); // wrap off-screen, carry the remainder
    travel.current = fy;
    // left IS the lane intercept; the shared DRIFT keeps every lane parallel,
    // so spacing the lanes wider than a figure guarantees no two ever touch
    const fx = rider.left / 100 + DRIFT * fy;
    x.set(fx * s);
    y.set(fy * s);
  });

  async function handleFlip() {
    if (isFlipping) return;
    setIsFlipping(true);
    await controls.start(flipAnimation(rider.w * 0.6));
    // a 360 lands where 0 started, so snap the value back for the next tap
    controls.set({ rotate: 0, y: 0 });
    setIsFlipping(false);
  }

  return (
    <motion.div className={styles.travel} style={{ x, y }}>
      <div
        className={styles.place}
        style={{ transform: `translate(-50%, -50%) rotate(${rider.rot}deg) scaleX(${rider.flip ? -1 : 1})` }}
      >
        {/* short trail trailing up-slope, travels with the skier */}
        <span className={styles.trail} aria-hidden="true" />
        <motion.div
          className={styles.figure}
          animate={controls}
          onTap={interactive ? handleFlip : undefined}
          style={{ transformOrigin: "center center", cursor: interactive ? "pointer" : undefined }}
        >
          <PlaceholderSkier width={rider.w} color={rider.color} />
        </motion.div>
      </div>
    </motion.div>
  );
}

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
