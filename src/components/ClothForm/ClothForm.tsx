"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bodies, Body, Composite, Constraint, Engine } from "matter-js";
import { RED, weaveCell } from "@/components/FabricSkin/skin";
import styles from "./ClothForm.module.css";

/**
 * ClothForm - one sheet of cloth that falls into the shape of a staircase, a
 * chair or a sink, and holds it.
 *
 * WHAT THE REFERENCE ACTUALLY SHOWS. Nothing in those photographs is draped.
 * The cloth is not lying over a hidden object, and it is not sagging anywhere.
 * It IS the object: taut, complete, dimensional, holding every step and hinge
 * and tap in the air with nothing inside it. So the physics has to end
 * somewhere very specific. The drop is only how the piece arrives. What it
 * lands as is the object itself, and once it is there it stays there, breathing
 * a little, giving a little between its seams, and otherwise holding.
 *
 * ONE SHEET, THREE SHAPES. Every form here is a closed profile extruded through
 * its own depth, which means one grid of yarns can carry all three: the same
 * particles, the same weave, wrapped a different way. That is how these things
 * are actually made, a flat panel folded and stitched into a solid, and it is
 * why switching form can be a fall rather than a cut. The anchors let go, the
 * cloth loses the staircase and drops, and it is caught into the chair.
 *
 * FALLING INTO SHAPE, IN ORDER. Every vertex has an anchor to where it belongs
 * in the projected form, and those anchors engage staggered by height: the hem
 * catches first and the top last, because that is the order a falling sheet
 * meets anything. Until an anchor engages, its vertex is in free fall with a
 * lot of air drag, which is what makes the arrival read as cloth and not as an
 * animation curve.
 *
 * THE YARNS HOLD THE SHAPE, THE ANCHORS ONLY SUGGEST IT. Yarn rest lengths are
 * rewritten every frame from the projection, so the weave is always being told
 * the current silhouette, while the anchors are soft. That gap is where the
 * fabric lives: a taut span across the top of a step, a little give in the
 * middle of a panel, and the whole piece arriving a beat late when you turn it.
 *
 * TWO LAYERS, NOT ONE. The form is a closed tube, so its front wall and its
 * back wall both land in the picture. Filling front and back separately in
 * multiply is what makes the far side of the object show through the near side
 * and go deeper where they cross, which is the whole reason these things look
 * like they are made of light rather than lines.
 */

type FormName = "staircase" | "chair" | "sink";

type ClothFormProps = {
  variant?: "full" | "embed";
  form?: FormName;
  /** yarns around the profile. more is finer cloth and more solver work */
  threads?: number;
  /** how much the cloth gives between its seams once it has landed */
  give?: number;
  /** strength of the draught in the room, 0 still .. 1 a window left open */
  wind?: number;
  /** seconds from release to fully formed. long, because the fall is the piece */
  fallTime?: number;
  /** how much light the threads carry, 0 flat .. 1 lit from inside */
  glow?: number;
  /** the reeded glass in front of it, 0 none .. 1 heavy */
  glass?: number;
  className?: string;
};

const PAL = RED;

const NV = 9; // yarns through the depth of the piece
const FOCAL = 1150;

/* ---- the glass in front of the piece ---- */
const REED = 54; // pitch of the reeding, in css px
const REED_AMP = 8; // how far a reed throws the image at its edge
const STRIPS = 110; // slices the refraction is sampled in, per frame
const HAZE = 9; // blur radius of the layer that hangs off everything

const W_STRUCT = 1.5;
const W_HAIR = 0.5;
const A_STRUCT = 0.24;
const A_HAIR = 0.1;
const A_BLOOM = 0.045;
/**
 * Gauge. Suh's pieces are polyester organza, a fabric once used for Korean
 * summer wear, and it has a thread count: the mesh is the same fineness
 * everywhere on the piece whether that patch is stretched or bunched, and it
 * only gets finer with distance because of perspective. So the drawn threads
 * are spaced in screen pixels, not divided into the simulated cell, and a cell
 * decides for itself how many it carries. That one change is the difference
 * between a mesh and a diagram of a mesh.
 */
const GAUGE = 5.5; // px between threads on screen
const GAUGE_MAX = 9; // ceiling per cell, so a huge cell cannot stall the frame

