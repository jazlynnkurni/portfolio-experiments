"use client";

import { useEffect, useRef, useState } from "react";
import { Bodies, Body, Composite, Constraint, Engine, Vector } from "matter-js";
import { RED, paintRoom, washCell, weaveCell } from "@/components/FabricSkin/skin";
import styles from "./HangingGhost.module.css";

/**
 * HangingGhost - a staircase sewn in translucent cloth, hung in an empty room.
 *
 * THE LOOK. Nothing here is filled. The object exists only where edges pile up,
 * so every stroke goes down at low alpha in one hue with the canvas in multiply,
 * and a rim or a fold reads dark because four layers of mesh happen to cross
 * there, not because anything drew a dark line. Two weights only: a structural
 * weight for silhouettes and load-bearing edges, and a hairline for the seams
 * and panel grid. The grid is what sells it as cloth rather than as glass.
 *
 * THE PHYSICS. The model is 3D and it is projected every frame, but the cloth
 * is simulated in the picture plane, which is honest for a hanging sheet seen
 * head on. Each vertex is a matter body. Two constraint families act on it:
 *
 *   - an ANCHOR to its projected rest point, soft everywhere except along the
 *     top edge where the piece is stapled to the ceiling. Soft anchors plus
 *     gravity are what let the panels sag between their seams;
 *   - YARNS to its mesh neighbours, whose rest length is rewritten each frame
 *     from the current projection. The yarns say "hold the shape you are being
 *     shown", the anchors say "and be roughly here", and the gap between those
 *     two instructions is the drape.
 *
 * FABRIC LAGS. When the pointer turns the object the anchor points move
 * instantly and the bodies do not, because they carry mass and a lot of air
 * drag. The mesh separates, then re-registers a beat later. That lag is the
 * single strongest tell that the thing is textile, so frictionAir is high and
 * the parallax is only a few degrees.
 *
 * DISPLACEMENT IS CAPPED. After every step a body more than MAX_SLIP from its
 * rest point is pulled back to that radius. A real seam has a length and cannot
 * pay out more of it, and it also means no tuning of gravity or stiffness can
 * ever tear the drawing apart.
 */

type HangingGhostProps = {
  variant?: "full" | "embed";
  /** how far the cloth sags between its seams, 0 stretched .. 1 loose */
  drape?: number;
  /** degrees of yaw the pointer can steal at the edges of the stage */
  swing?: number;
  className?: string;
};

/* ---- the hue. one only. a second saturated colour turns it into a diagram ---- */
const PAL = RED;

/* ---- two weights, no more ---- */
const W_STRUCT = 1.6;
const W_HAIR = 0.5;
const A_STRUCT = 0.26;
const A_HAIR = 0.1;
const A_WASH = 0.085; // one layer of dyed organza, per cell
const A_BLOOM = 0.045; // light spilling round a hem, wide and faint
const THREADS = 4; // drawn threads per simulated cell, which is what moires

/* ---- staircase, in model units ---- */
const STEPS = 7;
const RUN = 24;
const RISE = 21;
const WIDTH = 108; // depth of the flight, the extrusion axis
const SOFFIT = 46; // how far the side panel hangs below its nosing
const RAIL = 52; // handrail height above each nosing

const MAX_SLIP = 22; // px a vertex may stray from where it is being drawn
const FOCAL = 900;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type V3 = { x: number; y: number; z: number };
type Edge = { a: number; b: number; struct: boolean };
/** one cell of cloth. four corners and which panel it belongs to, because a
 *  panel must not darken against itself */
type Face = { a: number; b: number; c: number; d: number; panel: number };

