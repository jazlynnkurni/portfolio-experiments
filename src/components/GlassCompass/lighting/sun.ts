import * as THREE from "three";
import { HOVER, SUN } from "../config";

// Shared motion state. Shaders hold these objects as uniform values, so
// updating them here updates every frame that is drawn next.

export const sunDirection = new THREE.Vector3(); // unit vector toward the sun

type Pose = { minute: number; hour: number; orbit: number; p: number };

const TURN = 2 * Math.PI;
const zero = (): Pose => ({ minute: 0, hour: 0, orbit: 0, p: 0 });

export const motion = {
  hovered: false,
  // rest: still. forward: hovered, the clock runs. settle: gliding home.
  // snap: home, springing into place.
  mode: "rest" as "rest" | "forward" | "settle" | "snap",
  idle: 0, // idle drift clock, seconds
  t: 0, // time in the current mode, seconds
  minute: 0, // red hand rotation from rest, radians (clockwise is negative)
  hour: 0, // silver hand
  orbit: 0, // sun's extra turn round the dial
  p: 0, // light-and-shadow strength, 0 at rest to 1 at full hover
  from: zero(), // pose the current mode started from
  dir: { minute: 0, hour: 0 }, // which way each hand was travelling home
};

export const motionUniforms = {
  causticBoost: { value: 0 },
  relief: { value: 0 }, // strength of per-element light and cast shadow
};

// Eased hover time: starts from rest (zero speed) and builds to full speed.
export function eased(t: number): number {
  const tau = HOVER.spinUpSec;
  return t - tau * (1 - Math.exp(-t / tau));
}

// Nearest equivalent angle to 0, so hands go home the shortest way round.
const wrap = (a: number) => a - TURN * Math.round(a / TURN);

// Glide home: starts gently, arrives still moving (so the snap has momentum).
const glide = (r: number) => r * r * (2 - r);

// Sun direction from the idle drift time, the hover orbit angle and how far
// the sun has sunk (radians).
export function setSun(idleT: number, orbit: number, drop = 0, out = sunDirection): THREE.Vector3 {
  const S = SUN;
  const phase = (2 * Math.PI * idleT) / S.sway.periodSec;
  // two incommensurate sines so the drift never reads as a loop
  const az = ((S.azimuthDeg + S.sway.azimuthDeg * Math.sin(phase)) * Math.PI) / 180 + orbit;
  const el = ((S.elevationDeg + S.sway.elevationDeg * Math.sin(phase * 0.618 + 1.3)) * Math.PI) / 180 - drop;
  return out.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
}

const pose = (): Pose => ({ minute: motion.minute, hour: motion.hour, orbit: motion.orbit, p: motion.p });

// Advances every motion by dt seconds. Returns true while anything moves.
export function stepMotion(dt: number): boolean {
  const H = HOVER;
  const m = motion;

  if (m.hovered) {
    // start (or resume) from wherever things are, with no jump
    if (m.mode !== "forward") {
      m.mode = "forward";
      m.t = 0;
      m.from = pose();
    }
    m.t += dt * H.speed;
    const e = eased(m.t);
    m.minute = m.from.minute - (TURN * e) / H.minuteRevSec;
    m.hour = m.from.hour - (TURN * e) / H.hourRevSec;
    m.orbit = m.from.orbit - (TURN * e) / H.sunOrbitRevSec;
    m.p = m.from.p + (1 - m.from.p) * (1 - Math.exp(-m.t / H.spinUpSec));
  } else if (m.mode === "forward" || m.mode === "settle") {
    if (m.mode === "forward") {
      m.mode = "settle";
      m.t = 0;
      m.from = { minute: wrap(m.minute), hour: wrap(m.hour), orbit: wrap(m.orbit), p: m.p };
      m.dir = { minute: -Math.sign(m.from.minute), hour: -Math.sign(m.from.hour) };
    }
    m.t += dt;
    const r = Math.min(1, m.t / H.settleSec);
    const k = 1 - glide(r);
    m.minute = m.from.minute * k;
    m.hour = m.from.hour * k;
    m.orbit = m.from.orbit * k;
    m.p = m.from.p * k;
    if (r >= 1) {
      m.mode = "snap";
      m.t = 0;
    }
  } else if (m.mode === "snap") {
    // damped spring about rest: overshoot past home in the direction of
    // travel, spring back, settle
    const S = H.snap;
    m.t += dt;
    const a =
      ((S.overshootDeg * Math.PI) / 180) * Math.exp(-m.t / S.decaySec) * Math.sin((TURN * m.t) / S.periodSec);
    m.minute = m.dir.minute * a;
    m.hour = m.dir.hour * a * 0.6;
    m.orbit = 0;
    m.p = 0;
    if (m.t >= S.durationSec) {
      m.mode = "rest";
      m.minute = m.hour = 0;
    }
  }

  applyUniforms();
  return m.mode !== "rest";
}

// Pushes the current pose into the sun and the shader uniforms.
export function applyUniforms(): void {
  const H = HOVER;
  motionUniforms.causticBoost.value = H.causticBoost * motion.p;
  motionUniforms.relief.value = H.relief.rest + (H.relief.hover - H.relief.rest) * motion.p;
  setSun(motion.idle, motion.orbit, (H.sunDropDeg * Math.PI * motion.p) / 180);
}

// Rest pose at idle time t.
export function setSunAt(t: number, out = sunDirection): THREE.Vector3 {
  return setSun(t, 0, 0, out);
}

applyUniforms();