const SEAM_EVERY = 6; // profile corners that carry a structural seam

/**
 * The armature. These are built over a stainless steel frame and then stitched
 * to it, so there are two materials in every photograph and they do not read
 * alike: the cloth is soft and haloed, the wire behind it is thin and hard and
 * does not glow. Losing that contrast is what makes a recreation look like a
 * wireframe instead of like an object.
 */
const WIRE = "150, 22, 20";
const A_WIRE = 0.5;
const W_WIRE = 1.1;

/**
 * And the fittings, which is where the reference stops being a shape and starts
 * being a thing someone owns: a handrail with balusters, taps and a spout, the
 * stretchers between the legs of a chair. Unit box coordinates, x and y across
 * the same face as the profile, z as a fraction of the depth.
 */
const FITTINGS: Record<FormName, [number, number, number][][]> = {
  staircase: [
    // handrail down both faces, following the nosings a hand's height up
    ...[-0.5, 0.5].flatMap((z) => [
      [
        [0.1, -0.22, z],
        [0.87, 0.49, z],
      ] as [number, number, number][],
      ...[0, 1, 2, 3, 4, 5].map(
        (i) =>
          [
            [0.1 + i * 0.128, -0.22 + i * 0.118, z],
            [0.1 + i * 0.128, 0.08 + i * 0.118, z],
          ] as [number, number, number][],
      ),
    ]),
  ],
  chair: [
    // stretchers between the front and rear legs, both faces
    ...[-0.5, 0.5].map(
      (z) =>
        [
          [0.27, 0.82, z],
          [0.69, 0.82, z],
        ] as [number, number, number][],
    ),
    // and one across the back, through the depth
    [
      [0.69, 0.82, -0.5],
      [0.69, 0.82, 0.5],
    ],
  ],
  sink: [
    // two taps and the spout between them, standing off the back of the basin
    ...[0.36, 0.64].map(
      (x) =>
        [
          [x, 0.28, -0.28],
          [x, 0.19, -0.28],
          [x + 0.03, 0.16, -0.28],
        ] as [number, number, number][],
    ),
    [
      [0.5, 0.28, -0.28],
      [0.5, 0.14, -0.28],
      [0.5, 0.14, -0.08],
      [0.5, 0.18, -0.08],
    ],
    // the trap under the basin, which is the detail nobody expects to be there
    [
      [0.5, 0.45, 0],
      [0.5, 0.56, 0],
      [0.44, 0.6, 0],
      [0.5, 0.64, 0],
      [0.5, 0.72, 0],
    ],
  ],
};

/**
 * The piece hangs from the top of its own silhouette, so a draught does not
 * push it sideways, it swings it. That is a pendulum and it is worth solving as
 * one rather than tweening an angle: the restoring torque is gravity, the
 * period comes out of the length, and the gust only ever adds energy. Which is
 * why a real hanging piece keeps swinging for a while after the air goes still,
 * and why it never swings in time with anything.
 */
