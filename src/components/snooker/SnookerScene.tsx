"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
} from "framer-motion";
import Matter from "matter-js";
import { useCueAim, type ShotInfo } from "@/hooks/useCueAim";
import Ball from "./Ball";
import CueStick from "./CueStick";
import AimGuide from "./AimGuide";
import Avatar from "./Avatar";
import SpeechBubble from "./SpeechBubble";

type RackBall = {
  number: number;
  x: number;
  y: number;
  color: string;
  isStriped?: boolean;
};

const RACK: RackBall[] = [
  // Row 1 — apex
  { number: 1, x: 50, y: 24, color: "#7A9471" },
  // Row 2
  { number: 2, x: 46.8, y: 29.6, color: "#B08968" },
  { number: 9, x: 53.2, y: 29.6, color: "#7A9471", isStriped: true },
  // Row 3 — 8-ball in center
  { number: 10, x: 43.5, y: 35.3, color: "#B08968", isStriped: true },
  { number: 8, x: 50, y: 35.3, color: "#1E1E1E" },
  { number: 3, x: 56.5, y: 35.3, color: "#C97836" },
  // Row 4
  { number: 11, x: 40.3, y: 40.9, color: "#C97836", isStriped: true },
  { number: 4, x: 46.8, y: 40.9, color: "#5B7F9E" },
  { number: 12, x: 53.3, y: 40.9, color: "#5B7F9E", isStriped: true },
  { number: 5, x: 59.8, y: 40.9, color: "#C9A437" },
  // Row 5 — widest
  { number: 6, x: 37, y: 46.5, color: "#A04A3F" },
  { number: 13, x: 43.5, y: 46.5, color: "#A04A3F", isStriped: true },
  { number: 7, x: 50, y: 46.5, color: "#7B6293" },
  { number: 14, x: 56.5, y: 46.5, color: "#C9A437", isStriped: true },
  { number: 15, x: 63, y: 46.5, color: "#7B6293", isStriped: true },
];

const CUE_BALL_INITIAL = { x: 50, y: 72 };

const TAUNTS = [
  "u weak af",
  "js put the fries in the bag bro",
  "even my mom plays better",
  "jk i believe in u",
  "words of affirmation",
  "u gyat tht",
];

// --- Physics constants (in painted-PNG coordinate space: 768 × 1376) ---
const PHYS_W = 768;
const PHYS_H = 1376;
const BALL_RADIUS = (6.5 / 2 / 100) * PHYS_W; // ≈ 25
const CUSHION_INSET_X = 56;
const CUSHION_INSET_Y = 90;
const CUSHION_THICKNESS = 200;
const REST_VELOCITY_THRESHOLD = 0.12;
const MAX_SHOT_SPEED = 42;
const PULLBACK_MAX = 40;

const POCKET_RADIUS = BALL_RADIUS * 1.4;
const POCKETS: Array<{ x: number; y: number; label: string }> = [
  { x: 60, y: 100, label: "pocket-tl" },
  { x: PHYS_W - 60, y: 100, label: "pocket-tr" },
  { x: 60, y: PHYS_H / 2, label: "pocket-ml" },
  { x: PHYS_W - 60, y: PHYS_H / 2, label: "pocket-mr" },
  { x: 60, y: PHYS_H - 100, label: "pocket-bl" },
  { x: PHYS_W - 60, y: PHYS_H - 100, label: "pocket-br" },
];

const DROP_ANIM_MS = 130;

type Vec = { x: number; y: number };
type Positions = { balls: Vec[]; cueBall: Vec };
type CueBallStatus = "active" | "dropping" | "respawning";
type Turn = "player" | "avatar";

// --- Avatar AI constants ---
const AVATAR_THINKING_MS = 200;       // pause before the cue stick appears
const AVATAR_FADE_IN_MS = 120;        // cue stick fades in oriented
const AVATAR_PULLBACK_MS = 450;       // pulls back proportional to force
const AVATAR_PAUSE_MS = 100;          // brief pause at full pullback
const AVATAR_SNAP_MS = 100;           // forward strike
const POCKET_ALIGN_TOLERANCE_DEG = 15; // was 25 — borderline cuts were unmakeable
const POCKET_SHARP_TOLERANCE_DEG = 8;  // within 8° = "sharp" alignment bonus
const AIM_ERROR_DEG_ALIGNED = 2;       // ±2° on confident pocket-aligned shots
const AIM_ERROR_DEG_SAFETY = 6;        // ±6° on fallback / safety shots
const FORCE_VARIANCE = 0.10;           // ±10% force noise (was 15%)
const MIN_FORCE_LEVEL = 0.45;          // minimum power even on short shots
const MAX_FORCE_LEVEL = 1.0;           // cap on the avatar's strongest shot
const SAFETY_FORCE_LEVEL = 0.45;       // gentle disturb-the-cluster shot
// Target→pocket distance is weighted 2x in the travel calc to compensate for
// ~50% energy loss in the cue→target collision, then a 1.3x safety margin on top.
const POCKETING_SAFETY_MARGIN = 1.3;
const POST_COLLISION_ENERGY_FACTOR = 2.0;
const TABLE_DIAGONAL = Math.hypot(PHYS_W, PHYS_H);

