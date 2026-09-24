"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bodies, Body, Composite, Constraint, Engine } from "matter-js";
import { BLUE, paintRoom, washCell, weaveCell } from "@/components/FabricSkin/skin";
import styles from "./CutLoose.module.css";

/**
 * CutLoose - a chair sewn in translucent cloth, and what happens when the
 * stitches holding it in the air are cut.
 *
 * Same drawing rules as the rest of the family: line only, one hue, two
 * weights, canvas in multiply so density is emergent. What this one is for is
 * the second half of that sentence. A wireframe collapsing is only a wireframe
 * collapsing, but cloth collapsing PILES, and the pile is where the effect pays
 * off: three hundred edges land on top of each other in a hand-sized patch of
 * canvas and that patch goes almost opaque, while the empty air where a chair
 * used to be goes back to paper. Nothing draws that gradient. It is just how
 * many times the same pixel got multiplied.
 *
 * WHAT CHANGES AT THE CUT.
 *   - anchors, which were holding every vertex near its projected rest point,
 *     drop to zero stiffness. Only the yarns are left;
 *   - the yarns freeze the lengths they had at that instant, so the piece keeps
 *     the dimensions it was cut at and is now a slack net rather than a shape
 *     being held up to a template;
 *   - collisions come on. Until now the particles were lines and passed through
 *     each other. Now they have a radius, which is the thickness of the cloth,
 *     and it is the only thing stopping the heap collapsing to a single point.
 *
 * RESTITCHING IS NOT A REWIND. Anchors ramp back in over a couple of seconds
 * from wherever the heap ended up, so the piece climbs out of its own pile and
 * finds the chair again, in a different order every time. Nothing snaps.
 */

type CutLooseProps = {
  variant?: "full" | "embed";
  /** how far the cloth sags between seams while it hangs, 0 taut .. 1 loose */
  drape?: number;
  /** seconds the piece takes to climb back into shape */
  stitchTime?: number;
  className?: string;
};

const PAL = BLUE;

const W_STRUCT = 1.6;
const W_HAIR = 0.5;
const A_STRUCT = 0.24;
const A_HAIR = 0.1;
const A_WASH = 0.08;
const A_BLOOM = 0.045;
const THREADS = 4;

/* ---- chair, in model units. y grows downward, as it does on the canvas ---- */
const SEAT = 92;
const LEG = 96;
const BACK = 104;
const STRAP = 9; // width of the sewn strap that stands in for a chair leg

const MAX_SLIP = 20;
const FOCAL = 900;
const PARTICLE_R = 2.6; // half the thickness of the cloth

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type V3 = { x: number; y: number; z: number };
type Edge = { a: number; b: number; struct: boolean };
/** one cell of cloth, and the panel it was cut from */
type Face = { a: number; b: number; c: number; d: number; panel: number };
type Phase = "hung" | "cut" | "stitching";

class Mesh {
  verts: V3[] = [];
  edges: Edge[] = [];
  faces: Face[] = [];
  panels = 0;
  private vmap = new Map<string, number>();
  private emap = new Set<string>();

  v(x: number, y: number, z: number) {
    const k = `${Math.round(x * 4)}:${Math.round(y * 4)}:${Math.round(z * 4)}`;
    const hit = this.vmap.get(k);
    if (hit !== undefined) return hit;
    const i = this.verts.length;
    this.verts.push({ x, y, z });
    this.vmap.set(k, i);
    return i;
  }

  e(a: number, b: number, struct: boolean) {
    if (a === b) return;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (this.emap.has(k)) return;
    this.emap.add(k);
    this.edges.push({ a, b, struct });
  }

  patch(f: (u: number, v: number) => V3, nu: number, nv: number) {
    const id: number[][] = [];
    for (let i = 0; i <= nu; i++) {
      id[i] = [];
      for (let j = 0; j <= nv; j++) {
        const p = f(i / nu, j / nv);
        id[i][j] = this.v(p.x, p.y, p.z);
      }
    }
    const panel = this.panels++;
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        if (i < nu) this.e(id[i][j], id[i + 1][j], j === 0 || j === nv);
        if (j < nv) this.e(id[i][j], id[i][j + 1], i === 0 || i === nu);
        if (i < nu && j < nv) {
          // one bias thread per cell. a woven panel is stiff along its yarns
          // and free on the diagonal, and without this the heap folds like
          // cardboard
          this.e(id[i][j], id[i + 1][j + 1], false);
          this.faces.push({
            a: id[i][j],
            b: id[i + 1][j],
            c: id[i + 1][j + 1],
            d: id[i][j + 1],
            panel,
          });
        }
      }
    }
    return id;
  }
}