const SWING_W2 = 2.55; // gravity over pendulum length, so the period is ~3.9s
const SWING_DAMP = 0.55; // air, per second. low, because there is nothing else
const GUST = 0.5; // angular acceleration a full gust is worth

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** one deterministic number per thread, so the fall is the same every reload */
const hash = (a: number) => {
  const x = Math.sin(a * 127.1 + 3.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * The three profiles, drawn as closed loops in a unit box with y running down
 * the way it does on the canvas. Each is the silhouette a single panel of cloth
 * is folded around, so the loop has to close: it is one piece of fabric.
 */
const PROFILES: Record<FormName, { pts: [number, number][]; depth: number }> = {
  // a flight of six, seen from the side. the zigzag is the whole point, because
  // it is the one silhouette that cannot be mistaken for anything else
  staircase: {
    depth: 0.62,
    pts: (() => {
      const p: [number, number][] = [];
      const run = 0.128;
      const rise = 0.118;
      const x0 = 0.1;
      const y0 = 0.08;
      p.push([x0, y0]);
      for (let i = 0; i < 6; i++) {
        p.push([x0 + (i + 1) * run, y0 + i * rise]);
        p.push([x0 + (i + 1) * run, y0 + (i + 1) * rise]);
      }
      p.push([x0 + 6 * run, 0.94]);
      p.push([x0, 0.94]);
      return p;
    })(),
  },
  // a side elevation with the gap under the seat left open, which is what makes
  // a chair read as a chair
  chair: {
    depth: 0.5,
    pts: [
      [0.6, 0.06],
      [0.73, 0.06],
      [0.73, 0.95],
      [0.65, 0.95],
      [0.65, 0.6],
      [0.31, 0.6],
      [0.31, 0.95],
      [0.23, 0.95],
      [0.23, 0.52],
      [0.6, 0.52],
    ],
  },
  // a pedestal basin, front on and symmetrical
  sink: {
    depth: 0.44,
    pts: [
      [0.16, 0.28],
      [0.84, 0.28],
      [0.82, 0.4],
      [0.6, 0.45],
      [0.57, 0.88],
      [0.7, 0.88],
      [0.7, 0.94],
      [0.3, 0.94],
      [0.3, 0.88],
      [0.43, 0.88],
      [0.4, 0.45],
      [0.18, 0.4],
    ],
  },
};

/**
 * Resamples a closed loop to n points at even arc length, and marks the ones
 * that landed on a real corner of the profile. Even spacing matters because the
 * yarns are all the same length in the cloth, and the corner marks matter
 * because a corner is where a seam goes.
 */
function resample(pts: [number, number][], n: number) {
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push(d);
    total += d;
  }
  const out: { x: number; y: number; corner: boolean }[] = [];
  const cornerAt = new Set<number>();
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    cornerAt.add(Math.round((acc / total) * n) % n);
    acc += segs[i];
  }
  for (let k = 0; k < n; k++) {
    const want = (k / n) * total;
    let run = 0;
    let i = 0;
    while (i < segs.length && run + segs[i] < want) {
      run += segs[i];
      i++;
    }
    const a = pts[i % pts.length];
    const b = pts[(i + 1) % pts.length];
    const f = segs[i % segs.length] > 0 ? (want - run) / segs[i % segs.length] : 0;
    out.push({
      x: a[0] + (b[0] - a[0]) * f,
      y: a[1] + (b[1] - a[1]) * f,
      corner: cornerAt.has(k),
    });
  }
  return out;
}