/** Vertex, edge and cell accumulator with positional dedup, so panels that meet
 *  at a seam share their corner particles and the cloth is actually stitched. */
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
    if (this.emap.has(k)) {
      // a seam claimed by two panels is a doubled thread, so the stronger
      // claim wins and it draws at the structural weight
      if (struct) {
        const found = this.edges.find(
          (ed) => (ed.a === a && ed.b === b) || (ed.a === b && ed.b === a),
        );
        if (found) found.struct = true;
      }
      return;
    }
    this.emap.add(k);
    this.edges.push({ a, b, struct });
  }

  /**
   * A cloth panel: a parametric patch gridded nu x nv. Interior lines are the
   * hairline weave, the four boundaries are the hem and get the structural
   * weight, which is how the eye picks the silhouette out of the mesh.
   */
  patch(f: (u: number, v: number) => V3, nu: number, nv: number) {
    const id: number[][] = [];
    for (let i = 0; i <= nu; i++) {
      id[i] = [];
      for (let j = 0; j <= nv; j++) {
        const p = f(i / nu, j / nv);
        id[i][j] = this.v(p.x, p.y, p.z);
      }
    }
    this.knit(id, nu, nv);
    return id;
  }

  /** turns a grid of vertex ids into hems, weave lines and cells, and claims a
   *  panel number for the lot */
  knit(id: number[][], nu: number, nv: number) {
    const panel = this.panels++;
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        if (i < nu) this.e(id[i][j], id[i + 1][j], j === 0 || j === nv);
        if (j < nv) this.e(id[i][j], id[i][j + 1], i === 0 || i === nu);
        if (i < nu && j < nv) {
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
  }
}

/** Side view of the flight, corners doubled at each riser so the step reads as
 *  a crisp vertical seam instead of a diagonal. */
function profile() {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < STEPS; i++) {
    const y = i * RISE;
    const x0 = i * RUN;
    for (let k = 0; k < 3; k++) pts.push({ x: x0 + (k * RUN) / 3, y });
    pts.push({ x: x0 + RUN, y });
    for (let k = 1; k <= 2; k++) pts.push({ x: x0 + RUN, y: y + (k * RISE) / 2 });
  }
  return pts;
}

function buildStaircase() {
  const m = new Mesh();
  const prof = profile();
  const total = STEPS * RUN;
  const slope = (STEPS * RISE) / total;
  const soffitY = (x: number) => x * slope + SOFFIT;

  // the two side panels, each a curtain hung from the stepped edge down to the
  // underside. columns that share an x are the risers, and they draw as one
  // vertical seam, which is exactly what a sewn riser is
  for (const z of [0, WIDTH]) {
    const cols: number[][] = [];
    for (const p of prof) {
      const col: number[] = [];
      const bottom = soffitY(p.x);
      for (let j = 0; j <= 4; j++) {
        const y = p.y + ((bottom - p.y) * j) / 4;
        col.push(m.v(p.x, y, z));
      }
      cols.push(col);
    }
    m.knit(cols, cols.length - 1, 4);
  }

  // treads and risers, spanning the full width
  for (let i = 0; i < STEPS; i++) {
    const y = i * RISE;
    const x0 = i * RUN;
    m.patch((u, v) => ({ x: x0 + u * RUN, y, z: v * WIDTH }), 3, 5);
    m.patch((u, v) => ({ x: x0 + RUN, y: y + u * RISE, z: v * WIDTH }), 2, 5);
  }

  // the underside, one long panel raking down under the flight
  m.patch((u, v) => ({ x: u * total, y: soffitY(u * total), z: v * WIDTH }), STEPS * 2, 5);

  // handrail and balusters on both sides, structural only. a rail is a rope in
  // a casing, not a woven panel, so it carries no grid
  for (const z of [0, WIDTH]) {
    let prev = -1;
    for (let i = 0; i <= STEPS; i++) {
      const x = i * RUN;
      const y = i * RISE - RAIL;
      const cur = m.v(x, y, z);
      if (prev >= 0) m.e(prev, cur, true);
      prev = cur;
      if (i < STEPS) m.e(cur, m.v(x, i * RISE, z), true);
    }
  }

  // the landing at the top, and the hanger tapes that carry the whole piece
  m.patch((u, v) => ({ x: -RUN * 1.6 + u * RUN * 1.6, y: 0, z: v * WIDTH }), 3, 5);
  const hang: number[] = [];
  for (const z of [0, WIDTH]) {
    for (const x of [-RUN * 1.6, total]) {
      const top = m.v(x, -RAIL * 2.6, z);
      m.e(top, m.v(x, x <= 0 ? 0 : STEPS * RISE - RISE, z), true);
      hang.push(top);
    }
  }
  // the tape line across the ceiling, which is the only thing in tension here
  m.e(hang[0], hang[1], true);
  m.e(hang[2], hang[3], true);
  m.e(hang[0], hang[2], true);
  m.e(hang[1], hang[3], true);

  return { mesh: m, hang, total };
}

