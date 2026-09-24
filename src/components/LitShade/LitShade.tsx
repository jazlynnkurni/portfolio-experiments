"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bodies, Body, Composite, Constraint, Engine } from "matter-js";
import styles from "./LitShade.module.css";

/**
 * LitShade - the same cloth read the other way round, with the light inside it.
 *
 * Everywhere else in this set the fabric is see-through and the ground is an
 * empty white room, so density accumulates darker the more layers you look
 * through. Put a bulb inside the same shape on a black ground and the whole
 * scale inverts: the canvas goes additive, brightness is how much light gets
 * through the weave at that point, and the seams, which are doubled cloth, are
 * the only thing that reads dark. Bright core, dark ribs, a rim of glow where
 * the surface turns away from you.
 *
 * ILLUMINATION IS PATH LENGTH, NOT A GRADIENT. Each vertex is lit by inverse
 * square distance from the filament, times how squarely the cloth faces the
 * viewer at that point. A patch turned edge on presents more velvet between the
 * bulb and the eye, so it goes dark at the silhouette on its own. That is why
 * the bloom sits slightly high and slightly off centre rather than dead middle:
 * it lands where the filament is, not where the shape is.
 *
 * THE FRINGE IS THE ONLY REAL CLOTH HERE. A lampshade is stiffened, it does not
 * drape, so the shade is carried rigid and every strand of fringe is a matter
 * pendulum chain hung off the scalloped hem. Move the pointer and it is a draft
 * in the room: strands near the pointer take a force along the pointer's own
 * velocity, lag, swing past and come back. Nothing eases, the chains just have
 * mass.
 *
 * THE MOTH IS THE ACCIDENT. It steers at the filament, overshoots, gets turned
 * by the shade it cannot get into, and drags the strands it passes through. It
 * is the one thing in the frame nobody designed, and it is what stops the piece
 * reading as a render.
 */

type LitShadeProps = {
  variant?: "full" | "embed";
  /** strands of fringe hung on the hem */
  strands?: number;
  /** starts lit. off is the same object as a daylight line drawing */
  lit?: boolean;
  className?: string;
};

const WARM = "255, 208, 150"; // the filament, seen through one layer of velvet
const RED = "232, 60, 44"; // the velvet itself
const NIGHT = [11, 10, 12];
const DAY = [250, 246, 242];

/* ---- shade, in model units ---- */
const MERID = 48; // meridians around
const RINGS = 10; // rings down the bell
const RIB_EVERY = 6; // every nth meridian is a seam, not a weave line
const TOP_R = 30;
const BOT_R = 96;
const SHADE_H = 130;
const SCALLOP = 9; // how deep the hem is cut between its points
const FRINGE_LEN = 96;
const FRINGE_SEG = 6;

const FOCAL = 1100;
const TILT = 0.1; // a few degrees down the axis, so the rim reads as an ellipse

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The ramp a red velvet shade runs through, from the shadowed hem to the hot
 * patch of pile right over the filament. Sampled rather than interpolated in
 * one straight line, because the top end of it goes to warm white fast: velvet
 * holds its colour and then gives up all at once where the light is strongest.
 */
const RAMP: [number, number, number, number][] = [
  [0, 44, 6, 9],
  [0.3, 128, 14, 14],
  [0.6, 210, 42, 31],
  [0.82, 250, 130, 72],
  [1, 255, 240, 214],
];

function velvet(t: number) {
  const v = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0]) {
      const a = RAMP[i - 1];
      const b = RAMP[i];
      const f = (v - a[0]) / (b[0] - a[0]);
      return `rgb(${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(
        a[2] + (b[2] - a[2]) * f,
      )}, ${Math.round(a[3] + (b[3] - a[3]) * f)})`;
    }
  }
  return `rgb(${RAMP[RAMP.length - 1][1]}, ${RAMP[RAMP.length - 1][2]}, ${RAMP[RAMP.length - 1][3]})`;
}

