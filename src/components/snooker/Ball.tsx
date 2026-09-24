"use client";

import { motion } from "framer-motion";

type BallProps = {
  number?: number;
  x: number;
  y: number;
  color: string;
  isStriped?: boolean;
  isCueBall?: boolean;
  /** When true, the ball animates scale 1→0 + opacity 1→0 over 200ms
   *  (drop-into-pocket effect). Parent should remove it from render
   *  after the animation completes. */
  dropping?: boolean;
};

const SIZE_PCT = 6.5;

function lighten(hex: string, amount = 0.45) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${lr}, ${lg}, ${lb})`;
}

function darken(hex: string, amount = 0.3) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * (1 - amount))}, ${Math.round(g * (1 - amount))}, ${Math.round(b * (1 - amount))})`;
}

export default function Ball({
  number,
  x,
  y,
  color,
  isStriped,
  isCueBall,
  dropping = false,
}: BallProps) {
  const base = isCueBall ? "#FFF5EF" : color;
  const highlight = isCueBall ? "#FFFEFB" : lighten(base);
  const shadow = isCueBall ? "#E8DDD0" : darken(base);

  const isInkBall = color === "#1E1E1E" && !isCueBall;
  const numberColor = isStriped
    ? "rgba(30, 30, 30, 0.65)"
    : isInkBall
      ? "rgba(255, 245, 239, 0.85)"
      : "rgba(30, 30, 30, 0.55)";

  const ballShadow = isCueBall
    ? "0 5px 10px rgba(50, 30, 20, 0.3), inset 0 -2px 4px rgba(0, 0, 0, 0.1)"
    : "0 4px 8px rgba(50, 30, 20, 0.25), inset 0 -2px 4px rgba(0, 0, 0, 0.15)";

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: `${SIZE_PCT}%`,
        aspectRatio: "1",
        transform: "translate(-50%, -50%)",
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      <motion.div
        initial={false}
        animate={{
          scale: dropping ? 0 : 1,
          opacity: dropping ? 0 : 1,
        }}
        transition={{ duration: 0.13, ease: "easeIn" }}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 30% 30%, ${highlight} 0%, ${base} 45%, ${shadow} 100%)`,
          boxShadow: ballShadow,
          filter: "blur(0.3px)",
          overflow: "hidden",
        }}
      >
        {isStriped && (
          <div
            style={{
              position: "absolute",
              top: "35%",
              left: 0,
              width: "100%",
              height: "30%",
              background:
                "linear-gradient(to bottom, #FFFAF4 0%, #FFF5EF 50%, #F2E6D7 100%)",
              opacity: 0.95,
            }}
          />
        )}
        {number !== undefined && !isCueBall && (
          <span
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              fontFamily: "var(--font-mono), monospace",
              fontSize: "10px",
              fontWeight: 500,
              color: numberColor,
              textShadow: "0 0 2px rgba(255, 250, 244, 0.5)",
              pointerEvents: "none",
              lineHeight: 1,
              letterSpacing: 0,
            }}
          >
            {number}
          </span>
        )}
      </motion.div>
    </div>
  );
}