const INITIAL_POSITIONS: Positions = {
  balls: RACK.map((b) => ({ x: b.x, y: b.y })),
  cueBall: { x: CUE_BALL_INITIAL.x, y: CUE_BALL_INITIAL.y },
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Smallest signed angle (radians) between two angles in radians.
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Does `ballPos` block a straight line from `cuePos` to `targetPos`? Treats
// the corridor as 2 ball radii wide; the ball must also sit between the
// shooter and the target (not behind either).
function isObstructing(cuePos: Vec, targetPos: Vec, ballPos: Vec): boolean {
  const dx = targetPos.x - cuePos.x;
  const dy = targetPos.y - cuePos.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return false;
  const ux = dx / len;
  const uy = dy / len;
  const bx = ballPos.x - cuePos.x;
  const by = ballPos.y - cuePos.y;
  const t = bx * ux + by * uy;
  if (t < BALL_RADIUS || t > len - BALL_RADIUS) return false;
  const perpX = bx - t * ux;
  const perpY = by - t * uy;
  return Math.hypot(perpX, perpY) < BALL_RADIUS * 2;
}

export default function SnookerScene() {
  const [tauntIndex, setTauntIndex] = useState(0);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [cueVisible, setCueVisible] = useState(true);
  const [positions, setPositions] = useState<Positions>(INITIAL_POSITIONS);
  const [droppingNumbers, setDroppingNumbers] = useState<Set<number>>(
    () => new Set()
  );
  const [pocketedNumbers, setPocketedNumbers] = useState<Set<number>>(
    () => new Set()
  );
  const [cueBallStatus, setCueBallStatus] =
    useState<CueBallStatus>("active");
  const [gameOver, setGameOver] = useState(false);
  const [gameOverShooter, setGameOverShooter] = useState<Turn | null>(null);
  // Player ALWAYS breaks the rack. No coin flip.
  const [turn, setTurn] = useState<Turn>("player");
  const [avatarCueVisible, setAvatarCueVisible] = useState(false);
  const avatarCueAngle = useMotionValue(0);
  const avatarCuePullback = useMotionValue(0);

  const tableRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<Matter.World | null>(null);
  const ballBodiesRef = useRef<Matter.Body[]>([]);
  const cueBallBodyRef = useRef<Matter.Body | null>(null);
  const shotInFlightRef = useRef(false);
  const removedFromPhysicsRef = useRef<Set<number>>(new Set());
  const cueBallStatusRef = useRef<CueBallStatus>("active");
  const gameOverPendingRef = useRef(false);
  const turnRef = useRef<Turn>("player");
  const dropTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const cueDropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last taunt the avatar said so we can re-roll a single
  // duplicate per turn (per spec — one re-roll only, not infinite).
  const lastAvatarTauntRef = useRef<number | null>(null);

  const handleShoot = useCallback(({ aimAngleDeg, pullback }: ShotInfo) => {
    if (turnRef.current !== "player") return;
    if (shotInFlightRef.current) return;
    const cueBall = cueBallBodyRef.current;
    if (!cueBall || cueBallStatusRef.current !== "active") return;
    const speed = (pullback / PULLBACK_MAX) * MAX_SHOT_SPEED;
    const aimRad = (aimAngleDeg * Math.PI) / 180;
    Matter.Body.setVelocity(cueBall, {
      x: Math.cos(aimRad) * speed,
      y: Math.sin(aimRad) * speed,
    });
    setCueVisible(false);
    shotInFlightRef.current = true;
  }, []);

  // Avatar AI: when it's avatar's turn, pick a target, animate the avatar's
  // own cue stick (fade-in → pullback → pause → snap), apply the impulse to
  // the cue ball. After the shot, the existing RAF rest-detection swaps the
  // turn back to player. No physics is paused; cue ball gets a real shot.
  useEffect(() => {
    if (turn !== "avatar" || gameOver) return;
    let cancelled = false;

    const run = async () => {
      // Thinking pause before the cue appears
      await delay(AVATAR_THINKING_MS);
      if (cancelled) return;

      const cueBallBody = cueBallBodyRef.current;
      const world = worldRef.current;
      if (!cueBallBody || !world) return;
      const cuePos: Vec = {
        x: cueBallBody.position.x,
        y: cueBallBody.position.y,
      };

      // Gather candidate balls — exclude pocketed + cue ball, exclude 8-ball
      // unless it's the only ball left.
      const allOnTable = RACK.map((meta, i) => ({
        meta,
        body: ballBodiesRef.current[i],
      })).filter(
        (b) =>
          b.body !== undefined &&
          !removedFromPhysicsRef.current.has(b.meta.number)
      );
      const nonEightCandidates = allOnTable.filter(
        (b) => b.meta.number !== 8
      );
      const candidates =
        nonEightCandidates.length > 0 ? nonEightCandidates : allOnTable;

      if (candidates.length === 0) {
        // Nothing to shoot at — fall back to a turn swap.
        turnRef.current = "player";
        setTurn("player");
        return;
      }

      // Score each candidate. Weights are deliberate:
      //   - Pocket alignment dominates (was +50, now +150 base)
      //   - Sharpness within ±10° adds an extra +75 on top
      //   - Obstructions are a near-veto (-500 each, was -40)
      //   - Distance penalty is gentle (-0.01/unit, was -0.05)
      // Best score wins, ties broken randomly.
      type ShotPlan = {
        meta: RackBall;
        targetPos: Vec;
        distance: number;
        pocket: { x: number; y: number; label: string } | null;
        pocketToTargetDistance: number; // 0 if no aligned pocket
        bestPocketDiffDeg: number;
        pocketAligned: boolean;
        obstructions: number;
        score: number;
      };
      const plans: ShotPlan[] = candidates.map((c) => {
        const tp: Vec = { x: c.body.position.x, y: c.body.position.y };
        const distance = Math.hypot(tp.x - cuePos.x, tp.y - cuePos.y);

        const cueToTargetAng = Math.atan2(
          tp.y - cuePos.y,
          tp.x - cuePos.x
        );
        let bestPocket: ShotPlan["pocket"] = null;
        let bestPocketDiff = Infinity;
        for (const p of POCKETS) {
          const targetToPocketAng = Math.atan2(
            p.y - tp.y,
            p.x - tp.x
          );
          const diff = Math.abs(
            (angleDiff(cueToTargetAng, targetToPocketAng) * 180) / Math.PI
          );
          if (diff < bestPocketDiff) {
            bestPocketDiff = diff;
            if (diff < POCKET_ALIGN_TOLERANCE_DEG) bestPocket = p;
          }
        }
        const pocketAligned = bestPocket !== null;
        const pocketToTargetDistance = bestPocket
          ? Math.hypot(bestPocket.x - tp.x, bestPocket.y - tp.y)
          : 0;

        const obstructions = allOnTable.filter(
          (other) =>
            other.meta.number !== c.meta.number &&
            isObstructing(cuePos, tp, {
              x: other.body.position.x,
              y: other.body.position.y,
            })
        ).length;

        let score = 100;
        score -= distance * 0.01;             // gentle distance penalty
        score -= obstructions * 500;          // hard veto
        if (pocketAligned) {
          score += 150;                        // dominant alignment bonus
          if (bestPocketDiff < POCKET_SHARP_TOLERANCE_DEG) {
            // Linear ramp: 0° → +75, 10° → 0
            score += 75 * (1 - bestPocketDiff / POCKET_SHARP_TOLERANCE_DEG);
          }
        }

        return {
          meta: c.meta,
          targetPos: tp,
          distance,
          pocket: bestPocket,
          pocketToTargetDistance,
          bestPocketDiffDeg: bestPocketDiff,
          pocketAligned,
          obstructions,
          score,
        };
      });

      // Pick best, random tiebreaker.
      const topScore = Math.max(...plans.map((p) => p.score));
      const winners = plans.filter((p) => p.score >= topScore - 0.01);
      const chosen = winners[Math.floor(Math.random() * winners.length)];

      // Top 3 candidates for visibility into scoring decisions.
      const top3 = [...plans]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(
          (p) =>
            `#${p.meta.number}=${p.score.toFixed(1)} (aligned:${p.pocketAligned}, sharp:${p.bestPocketDiffDeg.toFixed(1)}°, obs:${p.obstructions})`
        );
      console.log(`[avatar] candidate scores: ${top3.join(" | ")}`);

      console.log(
        `[avatar] picking target: ball ${chosen.meta.number} (distance ${chosen.distance.toFixed(0)}, pocket-aligned: ${chosen.pocketAligned})`
      );

      // Ghost ball position: where the cue ball center must arrive for the
      // contact face to point straight at the pocket. Computed once and
      // shared by both the aim vector and the force calc.
      //
      //   ghost = target + 2r * normalize(target - pocket)
      //
      // Only meaningful for pocket-aligned shots; for safety shots we aim
      // at the target center.
      let ghostBallPos: Vec | null = null;
      let cueToGhostDistance = chosen.distance;
      let aimRad: number;
      if (chosen.pocket) {
        const targetToPocketAng = Math.atan2(
          chosen.pocket.y - chosen.targetPos.y,
          chosen.pocket.x - chosen.targetPos.x
        );
        ghostBallPos = {
          x:
            chosen.targetPos.x - 2 * BALL_RADIUS * Math.cos(targetToPocketAng),
          y:
            chosen.targetPos.y - 2 * BALL_RADIUS * Math.sin(targetToPocketAng),
        };
        cueToGhostDistance = Math.hypot(
          ghostBallPos.x - cuePos.x,
          ghostBallPos.y - cuePos.y
        );
        aimRad = Math.atan2(
          ghostBallPos.y - cuePos.y,
          ghostBallPos.x - cuePos.x
        );
      } else {
        aimRad = Math.atan2(
          chosen.targetPos.y - cuePos.y,
          chosen.targetPos.x - cuePos.x
        );
      }

      // Random aim error applied to the (already-ghost-ball-corrected) aim.
      // Tighter when the avatar has a clear pocket-aligned shot, looser on
      // fallback / safety shots.
      const aimErrorRange = chosen.pocketAligned
        ? AIM_ERROR_DEG_ALIGNED
        : AIM_ERROR_DEG_SAFETY;
      const errorDeg = (Math.random() * 2 - 1) * aimErrorRange;
      const errorRad = (errorDeg * Math.PI) / 180;
      const aimWithErrorRad = aimRad + errorRad;
      const aimWithErrorDeg = (aimWithErrorRad * 180) / Math.PI;

      console.log(
        `[avatar] aim angle: ${aimWithErrorDeg.toFixed(1)} degrees (with ${errorDeg.toFixed(1)} degrees random error)`
      );

      // Force:
      //   - Pocket-aligned: cue ball must travel cue→ghost, then transfer
      //     enough energy that the target reaches the pocket. Energy transfer
      //     in this physics model loses ~50% in the collision, so weight the
      //     post-collision travel (target→pocket) 2x. Then a 1.3x safety
      //     margin so the target isn't crawling when it reaches the pocket.
      //   - Safety / fallback: gentle disturbance, don't blast the cluster.
      let baseForceLevel: number;
      if (chosen.pocketAligned) {
        const totalTravel =
          (cueToGhostDistance +
            chosen.pocketToTargetDistance * POST_COLLISION_ENERGY_FACTOR) *
          POCKETING_SAFETY_MARGIN;
        baseForceLevel =
          MIN_FORCE_LEVEL +
          (totalTravel / TABLE_DIAGONAL) *
            (MAX_FORCE_LEVEL - MIN_FORCE_LEVEL);
      } else {
        baseForceLevel = SAFETY_FORCE_LEVEL;
      }
      baseForceLevel = Math.min(
        MAX_FORCE_LEVEL,
        Math.max(MIN_FORCE_LEVEL, baseForceLevel)
      );
      const varianceMul = 1 + (Math.random() * 2 - 1) * FORCE_VARIANCE;
      const forceLevel = Math.min(
        MAX_FORCE_LEVEL,
        Math.max(0.2, baseForceLevel * varianceMul)
      );
      const pullbackPx = forceLevel * PULLBACK_MAX;
      const speed = forceLevel * MAX_SHOT_SPEED;

      console.log(`[avatar] force magnitude: ${speed.toFixed(2)}`);
      if (ghostBallPos && chosen.pocket) {
        console.log(
          `[avatar] ghost ball at (${ghostBallPos.x.toFixed(0)}, ${ghostBallPos.y.toFixed(0)}), pocket at (${chosen.pocket.x.toFixed(0)}, ${chosen.pocket.y.toFixed(0)}), force=${speed.toFixed(2)}, expected travel target→pocket=${chosen.pocketToTargetDistance.toFixed(0)}`
        );
      }

      // Avatar cue stick uses the same orientation convention as the player's:
      // cueAngle = aim direction + 90° (cue body opposite the shot direction).
      const cueAngleDeg = aimWithErrorDeg + 90;
      avatarCueAngle.set(cueAngleDeg);
      avatarCuePullback.set(0);
      setAvatarCueVisible(true);

      // Phase: fade-in (handled by CueStick's opacity transition)
      await delay(AVATAR_FADE_IN_MS);
      if (cancelled) return;

      // Phase: pull back over AVATAR_PULLBACK_MS with ease-out
      const pullAnim = animate(avatarCuePullback, pullbackPx, {
        duration: AVATAR_PULLBACK_MS / 1000,
        ease: "easeOut",
      });
      await pullAnim;
      if (cancelled) {
        pullAnim.stop();
        return;
      }

      // Phase: pause at full pullback
      await delay(AVATAR_PAUSE_MS);
      if (cancelled) return;

      // Phase: snap forward into cue ball
      const snapAnim = animate(avatarCuePullback, 0, {
        duration: AVATAR_SNAP_MS / 1000,
        ease: "easeIn",
      });
      await snapAnim;
      if (cancelled) {
        snapAnim.stop();
        return;
      }

      // Contact: apply the impulse and hide the avatar cue.
      const cueBallNow = cueBallBodyRef.current;
      if (
        cueBallNow &&
        cueBallStatusRef.current === "active" &&
        !shotInFlightRef.current
      ) {
        Matter.Body.setVelocity(cueBallNow, {
          x: Math.cos(aimWithErrorRad) * speed,
          y: Math.sin(aimWithErrorRad) * speed,
        });
        shotInFlightRef.current = true;
      }
      setAvatarCueVisible(false);
    };

    run();

    return () => {
      cancelled = true;
      setAvatarCueVisible(false);
      avatarCuePullback.set(0);
    };
  }, [turn, gameOver, avatarCueAngle, avatarCuePullback]);

  // Debug: log turn whenever it changes.
  useEffect(() => {
    console.log("[snooker]", `turn=${turn}`);
  }, [turn]);

  // Auto-taunt: avatar speaks a random line at the start of its turn and the
  // bubble persists until ~500ms after the turn swaps back to the player.
  // Skipped during gameOver — the GAME OVER overlay handles end-of-game UX.
  useEffect(() => {
    if (gameOver) return;
    if (turn === "avatar") {
      const showTimer = setTimeout(() => {
        let pick = Math.floor(Math.random() * TAUNTS.length);
        // Single re-roll if it matches the previous avatar taunt.
        if (pick === lastAvatarTauntRef.current) {
          pick = Math.floor(Math.random() * TAUNTS.length);
        }
        lastAvatarTauntRef.current = pick;
        setTauntIndex(pick);
        setBubbleVisible(true);
      }, 150);
      return () => clearTimeout(showTimer);
    }
    // turn === "player": fade the bubble out after a beat so the user has
    // a moment to register the turn change. SpeechBubble handles the fade.
    const hideTimer = setTimeout(() => {
      setBubbleVisible(false);
    }, 300);
    return () => clearTimeout(hideTimer);
  }, [turn, gameOver]);

  const { cueAngle, aimAngle, pullback, isHovering, isAiming, bind } =
    useCueAim(
      tableRef,
      positions.cueBall.x,
      positions.cueBall.y,
      { onShoot: handleShoot }
    );

  const handleTaunt = () => {
    // During the avatar's turn the auto-trigger owns the bubble — clicks
    // are no-ops so they can't fight the timed show/hide.
    if (turn === "avatar") return;
    if (!bubbleVisible) {
      setBubbleVisible(true);
    } else {
      setTauntIndex((i) => (i + 1) % TAUNTS.length);
    }
  };

  // Matter.js engine setup
  useEffect(() => {
    const engine = Matter.Engine.create();
    engine.gravity.scale = 0;
    const world = engine.world;
    worldRef.current = world;

    const ballBodies = RACK.map((b) =>
      Matter.Bodies.circle(
        (b.x / 100) * PHYS_W,
        (b.y / 100) * PHYS_H,
        BALL_RADIUS,
        {
          restitution: 0.9,
          friction: 0.001,
          frictionAir: 0.012,
          density: 0.001,
          label: `ball-${b.number}`,
        }
      )
    );
    const cueBallBody = Matter.Bodies.circle(
      (CUE_BALL_INITIAL.x / 100) * PHYS_W,
      (CUE_BALL_INITIAL.y / 100) * PHYS_H,
      BALL_RADIUS,
      {
        restitution: 0.9,
        friction: 0.001,
        frictionAir: 0.012,
        density: 0.001,
        label: "cue-ball",
      }
    );
    ballBodiesRef.current = ballBodies;
    cueBallBodyRef.current = cueBallBody;

    const cushionOpts = { isStatic: true, restitution: 0.8, friction: 0.05 };
    const playW = PHYS_W - 2 * CUSHION_INSET_X;
    const playH = PHYS_H - 2 * CUSHION_INSET_Y;
    const cushionTop = Matter.Bodies.rectangle(
      PHYS_W / 2,
      CUSHION_INSET_Y - CUSHION_THICKNESS / 2,
      playW + CUSHION_THICKNESS * 2,
      CUSHION_THICKNESS,
      cushionOpts
    );
    const cushionBottom = Matter.Bodies.rectangle(
      PHYS_W / 2,
      PHYS_H - CUSHION_INSET_Y + CUSHION_THICKNESS / 2,
      playW + CUSHION_THICKNESS * 2,
      CUSHION_THICKNESS,
      cushionOpts
    );
    const cushionLeft = Matter.Bodies.rectangle(
      CUSHION_INSET_X - CUSHION_THICKNESS / 2,
      PHYS_H / 2,
      CUSHION_THICKNESS,
      playH + CUSHION_THICKNESS * 2,
      cushionOpts
    );
    const cushionRight = Matter.Bodies.rectangle(
      PHYS_W - CUSHION_INSET_X + CUSHION_THICKNESS / 2,
      PHYS_H / 2,
      CUSHION_THICKNESS,
      playH + CUSHION_THICKNESS * 2,
      cushionOpts
    );

    // Pocket sensors — invisible, do not block balls, just detect entry.
    const pocketBodies = POCKETS.map((p) =>
      Matter.Bodies.circle(p.x, p.y, POCKET_RADIUS, {
        isStatic: true,
        isSensor: true,
        label: p.label,
      })
    );

    Matter.World.add(world, [
      ...ballBodies,
      cueBallBody,
      cushionTop,
      cushionBottom,
      cushionLeft,
      cushionRight,
      ...pocketBodies,
    ]);

    // --- Pocket helpers ---
    const pocketNumberedBall = (num: number, body: Matter.Body) => {
      if (removedFromPhysicsRef.current.has(num)) return;
      removedFromPhysicsRef.current.add(num);
      if (num === 8) {
        gameOverPendingRef.current = true;
      }
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.World.remove(world, body);
      setDroppingNumbers((prev) => {
        const next = new Set(prev);
        next.add(num);
        return next;
      });
      const t = setTimeout(() => {
        setDroppingNumbers((prev) => {
          const next = new Set(prev);
          next.delete(num);
          return next;
        });
        setPocketedNumbers((prev) => {
          const next = new Set(prev);
          next.add(num);
          return next;
        });
        dropTimeoutsRef.current.delete(num);
      }, DROP_ANIM_MS);
      dropTimeoutsRef.current.set(num, t);
    };

    const pocketCueBall = (body: Matter.Body) => {
      if (cueBallStatusRef.current !== "active") return;
      cueBallStatusRef.current = "dropping";
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.World.remove(world, body);
      setCueBallStatus("dropping");
      cueDropTimeoutRef.current = setTimeout(() => {
        cueBallStatusRef.current = "respawning";
        setCueBallStatus("respawning");
        cueDropTimeoutRef.current = null;
        // Actual respawn (teleport + re-add to world) happens in the RAF loop
        // once all other balls have come to rest.
      }, DROP_ANIM_MS);
    };

    // --- Collision detection ---
    const onCollisionStart = (event: Matter.IEventCollision<Matter.Engine>) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        const a = bodyA.label;
        const b = bodyB.label;
        const aIsPocket = a.startsWith("pocket-");
        const bIsPocket = b.startsWith("pocket-");
        if (aIsPocket === bIsPocket) continue;
        const pocketBody = aIsPocket ? bodyA : bodyB;
        const ballBody = aIsPocket ? bodyB : bodyA;
        const ballLabel = ballBody.label;
        if (ballLabel === "cue-ball") {
          pocketCueBall(ballBody);
        } else if (ballLabel.startsWith("ball-")) {
          const num = parseInt(ballLabel.slice(5), 10);
          pocketNumberedBall(num, ballBody);
        }
        // Silence unused var warning
        void pocketBody;
      }
    };
    Matter.Events.on(engine, "collisionStart", onCollisionStart);

    // --- RAF loop ---
    let rafId = 0;
    let cancelled = false;
    let lastT = performance.now();

    const allBodies = [...ballBodies, cueBallBody];
    const isAtRest = () =>
      allBodies.every((b) => {
        const v = b.velocity;
        return Math.hypot(v.x, v.y) < REST_VELOCITY_THRESHOLD;
      });

    const respawnCueBall = () => {
      const cb = cueBallBodyRef.current;
      if (!cb || !worldRef.current) return;
      Matter.Body.setPosition(cb, {
        x: (CUE_BALL_INITIAL.x / 100) * PHYS_W,
        y: (CUE_BALL_INITIAL.y / 100) * PHYS_H,
      });
      Matter.Body.setVelocity(cb, { x: 0, y: 0 });
      Matter.World.add(worldRef.current, cb);
      cueBallStatusRef.current = "active";
      setCueBallStatus("active");
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(now - lastT, 32);
      lastT = now;
      Matter.Engine.update(engine, dt);

      setPositions({
        balls: ballBodies.map((b) => ({
          x: (b.position.x / PHYS_W) * 100,
          y: (b.position.y / PHYS_H) * 100,
        })),
        cueBall: {
          x: (cueBallBody.position.x / PHYS_W) * 100,
          y: (cueBallBody.position.y / PHYS_H) * 100,
        },
      });

      if (shotInFlightRef.current && isAtRest()) {
        const status = cueBallStatusRef.current;
        if (status === "dropping") {
          // Wait until the drop animation marks the cue ball as 'respawning'.
        } else {
          if (status === "respawning") {
            respawnCueBall();
          }
          shotInFlightRef.current = false;
          const shooter = turnRef.current;

          if (gameOverPendingRef.current) {
            // 8-ball was pocketed this shot — overlay text uses shooter.
            setGameOverShooter(shooter);
            setGameOver(true);
          } else {
            // Strict alternation: turn ALWAYS swaps after any non-game-over
            // shot. No conditions.
            const nextTurn: Turn = shooter === "player" ? "avatar" : "player";
            turnRef.current = nextTurn;
            setTurn(nextTurn);
            setCueVisible(true);
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      Matter.Events.off(engine, "collisionStart", onCollisionStart);
      dropTimeoutsRef.current.forEach((t) => clearTimeout(t));
      dropTimeoutsRef.current.clear();
      if (cueDropTimeoutRef.current) clearTimeout(cueDropTimeoutRef.current);
      cueDropTimeoutRef.current = null;
      removedFromPhysicsRef.current.clear();
      cueBallStatusRef.current = "active";
      gameOverPendingRef.current = false;
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
      worldRef.current = null;
      ballBodiesRef.current = [];
      cueBallBodyRef.current = null;
    };
  }, []);

  const handleReset = useCallback(() => {
    const world = worldRef.current;
    const cueBall = cueBallBodyRef.current;
    if (!world || !cueBall) return;

    // Re-rack all 15 numbered balls at their original positions.
    RACK.forEach((meta, i) => {
      const body = ballBodiesRef.current[i];
      if (!body) return;
      Matter.Body.setPosition(body, {
        x: (meta.x / 100) * PHYS_W,
        y: (meta.y / 100) * PHYS_H,
      });
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(body, 0);
      if (removedFromPhysicsRef.current.has(meta.number)) {
        Matter.World.add(world, body);
      }
    });

    // Respawn cue ball at its original starting position.
    Matter.Body.setPosition(cueBall, {
      x: (CUE_BALL_INITIAL.x / 100) * PHYS_W,
      y: (CUE_BALL_INITIAL.y / 100) * PHYS_H,
    });
    Matter.Body.setVelocity(cueBall, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(cueBall, 0);
    if (cueBallStatusRef.current !== "active") {
      Matter.World.add(world, cueBall);
      cueBallStatusRef.current = "active";
      setCueBallStatus("active");
    }

    // Clear all pocket/shot/game-over state.
    removedFromPhysicsRef.current.clear();
    gameOverPendingRef.current = false;
    shotInFlightRef.current = false;
    setPocketedNumbers(new Set());
    setDroppingNumbers(new Set());
    setGameOver(false);
    setGameOverShooter(null);
    setCueVisible(true);
    setAvatarCueVisible(false);
    avatarCuePullback.set(0);
    avatarCueAngle.set(0);
    // Player always breaks the rack.
    turnRef.current = "player";
    setTurn("player");
  }, [avatarCueAngle, avatarCuePullback]);

  const showCueBall = cueBallStatus !== "respawning";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.4, ease: "easeOut" }}
      className="pb-12 mx-auto"
      style={{
        maxWidth: "min(400px, calc((100vh - 220px) / 1.79))",
        width: "100%",
      }}
    >
      <div
        ref={tableRef}
        className="relative mx-auto"
        style={{
          aspectRatio: "768 / 1376",
          width: "100%",
        }}
      >
        <Image
          src="/images/snooker-table.png"
          alt="painted snooker table"
          fill
          priority
          unoptimized
          sizes="(min-width: 768px) 360px, 0px"
          style={{
            objectFit: "contain",
            zIndex: 10,
            pointerEvents: "none",
          }}
        />
        {positions.balls.map((pos, i) => {
          const meta = RACK[i];
          if (pocketedNumbers.has(meta.number)) return null;
          return (
            <Ball
              key={meta.number}
              number={meta.number}
              x={pos.x}
              y={pos.y}
              color={meta.color}
              isStriped={meta.isStriped}
              dropping={droppingNumbers.has(meta.number)}
            />
          );
        })}
        <AimGuide
          aimAngle={aimAngle}
          visible={isAiming}
          cueBallX={positions.cueBall.x}
          cueBallY={positions.cueBall.y}
        />
        <CueStick
          angle={cueAngle}
          pullback={pullback}
          x={positions.cueBall.x}
          y={positions.cueBall.y}
          visible={cueVisible && turn === "player" && !gameOver}
        />
        <CueStick
          angle={avatarCueAngle}
          pullback={avatarCuePullback}
          x={positions.cueBall.x}
          y={positions.cueBall.y}
          visible={avatarCueVisible && turn === "avatar" && !gameOver}
          variant="avatar"
        />
        {showCueBall && (
          <Ball
            x={positions.cueBall.x}
            y={positions.cueBall.y}
            color="#FFF5EF"
            isCueBall
            dropping={cueBallStatus === "dropping"}
          />
        )}

        {/* Speech bubble — positioned independently of the avatar wrapper so
            its width can be capped by viewport rather than the narrow 25%
            avatar column. Centered on the table (which is itself centered
            in the viewport via mx-auto), so the bubble is always centered
            in the viewport — neither edge can extend past it. */}
        {bubbleVisible && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: "calc(92% + 64px)",
              transform: "translateX(-50%)",
              zIndex: 40,
              pointerEvents: "none",
              // Bubble sizes to content (max-content via SpeechBubble) but is
              // hard-capped at the viewport. calc(100vw - 32px) ensures 16px
              // of breathing room on each side on any phone width.
              width: "max-content",
              maxWidth: "min(260px, calc(100vw - 32px))",
            }}
          >
            <SpeechBubble
              text={TAUNTS[tauntIndex]}
              visible={true}
            />
          </div>
        )}

        {/* Avatar — same positioning as before, no bubble inside */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "92%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "25%",
            zIndex: 5,
          }}
        >
          <Avatar onClick={handleTaunt} />
        </div>

        {/* Aim capture overlay — disabled when it's not the player's turn
            or when the game-over overlay is showing. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            cursor:
              turn === "player" && !gameOver && isHovering
                ? "crosshair"
                : "default",
            pointerEvents:
              turn === "player" && !gameOver ? "auto" : "none",
            // Prevents the browser from interpreting drag-to-aim as page
            // scroll or pinch-zoom on touch devices — required for iOS,
            // which is aggressive about hijacking vertical drags.
            touchAction: "none",
            zIndex: 50,
          }}
          {...bind}
        />

        {/* GAME OVER overlay — appears when 8-ball is pocketed and balls rest */}
        <AnimatePresence>
          {gameOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "14px",
                padding: "24px",
                zIndex: 60,
                pointerEvents: "none",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--font-serif), serif",
                  fontSize: "32px",
                  color: "#FFF5EF",
                  fontWeight: 400,
                  letterSpacing: "0.02em",
                  margin: 0,
                  textAlign: "center",
                  textShadow: "0 2px 12px rgba(30, 30, 30, 0.4)",
                }}
              >
                GAME OVER
              </h2>
              <p
                style={{
                  fontFamily: "var(--font-sans), sans-serif",
                  fontSize: "13px",
                  color: "#FFF5EF",
                  opacity: 0.85,
                  margin: 0,
                  textAlign: "center",
                  textShadow: "0 2px 12px rgba(30, 30, 30, 0.4)",
                }}
              >
                {gameOverShooter === "avatar"
                  ? "the avatar potted the 8 ball"
                  : "you potted the 8 ball"}
              </p>
              <button
                type="button"
                onClick={handleReset}
                style={{
                  marginTop: "8px",
                  fontFamily: "var(--font-sans), sans-serif",
                  backgroundColor: "#C97836",
                  color: "#FFF5EF",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  border: "none",
                  cursor: "pointer",
                  pointerEvents: "auto",
                }}
              >
                rack &apos;em up again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