function buildChair() {
  const m = new Mesh();

  // seat, flat, gridded both ways
  m.patch((u, v) => ({ x: u * SEAT, y: 0, z: v * SEAT }), 5, 5);

  // back panel, rising off the rear edge with a slight rake
  m.patch(
    (u, v) => ({ x: u * SEAT, y: -v * BACK, z: SEAT + v * 16 }),
    5,
    5,
  );

  // legs. each is two straps sewn at a right angle, which is how a soft sculpture
  // gets a leg to stand up at all, and it gives the drop something to fold along
  for (const cx of [0, SEAT]) {
    for (const cz of [0, SEAT]) {
      const sx = cx === 0 ? 1 : -1;
      const sz = cz === 0 ? 1 : -1;
      m.patch((u, v) => ({ x: cx + sx * u * STRAP, y: v * LEG, z: cz }), 1, 6);
      m.patch((u, v) => ({ x: cx, y: v * LEG, z: cz + sz * u * STRAP }), 1, 6);
    }
  }

  // stretchers, low down between the legs, the rails that keep a chair square
  const railY = LEG * 0.66;
  m.patch((u, v) => ({ x: u * SEAT, y: railY + v * STRAP, z: 0 }), 5, 1);
  m.patch((u, v) => ({ x: u * SEAT, y: railY + v * STRAP, z: SEAT }), 5, 1);
  m.patch((u, v) => ({ x: 0, y: railY + v * STRAP, z: u * SEAT }), 5, 1);
  m.patch((u, v) => ({ x: SEAT, y: railY + v * STRAP, z: u * SEAT }), 5, 1);

  return m;
}