export default function ClothForm({
  variant = "full",
  form = "staircase",
  threads = 72,
  give = 0.5,
  wind = 0.6,
  fallTime = 6,
  glow = 0.7,
  glass = 0.65,
  className,
}: ClothFormProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState<FormName>(form);
  const [phase, setPhase] = useState<"falling" | "held">("falling");
  const [breeze, setBreeze] = useState(true);
  const want = useRef<FormName | null>(null);
  const breezeRef = useRef(breeze);
  useEffect(() => {
    breezeRef.current = breeze;
  }, [breeze]);

  const pick = useCallback((f: FormName) => {
    want.current = f;
    setLive(f);
    setPhase("falling");
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let teardown: (() => void) | null = null;

    const build = () => {
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      if (W < 40 || H < 40) return null;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;

      const NU = clamp(Math.round(threads), 24, 128);
      const n = NU * (NV + 1);
      const box = Math.min(W, H) * 0.86;
      const cx = W / 2;
      const cy = H * 0.48;

      // all three forms resampled onto the same grid, so one sheet of cloth can
      // carry any of them and fall from one into the next
      const shapes: Record<FormName, Float64Array> = {
        staircase: new Float64Array(n * 3),
        chair: new Float64Array(n * 3),
        sink: new Float64Array(n * 3),
      };
      const corners: Record<FormName, Uint8Array> = {
        staircase: new Uint8Array(NU),
        chair: new Uint8Array(NU),
        sink: new Uint8Array(NU),
      };
      (Object.keys(PROFILES) as FormName[]).forEach((name) => {
        const prof = PROFILES[name];
        const loop = resample(prof.pts, NU);
        const d = prof.depth * box;
        for (let u = 0; u < NU; u++) {
          if (loop[u].corner) corners[name][u] = 1;
          for (let v = 0; v <= NV; v++) {
            const i = (v * NU + u) * 3;
            shapes[name][i] = (loop[u].x - 0.5) * box;
            shapes[name][i + 1] = (loop[u].y - 0.5) * box;
            shapes[name][i + 2] = (v / NV - 0.5) * d;
          }
        }
      });

      const engine = Engine.create();
      engine.gravity.x = 0;
      engine.gravity.y = 0.55;
      engine.constraintIterations = 5;
      engine.positionIterations = 6;
      engine.velocityIterations = 5;

      const soft = 0.24 - clamp(give, 0, 1) * 0.19;
      const bodies: Body[] = [];
      const anchors: Constraint[] = [];
      const rest = new Float64Array(n * 2);
      const depth = new Float64Array(n);
      const engage = new Float64Array(n); // 0 top of the piece, 1 hem
      const delay = new Float64Array(n); // where in the fall this thread arrives

      for (let i = 0; i < n; i++) {
        const b = Bodies.circle(cx, cy, 2, {
          frictionAir: 0.085, // cloth is nearly all area, so drag dominates
          restitution: 0,
          collisionFilter: { group: 0, category: 2, mask: 0 },
        });
        Body.setMass(b, 1);
        bodies.push(b);
        anchors.push(
          Constraint.create({
            pointA: { x: cx, y: cy },
            bodyB: b,
            length: 0,
            stiffness: 0,
            damping: 0.16,
            render: { visible: false },
          }),
        );
      }

      const idx = (u: number, v: number) => v * NU + ((u + NU) % NU);
      type Yarn = { c: Constraint; a: number; b: number };
      const yarns: Yarn[] = [];
      const link = (a: number, b: number, stiffness: number, damping: number) => {
        yarns.push({
          c: Constraint.create({
            bodyA: bodies[a],
            bodyB: bodies[b],
            length: 1,
            stiffness,
            damping,
            render: { visible: false },
          }),
          a,
          b,
        });
      };
      for (let v = 0; v <= NV; v++) {
        for (let u = 0; u < NU; u++) {
          // weft runs round the profile and closes on itself, because the panel
          // is folded into a loop and stitched
          link(idx(u, v), idx(u + 1, v), 0.75, 0.06);
          if (v < NV) link(idx(u, v), idx(u, v + 1), 0.75, 0.06); // warp
          if (v < NV) {
            link(idx(u, v), idx(u + 1, v + 1), 0.2, 0.03); // bias
            link(idx(u + 1, v), idx(u, v + 1), 0.2, 0.03);
          }
          link(idx(u, v), idx(u + 2, v), 0.06, 0.02); // bending
          if (v < NV - 1) link(idx(u, v), idx(u, v + 2), 0.06, 0.02);
        }
      }
      Composite.add(engine.world, [...bodies, ...anchors, ...yarns.map((y) => y.c)]);

      /* ---- state ---- */
      let model: FormName = live;
      let fall = 0; // 0 released, 1 fully formed
      let swing = 0; // radians off plumb
      let swingV = 0;
      // the piece hangs from the top of its own silhouette
      let pivotY = 0;
      // the fittings, projected fresh every frame. they are steel, so they are
      // rigid: they ride the swing and the parallax but never the cloth solve
      let fitted: number[][] = [];
      let yaw = -0.3;
      let pitch = 0.08;
      let yawT = 0;
      let pitchT = 0;
      let held = -1;
      const grab = Constraint.create({
        pointA: { x: 0, y: 0 },
        bodyB: bodies[0],
        length: 0,
        stiffness: 0.06,
        damping: 0.2,
        render: { visible: false },
      });

      /** drops the sheet above where it belongs and lets go of every anchor */
      const release = () => {
        fall = 0;
        const S = shapes[model];
        // the hem catches first and the top last, because that is the order a
        // falling sheet meets anything. recomputed per form, since the hem of a
        // chair is not at the same height as the hem of a sink
        let lo = 1e9;
        let hi = -1e9;
        for (let i = 0; i < n; i++) {
          if (S[i * 3 + 1] < lo) lo = S[i * 3 + 1];
          if (S[i * 3 + 1] > hi) hi = S[i * 3 + 1];
        }
        pivotY = lo;
        for (let i = 0; i < n; i++) {
          const u = i % NU;
          const v = (i / NU) | 0;
          engage[i] = (S[i * 3 + 1] - lo) / Math.max(1, hi - lo);
          // when this vertex is caught. height decides most of it, since a
          // falling sheet meets the low things first, but every yarn round the
          // profile and every ring through the depth carries its own offset as
          // well. so the piece does not arrive as a sheet, it knits: one thread
          // lands, then a thread three along from it, and the weave closes up
          // between them
          delay[i] =
            (1 - engage[i]) * 0.36 + hash(u * 1.7) * 0.26 + hash(v * 3.1 + 11) * 0.12;
          // and whatever is caught last starts highest, so the whole thing
          // reads as a curtain of separate threads coming down in order
          Body.setPosition(bodies[i], {
            x: cx + S[i * 3] * 0.9 + (hash(u * 5.3) - 0.5) * box * 0.16,
            y: cy + S[i * 3 + 1] - H * (0.5 + delay[i] * 1.5),
          });
          Body.setVelocity(bodies[i], { x: 0, y: 0 });
        }
      };
      release();

      const local = (ev: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top };
      };
      const onMove = (ev: PointerEvent) => {
        const p = local(ev);
        yawT = ((p.x / W) * 2 - 1) * 0.34;
        pitchT = ((p.y / H) * 2 - 1) * 0.13;
        if (held >= 0) {
          grab.pointA.x = p.x;
          grab.pointA.y = p.y;
        }
      };
      const onDown = (ev: PointerEvent) => {
        const p = local(ev);
        let best = -1;
        let bd = 40 * 40;
        for (let i = 0; i < n; i++) {
          const dx = bodies[i].position.x - p.x;
          const dy = bodies[i].position.y - p.y;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (best < 0) return;
        held = best;
        grab.bodyB = bodies[best];
        grab.pointA.x = p.x;
        grab.pointA.y = p.y;
        Composite.add(engine.world, grab);
        canvas.setPointerCapture(ev.pointerId);
      };
      const onUp = () => {
        if (held < 0) return;
        held = -1;
        Composite.remove(engine.world, grab);
      };
      const onLeave = () => {
        yawT = 0;
        pitchT = 0;
      };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointerleave", onLeave);

      const t0 = performance.now();
      let last = t0;
      let told = false;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = clamp(now - last, 8, 32);
        last = now;
        const t = (now - t0) / 1000;

        if (want.current) {
          // the cloth does not cut from one object to the next. it lets go of
          // the one it is holding, falls, and is caught by the other
          model = want.current;
          want.current = null;
          told = false;
          release();
        }

        fall = Math.min(1, fall + dt / (Math.max(0.5, fallTime) * 1000));
        // barely any gravity while the threads are still coming down. a
        // handkerchief falls far slower than a coin of the same weight because
        // drag scales with area and cloth is nearly all area, and this is a
        // room with no hurry in it
        engine.gravity.y = 0.16 + 0.4 * fall * fall;
        if (fall >= 1 && !told) {
          told = true;
          setPhase("held");
        }

        /* ---- the draught ---- */
        // three sines that share no factor, under a slower envelope that lets
        // the air drop away and come back, so the room never gusts on a beat
        const w = breezeRef.current ? clamp(wind, 0, 1) : 0;
        const env = clamp(0.35 + Math.sin(t * 0.107) * 0.5 + Math.sin(t * 0.041 + 2) * 0.3, 0, 1.2);
        const gust =
          env *
          (Math.sin(t * 0.29) * 0.55 + Math.sin(t * 0.71 + 1.3) * 0.3 + Math.sin(t * 1.63 + 2.6) * 0.15);

        // pendulum. gravity restores, the air damps, the gust only adds energy,
        // which is why it keeps going after the room goes still
        const h = dt / 1000;
        swingV += (-SWING_W2 * Math.sin(swing) - SWING_DAMP * swingV + GUST * w * gust * fall) * h;
        swing += swingV * h;

        const cSw = Math.cos(swing);
        const sSw = Math.sin(swing);

        const breathY = Math.sin(t * 0.3) * 0.022;
        const breathP = Math.sin(t * 0.21 + 0.9) * 0.011;
        yaw += (yawT - 0.3 + breathY - yaw) * 0.04;
        pitch += (pitchT + 0.08 + breathP - pitch) * 0.04;
        const cyw = Math.cos(yaw);
        const syw = Math.sin(yaw);
        const cpt = Math.cos(pitch);
        const spt = Math.sin(pitch);
        const heave = Math.sin(t * 0.18) * 2.6;

        const S = shapes[model];
        for (let i = 0; i < n; i++) {
          // the whole form swings about the point it hangs from, so the hem
          // travels furthest and the top hardly moves, which is what tells you
          // it is hanging rather than sliding
          const rx = S[i * 3];
          const ry = S[i * 3 + 1] - pivotY;
          const x = rx * cSw - ry * sSw;
          const y = pivotY + rx * sSw + ry * cSw;
          const z = S[i * 3 + 2];
          const x1 = x * cyw + z * syw;
          const z1 = -x * syw + z * cyw;
          const y2 = y * cpt - z1 * spt;
          const z2 = y * spt + z1 * cpt;
          const k = FOCAL / (FOCAL + z2);
          rest[i * 2] = cx + x1 * k;
          rest[i * 2 + 1] = cy + y2 * k + heave;
          depth[i] = z2;
          anchors[i].pointA.x = rest[i * 2];
          anchors[i].pointA.y = rest[i * 2 + 1];
          // staggered engagement. an anchor that has not arrived yet holds
          // nothing at all, so its vertex is genuinely falling
          const g = smooth(clamp((fall - delay[i]) / 0.26, 0, 1));
          anchors[i].stiffness = (i === held ? soft * 0.25 : soft) * g;
        }

        // the fittings run through the same swing and the same projection, but
        // straight from their own coordinates. no anchors, no lag, no give
        const depthOf = PROFILES[model].depth * box;
        fitted = FITTINGS[model].map((poly) => {
          const out: number[] = [];
          for (const p of poly) {
            const mx = (p[0] - 0.5) * box;
            const ry = (p[1] - 0.5) * box - pivotY;
            const x = mx * cSw - ry * sSw;
            const y = pivotY + mx * sSw + ry * cSw;
            const mz = p[2] * depthOf;
            const x1 = x * cyw + mz * syw;
            const z1 = -x * syw + mz * cyw;
            const y2 = y * cpt - z1 * spt;
            const z2 = y * spt + z1 * cpt;
            const k = FOCAL / (FOCAL + z2);
            out.push(cx + x1 * k, cy + y2 * k + heave);
          }
          return out;
        });

        // the weave is always told the silhouette it is meant to be holding
        for (const y of yarns) {
          const dx = rest[y.b * 2] - rest[y.a * 2];
          const dy = rest[y.b * 2 + 1] - rest[y.a * 2 + 1];
          y.c.length = Math.hypot(dx, dy);
        }

        // the air reaches the cloth itself, not only the point it hangs from. a
        // travelling phase around the profile, so a gust crosses the piece as a
        // ripple instead of arriving everywhere at once, and the hem takes more
        // of it than the top does
        if (w > 0) {
          for (let i = 0; i < n; i++) {
            if (i === held) continue;
            const ripple = 1 + 0.4 * Math.sin((i % NU) * 0.5 - t * 2.1);
            Body.applyForce(bodies[i], bodies[i].position, {
              x: 0.0002 * w * gust * ripple * (0.4 + 0.6 * engage[i]),
              y: 0,
            });
          }
        }

        Engine.update(engine, dt);

        // once it is formed it is formed. a seam has a length and no vertex
        // gets to walk further than it, which is what keeps the piece taut
        // instead of slowly sagging into a bag
        const cap = 14 + (1 - fall) * 400;
        for (let i = 0; i < n; i++) {
          if (i === held) continue;
          const b = bodies[i];
          const dx = b.position.x - rest[i * 2];
          const dy = b.position.y - rest[i * 2 + 1];
          const d = Math.hypot(dx, dy);
          if (d > cap) {
            const f = cap / d;
            Body.setPosition(b, { x: rest[i * 2] + dx * f, y: rest[i * 2 + 1] + dy * f });
            Body.setVelocity(b, { x: b.velocity.x * 0.5, y: b.velocity.y * 0.5 });
          }
        }

        draw(t);
      };

      /* ---- drawing ----
       *
       * Three layers, and the piece is only the first of them.
       *
       * The cloth goes into its own buffer rather than straight onto the room,
       * because everything after this needs the piece as an image: you cannot
       * refract something you have already painted onto its own background. In
       * the buffer the strokes still multiply against each other, so the
       * density accumulation is untouched.
       *
       * Then the buffer lands on the room three times. Once sharp. Once blurred
       * wide and faint, which is the light the threads are throwing into the
       * air around them. And once through reeded glass: the buffer resampled in
       * vertical slices, each one displaced by where it falls across a reed,
       * because a half round rib of glass is a lens and a lens moves what is
       * behind it furthest at its edges and not at all down its centre. The
       * piece behind it comes apart into columns and puts itself back together,
       * which is the whole reason for putting glass in front of anything.
       */
      const scene = document.createElement("canvas");
      scene.width = canvas.width;
      scene.height = canvas.height;
      const sctx = scene.getContext("2d")!;
      const canFilter = typeof ctx.filter === "string";

      const draw = (t: number) => {
        const PW = canvas.width;
        const PH = canvas.height;

        // white. no tint, no bounce off the piece, no vignette, no floor. the
        // only coloured thing in the frame is the thread
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = "none";
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, H);

        /* ---- the cloth, into its own layer ---- */
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, PW, PH);
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sctx.globalCompositeOperation = "multiply";
        sctx.lineCap = "round";
        sctx.lineJoin = "round";

        // no panel body at all. the cloth is thread and nothing else, so the
        // only thing that darkens is where one thread crosses another, and the
        // form is carried entirely by how they crowd
        // the weave. four threads to the simulated cell, following the cloth,
        // which is what throws moire where the two walls cross
        sctx.beginPath();
        for (let v = 0; v < NV; v++) {
          for (let u = 0; u < NU; u++) {
            const a = bodies[idx(u, v)].position;
            const b = bodies[idx(u + 1, v)].position;
            const c = bodies[idx(u + 1, v + 1)].position;
            const d = bodies[idx(u, v + 1)].position;
            // this cell asks for as many threads as its own size on screen
            // wants, so the gauge stays constant across a piece that is
            // stretched in one place and bunched in another
            const ku = clamp(
              Math.round(Math.hypot(b.x - a.x, b.y - a.y) / GAUGE),
              1,
              GAUGE_MAX,
            );
            const kv = clamp(
              Math.round(Math.hypot(d.x - a.x, d.y - a.y) / GAUGE),
              1,
              GAUGE_MAX,
            );
            weaveCell(sctx, a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y, ku, kv);
            sctx.moveTo(a.x, a.y);
            sctx.lineTo(b.x, b.y);
            sctx.moveTo(a.x, a.y);
            sctx.lineTo(d.x, d.y);
          }
        }
        // a thread is lit, not drawn. three passes down the same path, wide and
        // almost nothing through to narrow and solid, so each one carries a
        // halo of its own colour instead of a hard edge. while the piece is
        // still falling the threads are all there is, so they burn brighter
        const lit = glow * (1.25 - 0.25 * fall);
        for (const pass of [
          [7, 0.014],
          [3, 0.03],
          [W_HAIR, A_HAIR],
        ] as const) {
          sctx.lineWidth = pass[0];
          sctx.strokeStyle = `rgba(${PAL.line}, ${pass[1] * (pass[0] > 1 ? lit : 1)})`;
          sctx.stroke();
        }

        // seams: the two open hems, and a vertical seam at every corner of the
        // profile, which is where a panel of this really would be joined
        sctx.beginPath();
        for (const v of [0, NV]) {
          for (let u = 0; u < NU; u++) {
            const a = bodies[idx(u, v)].position;
            const b = bodies[idx(u + 1, v)].position;
            sctx.moveTo(a.x, a.y);
            sctx.lineTo(b.x, b.y);
          }
        }
        const corner = corners[model];
        for (let u = 0; u < NU; u++) {
          if (!corner[u] && u % SEAM_EVERY !== 0) continue;
          for (let v = 0; v < NV; v++) {
            const a = bodies[idx(u, v)].position;
            const b = bodies[idx(u, v + 1)].position;
            sctx.moveTo(a.x, a.y);
            sctx.lineTo(b.x, b.y);
          }
        }
        // the seam itself is doubled cloth, so it blooms like cloth
        sctx.lineWidth = 9;
        sctx.strokeStyle = `rgba(${PAL.wash}, ${A_BLOOM * glow})`;
        sctx.stroke();
        sctx.lineWidth = 5.5;
        sctx.strokeStyle = `rgba(${PAL.wash}, ${A_BLOOM})`;
        sctx.stroke();
        sctx.lineWidth = W_STRUCT;
        sctx.strokeStyle = `rgba(${PAL.line}, ${A_STRUCT})`;
        sctx.stroke();

        // and the steel it was stitched to, on the same path but hard. thin,
        // darker, no halo. two materials, and they must not read alike
        sctx.lineWidth = W_WIRE;
        sctx.strokeStyle = `rgba(${WIRE}, ${A_WIRE * fall})`;
        sctx.stroke();

        // the fittings. a handrail and its balusters, taps and a spout, the
        // stretchers under a chair. this is the part that stops it being a
        // shape and makes it a thing somebody owned
        if (fitted.length) {
          sctx.beginPath();
          for (const poly of fitted) {
            sctx.moveTo(poly[0], poly[1]);
            for (let k = 2; k < poly.length; k += 2) sctx.lineTo(poly[k], poly[k + 1]);
          }
          sctx.lineCap = "round";
          sctx.lineWidth = 4;
          sctx.strokeStyle = `rgba(${PAL.wash}, ${A_BLOOM * 1.4 * fall})`;
          sctx.stroke();
          sctx.lineWidth = W_WIRE * 1.3;
          sctx.strokeStyle = `rgba(${WIRE}, ${A_WIRE * 1.1 * fall})`;
          sctx.stroke();
        }

        sctx.globalCompositeOperation = "source-over";

        /* ---- and now the layers ---- */
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "multiply";

        // the piece, sharp
        ctx.globalAlpha = 1 - glass * 0.34;
        ctx.drawImage(scene, 0, 0);

        // the light it is throwing into the air around it. one wide blur of the
        // whole piece, laid back over itself
        if (canFilter && glow > 0.02) {
          ctx.globalAlpha = 0.42 * glow;
          ctx.filter = `blur(${HAZE * dpr}px)`;
          ctx.drawImage(scene, 0, 0);
          ctx.filter = "none";
        }

        // reeded glass. each slice is displaced by where it lands across a rib,
        // so it is thrown hardest at the edges of a reed and not at all down
        // the middle, and the piece breaks into columns that do not quite line
        // up with each other
        if (glass > 0.02) {
          const reed = REED * dpr;
          const amp = REED_AMP * dpr * glass;
          const sw = Math.ceil(PW / STRIPS);
          const drift = Math.sin(t * 0.05) * reed * 0.4;
          ctx.globalAlpha = 0.4 * glass;
          for (let x = 0; x < PW; x += sw) {
            const f = (((x + drift) % reed) + reed) % reed / reed;
            // a lens across the rib: -1 at one edge, 0 at the crown, +1 at the
            // other, which is the surface slope of a half round
            const dx = (f * 2 - 1) * amp;
            const dy = Math.sin(x * 0.004 + t * 0.18) * amp * 0.5;
            ctx.drawImage(scene, x, 0, sw, PH, x + dx, dy, sw, PH);
          }
        }

        ctx.globalAlpha = 1;
        ctx.filter = "none";
        ctx.globalCompositeOperation = "source-over";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointerleave", onLeave);
        Composite.clear(engine.world, false);
        Engine.clear(engine);
      };
    };

    teardown = build();
    const ro = new ResizeObserver(() => {
      teardown?.();
      teardown = build();
    });
    ro.observe(stage);

    return () => {
      ro.disconnect();
      teardown?.();
    };
    // the live form is read once per build and every later change is handled
    // inside the loop, so the sim is never torn down mid fall
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, give, wind, fallTime, glow, glass]);

  return (
    <div className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""} ${className ?? ""}`}>
      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      <div className={styles.hud}>
        <span className={styles.state}>
          {phase === "falling" ? `falling into the ${live}` : `holding the ${live}`}
        </span>
        <div className={styles.controls}>
          {(["staircase", "chair", "sink"] as FormName[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.btn} ${live === f ? styles.on : ""}`}
              onClick={() => pick(f)}
            >
              {f}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.btn} ${breeze ? styles.on : ""}`}
            onClick={() => setBreeze((b) => !b)}
          >
            {breeze ? "wind" : "still"}
          </button>
          <button type="button" className={styles.btn} onClick={() => pick(live)}>
            fall again
          </button>
        </div>
      </div>
      <p className={styles.note}>
        One sheet, folded into a closed loop and stitched. Pick another form and it lets go, falls,
        and is caught by that one.
      </p>
    </div>
  );
}