export default function HangingGhost({
  variant = "full",
  drape = 0.5,
  swing = 9,
  className,
}: HangingGhostProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [grid, setGrid] = useState(true);
  const gridRef = useRef(grid);
  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

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

      const { mesh, total } = buildStaircase();
      const n = mesh.verts.length;
      // cells grouped by the panel they were cut from, so each panel can be
      // laid down as one wash and one weave
      const byPanel: Face[][] = Array.from({ length: mesh.panels }, () => []);
      for (const f of mesh.faces) byPanel[f.panel].push(f);

      // centre the model on its own bounding box so the projection has no bias
      let minX = 1e9,
        maxX = -1e9,
        minY = 1e9,
        maxY = -1e9;
      for (const v of mesh.verts) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      const ox = (minX + maxX) / 2;
      const oy = (minY + maxY) / 2;
      const oz = WIDTH / 2;
      const scale = Math.min(W / (maxX - minX + WIDTH * 0.9), H / (maxY - minY + 90)) * 0.86;
      const cx = W / 2;
      const cy = H * 0.5;

      // the ceiling tapes. everything hanging below them is free to sag
      const pinned = mesh.verts.map((v) => v.y <= minY + 0.5);

      const engine = Engine.create();
      engine.gravity.x = 0;
      engine.gravity.y = 0.34;
      engine.constraintIterations = 4;
      engine.positionIterations = 6;
      engine.velocityIterations = 5;

      const soft = 0.16 - clamp(drape, 0, 1) * 0.128; // anchor compliance dial
      const bodies: Body[] = [];
      const anchors: Constraint[] = [];
      const rest = new Float64Array(n * 2);
      const depth = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        const b = Bodies.circle(cx, cy, 2, {
          frictionAir: 0.09, // cloth is nearly all area, so drag dominates
          restitution: 0,
          collisionFilter: { group: 0, category: 2, mask: 0 }, // lines, not solids
        });
        Body.setMass(b, 1);
        bodies.push(b);
        anchors.push(
          Constraint.create({
            pointA: { x: cx, y: cy },
            bodyB: b,
            length: 0,
            stiffness: pinned[i] ? 0.9 : soft,
            damping: 0.12,
            render: { visible: false },
          }),
        );
      }

      const yarns: Constraint[] = mesh.edges.map((ed) =>
        Constraint.create({
          bodyA: bodies[ed.a],
          bodyB: bodies[ed.b],
          length: 1,
          stiffness: ed.struct ? 0.5 : 0.22,
          damping: 0.08,
          render: { visible: false },
        }),
      );

      Composite.add(engine.world, [...bodies, ...anchors, ...yarns]);

      /* ---- pointer. target angles, never applied directly ---- */
      let yawT = 0;
      let pitchT = 0;
      let yaw = 0;
      let pitch = 0;
      let grabbed = -1;
      const gp = { x: 0, y: 0 };
      const grabC = Constraint.create({
        pointA: { x: cx, y: cy },
        bodyB: bodies[0],
        length: 0,
        stiffness: 0.02,
        damping: 0.2,
        render: { visible: false },
      });

      const local = (ev: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top };
      };
      const onMove = (ev: PointerEvent) => {
        const p = local(ev);
        yawT = ((p.x / W) * 2 - 1) * (swing * Math.PI) / 180;
        pitchT = ((p.y / H) * 2 - 1) * ((swing * 0.55) * Math.PI) / 180;
        gp.x = p.x;
        gp.y = p.y;
        if (grabbed >= 0) {
          grabC.pointA.x = p.x;
          grabC.pointA.y = p.y;
        }
      };
      const onDown = (ev: PointerEvent) => {
        const p = local(ev);
        let best = -1;
        let bd = 34 * 34;
        for (let i = 0; i < n; i++) {
          if (pinned[i]) continue;
          const dx = bodies[i].position.x - p.x;
          const dy = bodies[i].position.y - p.y;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (best < 0) return;
        grabbed = best;
        grabC.bodyB = bodies[best];
        grabC.pointA.x = p.x;
        grabC.pointA.y = p.y;
        Composite.add(engine.world, grabC);
        canvas.setPointerCapture(ev.pointerId);
      };
      const onUp = () => {
        if (grabbed < 0) return;
        grabbed = -1;
        Composite.remove(engine.world, grabC);
      };
      const onLeave = () => {
        yawT = 0;
        pitchT = 0;
        onUp();
      };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointerleave", onLeave);

      /* ---- one frame ---- */
      const t0 = performance.now();
      let last = t0;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = clamp(now - last, 8, 40);
        last = now;
        const t = (now - t0) / 1000;

        // the breath. a degree and a half of yaw on a slow sine, plus a slower
        // heave, so the piece is never quite still and never obviously moving
        const breathY = Math.sin(t * 0.31) * 0.026;
        const breathP = Math.sin(t * 0.22 + 1.1) * 0.012;
        // angles chase the pointer instead of tracking it. this is the lag
        yaw += (yawT + breathY - yaw) * 0.045;
        pitch += (pitchT + breathP - pitch) * 0.045;

        const cyw = Math.cos(yaw);
        const syw = Math.sin(yaw);
        const cpt = Math.cos(pitch);
        const spt = Math.sin(pitch);
        const heave = Math.sin(t * 0.19) * 3.2;

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
          depth[i] = z2;
          anchors[i].pointA.x = rest[i * 2];
          anchors[i].pointA.y = rest[i * 2 + 1];
        }

        // yarns hold whatever shape the projection is currently showing
        for (let e = 0; e < yarns.length; e++) {
          const ed = mesh.edges[e];
          const dx = rest[ed.b * 2] - rest[ed.a * 2];
          const dy = rest[ed.b * 2 + 1] - rest[ed.a * 2 + 1];
          yarns[e].length = Math.hypot(dx, dy);
        }

        Engine.update(engine, dt);

        // a seam has a length. no vertex gets to walk further than it
        for (let i = 0; i < n; i++) {
          const b = bodies[i];
          const dx = b.position.x - rest[i * 2];
          const dy = b.position.y - rest[i * 2 + 1];
          const d = Math.hypot(dx, dy);
          if (d > MAX_SLIP) {
            const f = MAX_SLIP / d;
            Body.setPosition(b, {
              x: rest[i * 2] + dx * f,
              y: rest[i * 2 + 1] + dy * f,
            });
            Body.setVelocity(b, Vector.mult(b.velocity, 0.4));
          }
        }

        draw();
      };

      /* ---- drawing ---- */
      const panelDepth = new Float64Array(mesh.panels);
      const order = Array.from({ length: mesh.panels }, (_, i) => i);

      const draw = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // the room is not white. a saturated translucent object throws its own
        // colour on everything around it, and that bounce is most of why the
        // reference photographs read as an installation and not as a drawing
        paintRoom(ctx, W, H, PAL, cx, cy * 0.92, 1);

        // the one piece of evidence that this is a physical object in a room
        const shy = cy + (maxY - oy) * scale + 26;
        const g = ctx.createRadialGradient(cx, shy, 0, cx, shy, total * scale * 0.62);
        g.addColorStop(0, `rgba(${PAL.line}, 0.14)`);
        g.addColorStop(0.55, `rgba(${PAL.line}, 0.05)`);
        g.addColorStop(1, `rgba(${PAL.line}, 0)`);
        ctx.globalCompositeOperation = "multiply";
        ctx.save();
        ctx.translate(cx, shy);
        ctx.scale(1, 0.13);
        ctx.translate(-cx, -shy);
        ctx.fillStyle = g;
        ctx.fillRect(0, shy - total * scale, W, total * scale * 2);
        ctx.restore();

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // panels go down back to front. multiply does not care about order, but
        // the depth fade does: far cloth sits behind more layers of near cloth,
        // so it really is paler
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

        const showWeave = gridRef.current;
        for (const p of order) {
          const list = byPanel[p];
          if (!list.length) continue;
          const near = 1 - (panelDepth[p] - dMin) / span; // 1 nearest, 0 furthest
          const fade = 0.55 + near * 0.45;

          // the body of the panel. one path for the whole piece, because cells
          // inside a panel tile rather than overlap and it must not darken
          // against itself. only cloth in front of other cloth darkens
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

          if (!showWeave) continue;
          // and the weave itself, four threads to the simulated cell. two
          // layers of this at different projected pitches is what throws moire
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

        // seams and hems last, twice: a wide faint pass for the light that
        // spills round a doubled edge, then the thread itself
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
  }, [drape, swing]);

  return (
    <div className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""} ${className ?? ""}`}>
      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      <div className={styles.hud}>
        <span className={styles.state}>staircase, organza, hung from the ceiling</span>
        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.btn} ${grid ? styles.on : ""}`}
            onClick={() => setGrid((g) => !g)}
          >
            seam grid
          </button>
          <span className={styles.hint}>move to turn it, drag a panel</span>
        </div>
      </div>
    </div>
  );
}
