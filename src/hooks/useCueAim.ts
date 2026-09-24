"use client";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import {
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";

const PULLBACK_MAX = 40;
const PULLBACK_SCALE = 0.4;
const SPRING = { stiffness: 150, damping: 25 };

export type CueAim = {
  /** Cue stick rotation in degrees (cue body direction, 0 = down). */
  cueAngle: MotionValue<number>;
  /** Aim direction in degrees (atan2 of mouse from cue ball, 0 = right). */
  aimAngle: MotionValue<number>;
  /** Pullback distance in pixels (0–PULLBACK_MAX). */
  pullback: MotionValue<number>;
  isHovering: boolean;
  isAiming: boolean;
  bind: {
    onPointerEnter: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerLeave: () => void;
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  };
};

export type ShotInfo = {
  /** Direction the cue ball should travel, in degrees (atan2 of mouse from cue ball). */
  aimAngleDeg: number;
  /** Pullback distance in pixels at the moment of release (0-PULLBACK_MAX). */
  pullback: number;
};

export function useCueAim(
  containerRef: RefObject<HTMLDivElement | null>,
  cueBallXPercent: number,
  cueBallYPercent: number,
  options?: { onShoot?: (info: ShotInfo) => void }
): CueAim {
  const rawCueAngle = useMotionValue(0);
  const cueAngle = useSpring(rawCueAngle, SPRING);
  const aimAngle = useTransform(cueAngle, (a) => a - 90);

  const rawPullback = useMotionValue(0);
  const pullback = useSpring(rawPullback, SPRING);

  const [isHovering, setIsHovering] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  const isAimingRef = useRef(false);
  const lastUnwrappedRef = useRef(0);

  const compute = (e: { clientX: number; clientY: number }) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cueX = rect.left + (rect.width * cueBallXPercent) / 100;
    const cueY = rect.top + (rect.height * cueBallYPercent) / 100;
    const dx = e.clientX - cueX;
    const dy = e.clientY - cueY;
    if (dx === 0 && dy === 0) return;

    const radians = Math.atan2(dy, dx);
    const degrees = (radians * 180) / Math.PI;
    // Cue body points OPPOSITE the mouse, so cue rotation = mouseAngle + 90
    // (default cue extends "down" = 0° in our local frame).
    let next = degrees + 90;
    // Unwrap to the nearest equivalent to the last value so the spring
    // takes the shortest path (no 359° → 0° flip).
    while (next - lastUnwrappedRef.current > 180) next -= 360;
    while (next - lastUnwrappedRef.current < -180) next += 360;
    lastUnwrappedRef.current = next;
    rawCueAngle.set(next);

    if (isAimingRef.current) {
      const dist = Math.hypot(dx, dy);
      rawPullback.set(Math.min(PULLBACK_MAX, dist * PULLBACK_SCALE));
    }
  };

  const resetToDefault = () => {
    // Snap back to the nearest 0-equivalent so the spring path is short.
    const target = Math.round(lastUnwrappedRef.current / 360) * 360;
    rawCueAngle.set(target);
    lastUnwrappedRef.current = target;
    rawPullback.set(0);
  };

  useEffect(() => {
    const handleUp = () => {
      if (isAimingRef.current) {
        isAimingRef.current = false;
        setIsAiming(false);
        rawPullback.set(0);
      }
    };
    window.addEventListener("pointerup", handleUp);
    return () => window.removeEventListener("pointerup", handleUp);
  }, [rawPullback]);

  return {
    cueAngle,
    aimAngle,
    pullback,
    isHovering,
    isAiming,
    bind: {
      onPointerEnter: (e) => {
        setIsHovering(true);
        compute(e);
      },
      onPointerLeave: () => {
        setIsHovering(false);
        if (!isAimingRef.current) {
          resetToDefault();
        }
      },
      onPointerMove: (e) => {
        compute(e);
      },
      onPointerDown: (e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* setPointerCapture can throw if the pointer is already captured */
        }
        isAimingRef.current = true;
        setIsAiming(true);
        compute(e);
      },
      onPointerUp: (e) => {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        // Capture shot info BEFORE resetting pullback so consumers can fire physics.
        if (isAimingRef.current && options?.onShoot) {
          const currentPullback = pullback.get();
          if (currentPullback > 0.5) {
            options.onShoot({
              aimAngleDeg: aimAngle.get(),
              pullback: currentPullback,
            });
          }
        }
        isAimingRef.current = false;
        setIsAiming(false);
        rawPullback.set(0);
      },
    },
  };
}
