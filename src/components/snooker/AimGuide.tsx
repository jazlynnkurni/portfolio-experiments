"use client";

import { motion, type MotionValue } from "framer-motion";

type Props = {
  /** Aim direction in degrees (atan2 of mouse from cue ball, 0 = right). */
  aimAngle: MotionValue<number>;
  visible: boolean;
  cueBallX: number;
  cueBallY: number;
  /** Length of the guide as % of container width. */
  length?: number;
};

export default function AimGuide({
  aimAngle,
  visible,
  cueBallX,
  cueBallY,
  length = 40,
}: Props) {
  return (
    <motion.div
      aria-hidden
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{
        position: "absolute",
        left: `${cueBallX}%`,
        top: `${cueBallY}%`,
        width: `${length}%`,
        height: "1px",
        transformOrigin: "0% 50%",
        rotate: aimAngle,
        backgroundImage:
          "repeating-linear-gradient(to right, rgba(255, 245, 239, 0.55) 0 4px, transparent 4px 9px)",
        pointerEvents: "none",
        zIndex: 25,
      }}
    />
  );
}
