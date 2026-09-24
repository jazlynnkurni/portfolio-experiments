"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  type MotionValue,
} from "framer-motion";

type Variant = "player" | "avatar";

type Props = {
  /** Cue rotation in degrees (0 = body straight down from cue ball). */
  angle?: MotionValue<number>;
  /** Pullback distance in pixels (slides cue along its body axis). */
  pullback?: MotionValue<number>;
  /** Cue body length as % of container height. */
  length?: number;
  /** Cue ball x position as % of container width (anchor for the cue tip). */
  x?: number;
  /** Cue ball y position as % of container height. */
  y?: number;
  /** Show or hide the cue stick (fades opacity over 150ms). */
  visible?: boolean;
  /** Visual tone: player = warm clay, avatar = darker walnut. */
  variant?: Variant;
  /** Optional design override — a custom shaft gradient + width (%). */
  design?: { background?: string; width?: string };
};

const FADE_MASK =
  "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)";

const VARIANT_BG: Record<Variant, string> = {
  player:
    "linear-gradient(to bottom, #95704F 0%, #95704F 18%, #B08968 22%, #B08968 100%)",
  avatar:
    "linear-gradient(to bottom, #2E2014 0%, #2E2014 18%, #4A3422 22%, #5A4029 100%)",
};

/**
 * Cue stick anchored at the cue ball center, with its tip offset by the
 * ball radius (translateY(4%) of cue height ≈ ball radius) along the
 * rotated axis. Pullback adds further translation along the same axis.
 * Result: tip always touches the ball edge in the cue body direction.
 *
 * Bottom (butt) is rounded via border-radius and the bottom ~30% fades
 * out via a linear mask so the cue dissolves into the page background
 * rather than ending with a hard edge.
 */
export default function CueStick({
  angle,
  pullback,
  length = 45,
  x = 50,
  y = 72,
  visible = true,
  variant = "player",
  design,
}: Props) {
  const fallbackAngle = useMotionValue(0);
  const fallbackPullback = useMotionValue(0);
  const a = angle ?? fallbackAngle;
  const p = pullback ?? fallbackPullback;

  const transform = useMotionTemplate`translateX(-50%) rotate(${a}deg) translateY(calc(4% + ${p}px))`;

  return (
    <motion.div
      aria-hidden
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: design?.width ?? "3%",
        height: `${length}%`,
        transform,
        transformOrigin: "50% 0%",
        background: design?.background ?? VARIANT_BG[variant],
        borderRadius: "0 0 9999px 9999px",
        filter:
          "drop-shadow(2px 4px 6px rgba(50, 30, 20, 0.3)) blur(0.4px)",
        maskImage: FADE_MASK,
        WebkitMaskImage: FADE_MASK,
        zIndex: 30,
        pointerEvents: "none",
      }}
    />
  );
}