export default function CutLoose({
  variant = "full",
  drape = 0.45,
  stitchTime = 2.4,
  className,
}: CutLooseProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("hung");
  const cmdRef = useRef<Phase | null>(null);

  const toggle = useCallback(() => {
    setPhase((p) => {
      // cut from any held state, and only a fallen piece can be stitched
      const next: Phase = p === "cut" ? "stitching" : "cut";
      cmdRef.current = next;
      return next;
    });
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

      const mesh = buildChair();
      const n = mesh.verts.length;
      const byPanel: Face[][] = Array.from({ length: mesh.panels }, () => []);
      for (const f of mesh.faces) byPanel[f.panel].push(f);

      let minY = 1e9;
      let maxY = -1e9;
      for (const v of mesh.verts) {
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      const ox = SEAT / 2;
      const oy = (minY + maxY) / 2;
      const oz = SEAT / 2;
      const scale = Math.min(W / 260, H / 320) * 0.92;
      const cx = W / 2;
      const cy = H * 0.42; // sits high, because it needs somewhere to fall to
      const floorY = H - 26;

      const engine = Engine.create();
      engine.gravity.x = 0;
      engine.gravity.y = 0.7;
      engine.constraintIterations = 4;
      engine.positionIterations = 7;
      engine.velocityIterations = 5;

      const soft = 0.16 - clamp(drape, 0, 1) * 0.125;
      const bodies: Body[] = [];
      const anchors: Constraint[] = [];
      const rest = new Float64Array(n * 2);
      const depth = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        const b = Bodies.circle(cx, cy, PARTICLE_R, {
          frictionAir: 0.055,
          restitution: 0, // cloth absorbs an impact, it never bounces
          friction: 0.9, // and cloth on cloth grabs hard, which is what stacks
          slop: 0.02,
          collisionFilter: { group: 0, category: 2, mask: 0 },
        });
        Body.setMass(b, 1);
        bodies.push(b);
        anchors.push(
          Constraint.create({
            pointA: { x: cx, y: cy },
            bodyB: b,
            length: 0,
            stiffness: soft,
            damping: 0.12,
            render: { visible: false },
          }),
        );
      }

      const yarns = mesh.edges.map((ed) =>
        Constraint.create({
          bodyA: bodies[ed.a],
          bodyB: bodies[ed.b],
          length: 1,
          stiffness: ed.struct ? 0.6 : 0.3,
          damping: 0.09,
          render: { visible: false },
        }),
      );

      const floor = Bodies.rectangle(W / 2, floorY + 40, W * 3, 80, {
        isStatic: true,
        friction: 0.95,
        restitution: 0,
      });
      const wallL = Bodies.rectangle(-40, H / 2, 80, H * 4, { isStatic: true, friction: 0.6 });
      const wallR = Bodies.rectangle(W + 40, H / 2, 80, H * 4, { isStatic: true, friction: 0.6 });

      Composite.add(engine.world, [...bodies, ...anchors, ...yarns, floor, wallL, wallR]);

      let yawT = 0;
      let pitchT = 0;
      let yaw = 0.22;
      let pitch = 0.06;
      const onMove = (ev: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        yawT = (((ev.clientX - r.left) / W) * 2 - 1) * 0.2;
        pitchT = (((ev.clientY - r.top) / H) * 2 - 1) * 0.09;
      };
      const onLeave = () => {
        yawT = 0;
        pitchT = 0;
      };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);

      let live: Phase = "hung";
      let stitch = 1; // 0 fully cut, 1 fully held
      const t0 = performance.now();
      let last = t0;

      const setCollisions = (on: boolean) => {
        for (const b of bodies) b.collisionFilter.mask = on ? 3 : 0;
      };

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = clamp(now - last, 8, 40);
        last = now;
        const t = (now - t0) / 1000;

        const cmd = cmdRef.current;
        if (cmd && cmd !== live) {
          cmdRef.current = null;
          if (cmd === "cut") {
            live = "cut";
            // the yarns keep whatever length they were cut at. from here the
            // piece has its own dimensions and no template to answer to
            for (let e = 0; e < yarns.length; e++) {
              const ed = mesh.edges[e];
              const a = bodies[ed.a].position;
              const b = bodies[ed.b].position;
              yarns[e].length = Math.hypot(b.x - a.x, b.y - a.y);
            }
            setCollisions(true);
          } else {
            live = "stitching";
            setCollisions(false);
          }
        }

        if (live === "cut") stitch = Math.max(0, stitch - dt / 260);
        else if (live === "stitching") {
          stitch = Math.min(1, stitch + dt / (stitchTime * 1000));
          if (stitch >= 1) {
            live = "hung";
            setPhase("hung");
          }
        }

        const held = live === "hung" || live === "stitching";
        if (held) {
          const breathY = Math.sin(t * 0.29) * 0.03;
          const breathP = Math.sin(t * 0.21 + 0.8) * 0.014;
          yaw += (yawT + 0.22 + breathY - yaw) * 0.04;
          pitch += (pitchT + 0.06 + breathP - pitch) * 0.04;
        }

        const cyw = Math.cos(yaw);
        const syw = Math.sin(yaw);
        const cpt = Math.cos(pitch);
        const spt = Math.sin(pitch);
        const heave = Math.sin(t * 0.18) * 3;

        // the projection keeps running even while the heap is on the floor, so
        // the anchors it hands back on a restitch are a live target, not a
        // snapshot of the pose the piece had when it fell
        for (let i = 0; i < n; i++) {
          const v = mesh.verts[i];
          const x = v.x - ox;
          const y = v.y - oy;
          const z = v.z - oz;
          const x1 = x * cyw + z * syw;
          const z1 = -x * syw + z * cyw;
          const y2 = y * cpt - z1 * spt;
          const z2 = y * spt + z1 * cpt;
          const k = (FOCAL / (FOCAL + z2 * scale)) * scale;
          rest[i * 2] = cx + x1 * k;
          rest[i * 2 + 1] = cy + y2 * k + heave;
          if (live !== "cut") depth[i] = z2;
          anchors[i].pointA.x = rest[i * 2];
          anchors[i].pointA.y = rest[i * 2 + 1];
          // ease-in-out on the way back, so the climb starts and lands soft
          const s = stitch * stitch * (3 - 2 * stitch);
          anchors[i].stiffness = soft * s;
        }

        if (live === "hung") {
          for (let e = 0; e < yarns.length; e++) {
            const ed = mesh.edges[e];
            const dx = rest[ed.b * 2] - rest[ed.a * 2];
            const dy = rest[ed.b * 2 + 1] - rest[ed.a * 2 + 1];
            yarns[e].length = Math.hypot(dx, dy);
          }
        }

        Engine.update(engine, dt);

        if (live === "hung") {
          for (let i = 0; i < n; i++) {
            const b = bodies[i];
            const dx = b.position.x - rest[i * 2];
            const dy = b.position.y - rest[i * 2 + 1];
            const d = Math.hypot(dx, dy);
            if (d > MAX_SLIP) {
              const f = MAX_SLIP / d;
              Body.setPosition(b, { x: rest[i * 2] + dx * f, y: rest[i * 2 + 1] + dy * f });
            }
          }
        }

        draw();
      };

      const panelDepth = new Float64Array(mesh.panels);
      const order = Array.from({ length: mesh.panels }, (_, i) => i);

      const draw = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // the shadow tracks the lowest cloth, so it tightens as the heap lands
        let low = 0;
        let sx = 0;
        let wsum = 0;
        for (const b of bodies) {
          if (b.position.y > low) low = b.position.y;
          sx += b.position.x;
          wsum++;
        }
        const shx = sx / wsum;
        const shy = Math.min(low + 14, floorY);

        paintRoom(ctx, W, H, PAL, shx, shy - 120 * scale, 1);

        const spread = SEAT * scale * (0.7 + (1 - stitch) * 0.5);
        const g = ctx.createRadialGradient(shx, shy, 0, shx, shy, spread);
        g.addColorStop(0, `rgba(${PAL.line}, 0.16)`);
        g.addColorStop(0.5, `rgba(${PAL.line}, 0.05)`);
        g.addColorStop(1, `rgba(${PAL.line}, 0)`);
        ctx.globalCompositeOperation = "multiply";
        ctx.save();
        ctx.translate(shx, shy);
        ctx.scale(1, 0.14);
        ctx.translate(-shx, -shy);
        ctx.fillStyle = g;
        ctx.fillRect(0, shy - spread, W, spread * 2);
        ctx.restore();

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        let dMin = 1e9;
        let dMax = -1e9;
        for (let p = 0; p < mesh.panels; p++) {
          const list = byPanel[p];
          if (!list.length) continue;
          let s = 0;
          for (const f of list) s += depth[f.a];
          panelDepth[p] = s / list.length;
          if (panelDepth[p] < dMin) dMin = panelDepth[p];
          if (panelDepth[p] > dMax) dMax = panelDepth[p];
        }
        order.sort((a, b) => panelDepth[b] - panelDepth[a]);
        const span = Math.max(1, dMax - dMin);

        for (const p of order) {
          const list = byPanel[p];
          if (!list.length) continue;
          const fade = 0.55 + (1 - (panelDepth[p] - dMin) / span) * 0.45;

          // in the heap this is the whole point: every panel that lands on top
          // of another one multiplies against it, so the pile goes dense while
          // the air the chair used to occupy goes back to paper
          ctx.beginPath();
          for (const f of list) {
            const a = bodies[f.a].position;
            const b = bodies[f.b].position;
            const c = bodies[f.c].position;
            const d = bodies[f.d].position;
            washCell(ctx, a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
          }
          ctx.fillStyle = `rgba(${PAL.wash}, ${A_WASH * fade})`;
          ctx.fill();

          ctx.beginPath();
          for (const f of list) {
            const a = bodies[f.a].position;
            const b = bodies[f.b].position;
            const c = bodies[f.c].position;
            const d = bodies[f.d].position;
            weaveCell(ctx, a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y, THREADS);
          }
          ctx.lineWidth = W_HAIR;
          ctx.strokeStyle = `rgba(${PAL.line}, ${A_HAIR * fade})`;
          ctx.stroke();
        }

        ctx.beginPath();
        for (const ed of mesh.edges) {
          if (!ed.struct) continue;
          const a = bodies[ed.a].position;
          const b = bodies[ed.b].position;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.lineWidth = 5.5;
        ctx.strokeStyle = `rgba(${PAL.wash}, ${A_BLOOM})`;
        ctx.stroke();
        ctx.lineWidth = W_STRUCT;
        ctx.strokeStyle = `rgba(${PAL.line}, ${A_STRUCT})`;
        ctx.stroke();

        ctx.globalCompositeOperation = "source-over";
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
  }, [drape, stitchTime]);

  return (
    <div className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""} ${className ?? ""}`}>
      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      <div className={styles.hud}>
        <span className={styles.state}>
          {phase === "hung" ? "chair, held" : phase === "cut" ? "chair, cut loose" : "restitching"}
        </span>
        <div className={styles.controls}>
          <button type="button" className={styles.btn} onClick={toggle}>
            {phase === "hung" ? "cut the stitches" : "stitch it back"}
          </button>
          <span className={styles.hint}>move to turn it</span>
        </div>
      </div>
    </div>
  );
}