/** deterministic noise, so the frame is the same on every machine and reload */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export default function LitShade({
  variant = "full",
  strands = 56,
  lit = true,
  className,
}: LitShadeProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(lit);
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  }, [on]);
  const toggle = useCallback(() => setOn((v) => !v), []);

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

      const scale = Math.min(W / (BOT_R * 2.5), H / (SHADE_H + FRINGE_LEN + 150));
      const cx = W / 2;
      const cy = H * 0.36;
      const rnd = rng(20260822);

      /* ---- the shade. a surface of revolution, carried rigid ---- */
      const radiusAt = (v: number) => TOP_R + (BOT_R - TOP_R) * Math.pow(v, 1.4);
      const hemDrop = (m: number) => {
        // the scalloped hem, one lobe every eighth meridian, dipping between
        // the points where the trim is tacked on
        const lobes = MERID / RIB_EVERY;
        return (1 - Math.cos((m / MERID) * Math.PI * 2 * lobes)) * 0.5 * SCALLOP;
      };
      const ang = new Float64Array(MERID);
      for (let m = 0; m < MERID; m++) ang[m] = (m / MERID) * Math.PI * 2;

      // model space positions, ring major
      const px = new Float64Array(MERID * (RINGS + 1));
      const py = new Float64Array(MERID * (RINGS + 1));
      const pz = new Float64Array(MERID * (RINGS + 1));
      for (let r = 0; r <= RINGS; r++) {
        const v = r / RINGS;
        for (let m = 0; m < MERID; m++) {
          const i = r * MERID + m;
          const rad = radiusAt(v);
          px[i] = Math.cos(ang[m]) * rad;
          pz[i] = Math.sin(ang[m]) * rad;
          py[i] = v * SHADE_H + (r === RINGS ? hemDrop(m) : 0);
        }
      }

      // the filament, a little above the hem and slightly forward, which is
      // where a bulb actually sits in a shade this shape
      const bulb = { x: 0, y: SHADE_H * 0.62, z: 6 };

      const sx = new Float64Array(MERID * (RINGS + 1));
      const sy = new Float64Array(MERID * (RINGS + 1));
      const li = new Float64Array(MERID * (RINGS + 1));
      const faceZ = new Float64Array(MERID * (RINGS + 1));

      /**
       * Crushed velvet. The pile is knocked flat in patches, so the cloth
       * reflects and transmits unevenly at a scale much coarser than the weave,
       * in soft blotches with no direction to them. Two octaves of value noise
       * on the cylinder, wrapped so the seam at meridian zero does not show,
       * and it stays fixed in the cloth rather than in the picture, so it turns
       * with the shade instead of swimming across it.
       */
      const mottle = new Float64Array(MERID * (RINGS + 1));
      {
        const nz = rng(4711);
        const OCT = [
          { m: 6, r: 3, a: 0.62 },
          { m: 13, r: 6, a: 0.38 },
        ];
        for (const o of OCT) {
          const field: number[] = [];
          for (let i = 0; i < o.m * (o.r + 1); i++) field.push(nz());
          const at = (mi: number, ri: number) =>
            field[(((mi % o.m) + o.m) % o.m) * (o.r + 1) + clamp(ri, 0, o.r)];
          for (let r = 0; r <= RINGS; r++) {
            const fv = (r / RINGS) * o.r;
            const r0 = Math.floor(fv);
            const tv = fv - r0;
            for (let m = 0; m < MERID; m++) {
              const fu = (m / MERID) * o.m;
              const m0 = Math.floor(fu);
              const tu = fu - m0;
              // smoothstep on both axes, so the blotches have no grid in them
              const su = tu * tu * (3 - 2 * tu);
              const sv = tv * tv * (3 - 2 * tv);
              const a = at(m0, r0) + (at(m0 + 1, r0) - at(m0, r0)) * su;
              const b = at(m0, r0 + 1) + (at(m0 + 1, r0 + 1) - at(m0, r0 + 1)) * su;
              mottle[r * MERID + m] += (a + (b - a) * sv) * o.a;
            }
          }
        }
        for (let i = 0; i < mottle.length; i++) mottle[i] = 0.66 + mottle[i] * 0.68;
      }

      // meridians run from the far side of the shade to the near side, so an
      // opaque lit shade can be painted straight through with no depth sort
      const merOrder = Array.from({ length: MERID }, (_, m) => m).sort(
        (a, b) => Math.sin(ang[a]) - Math.sin(ang[b]),
      );

      /* ---- fringe. one matter chain per strand ---- */
      const engine = Engine.create();
      engine.gravity.x = 0;
      engine.gravity.y = 1;
      engine.constraintIterations = 4;
      engine.positionIterations = 5;
      engine.velocityIterations = 4;

      const nStrand = clamp(Math.round(strands), 8, MERID);
      const chains: Body[][] = [];
      const tops: Constraint[] = [];
      const strandMerid: number[] = [];
      const segLen = (FRINGE_LEN * scale) / FRINGE_SEG;

      for (let s = 0; s < nStrand; s++) {
        const m = Math.round((s / nStrand) * MERID) % MERID;
        strandMerid.push(m);
        const chain: Body[] = [];
        for (let k = 0; k <= FRINGE_SEG; k++) {
          const b = Bodies.circle(cx, cy + k * segLen, 1.4, {
            frictionAir: 0.055, // thread is nearly all surface
            restitution: 0,
            collisionFilter: { group: 0, category: 4, mask: 0 },
          });
          // a strand tapers in mass toward its tip, which is what makes the tip
          // whip and the top of the strand barely move
          Body.setMass(b, 1 - (k / FRINGE_SEG) * 0.55);
          chain.push(b);
          if (k > 0) {
            Composite.add(
              engine.world,
              Constraint.create({
                bodyA: chain[k - 1],
                bodyB: b,
                length: segLen,
                stiffness: 0.9, // a thread does not stretch
                damping: 0.06,
                render: { visible: false },
              }),
            );
          }
        }
        const pin = Constraint.create({
          pointA: { x: cx, y: cy },
          bodyB: chain[0],
          length: 0,
          stiffness: 1,
          damping: 0.2,
          render: { visible: false },
        });
        tops.push(pin);
        Composite.add(engine.world, [...chain, pin]);
        chains.push(chain);
      }

      /* ---- the moth ---- */
      const moth = Bodies.circle(cx + 140, cy - 60, 3, {
        frictionAir: 0.09,
        collisionFilter: { group: 0, category: 8, mask: 0 },
      });
      Body.setMass(moth, 0.35);
      Composite.add(engine.world, moth);
      let mothPhase = rnd() * 6.28;

      /* ---- pointer draft ---- */
      const ptr = { x: -1e5, y: -1e5, vx: 0, vy: 0, on: false };
      const onMove = (ev: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        const nx = ev.clientX - r.left;
        const ny = ev.clientY - r.top;
        if (ptr.on) {
          ptr.vx = nx - ptr.x;
          ptr.vy = ny - ptr.y;
        }
        ptr.x = nx;
        ptr.y = ny;
        ptr.on = true;
      };
      const onLeave = () => {
        ptr.on = false;
        ptr.x = -1e5;
        ptr.vx = 0;
        ptr.vy = 0;
      };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);

      const t0 = performance.now();
      let last = t0;
      let glow = onRef.current ? 1 : 0;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = clamp(now - last, 8, 40);
        last = now;
        const t = (now - t0) / 1000;
        glow += ((onRef.current ? 1 : 0) - glow) * 0.06;

        // the stand has a little give, so the whole lamp breathes a degree
        const sway = Math.sin(t * 0.36) * 0.02 + Math.sin(t * 0.83) * 0.006;
        const cs = Math.cos(sway);
        const ss = Math.sin(sway);
        const ct = Math.cos(TILT);
        const st = Math.sin(TILT);

        const project = (x: number, y: number, z: number) => {
          // sway is a roll about the axis of the stand, tilt is fixed
          const x1 = x * cs - y * ss;
          const y1 = x * ss + y * cs;
          const y2 = y1 * ct - z * st;
          const z2 = y1 * st + z * ct;
          const k = (FOCAL / (FOCAL + z2 * scale)) * scale;
          return { x: cx + x1 * k, y: cy + y2 * k, z: z2 };
        };

        for (let r = 0; r <= RINGS; r++) {
          for (let m = 0; m < MERID; m++) {
            const i = r * MERID + m;
            const p = project(px[i], py[i], pz[i]);
            sx[i] = p.x;
            sy[i] = p.y;
            // outward normal of a surface of revolution is radial in plan, so
            // its z component is just the sine of the meridian angle carried
            // through the same roll
            const nz = Math.sin(ang[m]) * ct;
            faceZ[i] = p.z;
            const dx = px[i] - bulb.x;
            const dy = py[i] - bulb.y;
            const dz = pz[i] - bulb.z;
            const d = Math.hypot(dx, dy, dz);
            const fall = 1 / (1 + (d / 62) * (d / 62));
            li[i] = fall * (0.3 + 0.7 * clamp(nz, 0, 1));
          }
        }

        // fringe hangs off the hem, so its pins ride the projected scallop
        for (let s = 0; s < nStrand; s++) {
          const i = RINGS * MERID + strandMerid[s];
          tops[s].pointA.x = sx[i];
          tops[s].pointA.y = sy[i];
        }

        // the draft. force along the pointer's own velocity, falling off with
        // distance, which is how moving air actually reaches a hanging thread
        if (ptr.on && (Math.abs(ptr.vx) > 0.4 || Math.abs(ptr.vy) > 0.4)) {
          for (const chain of chains) {
            for (let k = 1; k <= FRINGE_SEG; k++) {
              const b = chain[k];
              const dx = b.position.x - ptr.x;
              const dy = b.position.y - ptr.y;
              const d2 = dx * dx + dy * dy;
              if (d2 > 130 * 130) continue;
              const w = (1 - Math.sqrt(d2) / 130) * 0.00018 * (k / FRINGE_SEG);
              Body.applyForce(b, b.position, { x: ptr.vx * w, y: ptr.vy * w });
            }
          }
        }
        ptr.vx *= 0.82;
        ptr.vy *= 0.82;

        // the moth steers at the light and keeps missing it
        {
          const target = project(bulb.x, bulb.y, bulb.z);
          const dx = target.x - moth.position.x;
          const dy = target.y - moth.position.y;
          const d = Math.hypot(dx, dy) || 1;
          mothPhase += 0.12 + rnd() * 0.05;
          const pull = d > 150 ? 0.00055 : 0.00018;
          Body.applyForce(moth, moth.position, {
            x: (dx / d) * pull + Math.cos(mothPhase * 1.7) * 0.00042,
            y: (dy / d) * pull + Math.sin(mothPhase * 2.3) * 0.00042 - 0.00028,
          });
          // it cannot get in, so the shade turns it away every time
          if (d < 74) {
            Body.applyForce(moth, moth.position, { x: (-dx / d) * 0.0016, y: (-dy / d) * 0.0016 });
          }
          // and it drags whatever thread it brushes past
          for (const chain of chains) {
            for (let k = 2; k <= FRINGE_SEG; k++) {
              const b = chain[k];
              const ex = b.position.x - moth.position.x;
              const ey = b.position.y - moth.position.y;
              if (ex * ex + ey * ey > 22 * 22) continue;
              Body.applyForce(b, b.position, {
                x: moth.velocity.x * 0.00012,
                y: moth.velocity.y * 0.00012,
              });
            }
          }
        }

        Engine.update(engine, dt);
        draw(t);
      };

      const draw = (t: number) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = "source-over";

        // the room crossfades with the bulb. lit, it is a window at night. dark,
        // it is the same empty white room the rest of the set stands in
        const g = 1 - glow;
        ctx.fillStyle = `rgb(${Math.round(NIGHT[0] * glow + DAY[0] * g)}, ${Math.round(
          NIGHT[1] * glow + DAY[1] * g,
        )}, ${Math.round(NIGHT[2] * glow + DAY[2] * g)})`;
        ctx.fillRect(0, 0, W, H);

        // city beyond the glass, dim enough to be weather rather than content
        if (glow > 0.02) {
          const c = rng(77);
          for (let i = 0; i < 26; i++) {
            const bx = c() * W;
            const by = c() * H * 0.8;
            const br = 1 + c() * 2.4;
            const a = (0.05 + c() * 0.11) * glow;
            ctx.fillStyle = `rgba(150, 190, 230, ${a})`;
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.strokeStyle = `rgba(150, 190, 230, ${0.06 * glow})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(W * 0.18, 0);
          ctx.lineTo(W * 0.18, H);
          ctx.moveTo(W * 0.82, 0);
          ctx.lineTo(W * 0.82, H);
          ctx.stroke();
        }

        const lightPass = glow > 0.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // light spilling out past the shade and into the room. the shade itself
        // is opaque when it is lit, so this is the only part of the bulb that
        // reaches the glass and the sill
        if (glow > 0.02) {
          const bp = { x: cx, y: cy + SHADE_H * 0.62 * scale };
          const rad = BOT_R * scale * 3.2;
          const halo = ctx.createRadialGradient(bp.x, bp.y, 0, bp.x, bp.y, rad);
          halo.addColorStop(0, `rgba(${WARM}, ${0.3 * glow})`);
          halo.addColorStop(0.3, `rgba(${RED}, ${0.12 * glow})`);
          halo.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = halo;
          ctx.fillRect(bp.x - rad, bp.y - rad, rad * 2, rad * 2);
        }

        /* ---- the cloth, unlit. the same organza reading as the rest of the
           set: translucent, one hue, the weave drawn ---- */
        if (glow < 0.98) {
          ctx.globalCompositeOperation = "multiply";
          ctx.beginPath();
          for (let r = 0; r < RINGS; r++) {
            for (let m = 0; m < MERID; m++) {
              const i = r * MERID + m;
              const j = r * MERID + ((m + 1) % MERID);
              const k = (r + 1) * MERID + ((m + 1) % MERID);
              const l = (r + 1) * MERID + m;
              ctx.moveTo(sx[i], sy[i]);
              ctx.lineTo(sx[j], sy[j]);
              ctx.lineTo(sx[k], sy[k]);
              ctx.lineTo(sx[l], sy[l]);
              ctx.closePath();
            }
          }
          ctx.fillStyle = `rgba(${RED}, ${0.05 * (1 - glow)})`;
          ctx.fill();
          ctx.beginPath();
          for (let r = 0; r <= RINGS; r++) {
            for (let m = 0; m < MERID; m++) {
              const i = r * MERID + m;
              const j = r * MERID + ((m + 1) % MERID);
              ctx.moveTo(sx[i], sy[i]);
              ctx.lineTo(sx[j], sy[j]);
              if (r < RINGS) {
                ctx.moveTo(sx[i], sy[i]);
                ctx.lineTo(sx[(r + 1) * MERID + m], sy[(r + 1) * MERID + m]);
              }
            }
          }
          ctx.lineWidth = 0.6;
          ctx.strokeStyle = `rgba(${RED}, ${0.11 * (1 - glow)})`;
          ctx.stroke();
        }

        /* ---- the cloth, lit. crushed velvet, one flat colour per cell, taken
           from how much light reaches that patch and how flat its pile is
           lying. painted far meridian to near, so the front of the shade covers
           the back of it without a depth sort ---- */
        if (glow > 0.02) {
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = glow;
          for (const m of merOrder) {
            const m2 = (m + 1) % MERID;
            for (let r = 0; r < RINGS; r++) {
              const i = r * MERID + m;
              const j = r * MERID + m2;
              const k = (r + 1) * MERID + m2;
              const l = (r + 1) * MERID + m;
              const t =
                ((li[i] + li[j] + li[k] + li[l]) / 4) *
                ((mottle[i] + mottle[k]) / 2) *
                1.45;
              ctx.fillStyle = velvet(t);
              ctx.beginPath();
              ctx.moveTo(sx[i], sy[i]);
              ctx.lineTo(sx[j], sy[j]);
              ctx.lineTo(sx[k], sy[k]);
              ctx.lineTo(sx[l], sy[l]);
              ctx.closePath();
              ctx.fill();
              // cells are filled edge to edge, and a hairline of ground shows
              // between them at some angles. stroking the same path in the same
              // colour closes it without changing the shading
              ctx.lineWidth = 1;
              ctx.strokeStyle = ctx.fillStyle;
              ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
        }

        // seams. doubled cloth, so they are the one thing that darkens when the
        // light is on, and they stay dark when it is off. this is the inversion
        ctx.globalCompositeOperation = "multiply";
        ctx.beginPath();
        for (let m = 0; m < MERID; m += RIB_EVERY) {
          for (let r = 0; r < RINGS; r++) {
            const i = r * MERID + m;
            const j = (r + 1) * MERID + m;
            if (faceZ[i] < 0 && lightPass) continue;
            ctx.moveTo(sx[i], sy[i]);
            ctx.lineTo(sx[j], sy[j]);
          }
        }
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(88, 12, 10, ${0.34 + 0.3 * glow})`;
        ctx.stroke();

        // hem trim and collar, structural weight
        ctx.globalCompositeOperation = lightPass ? "lighter" : "multiply";
        for (const r of [0, RINGS]) {
          ctx.beginPath();
          for (let m = 0; m < MERID; m++) {
            const i = r * MERID + m;
            const j = r * MERID + ((m + 1) % MERID);
            ctx.moveTo(sx[i], sy[i]);
            ctx.lineTo(sx[j], sy[j]);
          }
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = lightPass
            ? `rgba(${WARM}, ${0.16 * glow})`
            : `rgba(${RED}, ${0.2 * (1 - glow)})`;
          ctx.stroke();
        }

        /* ---- fringe ---- */
        for (let s = 0; s < nStrand; s++) {
          const chain = chains[s];
          const i = RINGS * MERID + strandMerid[s];
          const behind = faceZ[i] < 0;
          const lightAtTop = li[i];
          ctx.globalCompositeOperation = lightPass ? "lighter" : "multiply";
          ctx.beginPath();
          ctx.moveTo(chain[0].position.x, chain[0].position.y);
          for (let k = 1; k <= FRINGE_SEG; k++) {
            ctx.lineTo(chain[k].position.x, chain[k].position.y);
          }
          if (lightPass) {
            // a strand of the trim is the same velvet, so it takes the same
            // ramp. it is lit at the top where it leaves the hem and unlit by
            // the time it reaches the tip, which is what makes the fringe read
            // as depth rather than as a comb
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = glow * (behind ? 0.45 : 1);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = velvet(lightAtTop * mottle[i] * 1.15);
            ctx.stroke();
            ctx.globalAlpha = 1;
          } else {
            ctx.lineWidth = 0.9;
            ctx.strokeStyle = `rgba(${RED}, ${0.11 * (1 - glow) * (behind ? 0.5 : 1)})`;
            ctx.stroke();
          }
        }

        // the stand, drawn plain, because a turned brass column is not cloth
        ctx.globalCompositeOperation = lightPass ? "lighter" : "multiply";
        ctx.beginPath();
        const baseY = cy + (SHADE_H + FRINGE_LEN + 70) * scale;
        ctx.moveTo(cx, cy + SHADE_H * scale);
        ctx.lineTo(cx, baseY);
        ctx.moveTo(cx - 26 * scale, baseY);
        ctx.lineTo(cx + 26 * scale, baseY);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = lightPass
          ? `rgba(${WARM}, ${0.12 * glow})`
          : `rgba(${RED}, ${0.16 * (1 - glow)})`;
        ctx.stroke();

        // the moth, and its shadow on the cloth when it gets close enough
        ctx.globalCompositeOperation = "source-over";
        const flap = Math.abs(Math.sin(t * 9)) * 0.6 + 0.4;
        ctx.save();
        ctx.translate(moth.position.x, moth.position.y);
        ctx.rotate(Math.atan2(moth.velocity.y, moth.velocity.x) + Math.PI / 2);
        ctx.fillStyle = lightPass ? "rgba(236, 226, 212, 0.75)" : "rgba(70, 62, 58, 0.5)";
        ctx.beginPath();
        ctx.ellipse(-3.4 * flap, 0, 3.6 * flap, 2.2, -0.5, 0, Math.PI * 2);
        ctx.ellipse(3.4 * flap, 0, 3.6 * flap, 2.2, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        canvas.removeEventListener("pointermove", onMove);
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
  }, [strands]);

  return (
    <div className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""} ${className ?? ""}`}>
      <div ref={stageRef} className={`${styles.stage} ${on ? styles.night : styles.day}`}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      <div className={styles.hud}>
        <span className={styles.state}>{on ? "bulb on, window at night" : "bulb off, daylight"}</span>
        <div className={styles.controls}>
          <button type="button" className={`${styles.btn} ${on ? styles.onBtn : ""}`} onClick={toggle}>
            {on ? "switch it off" : "switch it on"}
          </button>
          <span className={styles.hint}>move to make a draft</span>
        </div>
      </div>
    </div>
  );
}
