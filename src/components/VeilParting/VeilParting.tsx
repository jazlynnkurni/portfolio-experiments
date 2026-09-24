"use client";

import { useEffect, useRef, useState } from "react";
import { Bodies, Body, Composite, Constraint, Engine } from "matter-js";
import { ACID, paintRoom, washCell, weaveCell } from "@/components/FabricSkin/skin";
import styles from "./VeilParting.module.css";

/**
 * VeilParting - a sink standing behind a hanging veil of the same cloth.
 *
 * This one is about the rule that interaction should reveal rather than open.
 * There is no overlay to dismiss and nothing fades. A sheet of the same mesh
 * hangs in front of the object, and because every stroke multiplies, the sink
 * behind it is simply harder to read where there is more cloth in the way. Push
 * the veil aside with the pointer and the sink comes clear, not because
 * anything changed opacity but because you moved the fabric off it.
 *
 * THE VEIL IS A REAL CLOTH SOLVE, not a displacement map. Three constraint
 * families at very different stiffness, which is the whole difference between
 * fabric and a rubber sheet:
 *   - warp and weft, near rigid, because a woven yarn does not stretch;
 *   - bias diagonals an order softer, which is what lets it fold instead of
 *     bulging;
 *   - bending across skipped neighbours, almost free, which only sets how
 *     coarse a crease it is allowed to pick.
 * Plus a very soft anchor per vertex back to plumb, because a hung curtain does
 * come back, and high air drag, because cloth is nearly all area and almost no
 * mass.
 *
 * THE POINTER IS A BODY, NOT A FORCE FIELD. It has a radius and it carries the
 * velocity you are moving it at, so the cloth is swept rather than attracted,
 * it keeps moving after you stop, and a fast swipe throws a fold that travels
 * along the hem and dies in the drag. The hem row is weighted, the way a real
 * curtain is, so it swings last and settles last.
 */

type VeilPartingProps = {
  variant?: "full" | "embed";
  /** columns of yarn across the veil. more is finer cloth and more solver work */
  cols?: number;
  /** how much the veil resists being pushed, 0 gauze .. 1 canvas */
  weight?: number;
  className?: string;
};

const PAL = ACID;

const W_STRUCT = 1.5;
const W_HAIR = 0.5;
const A_STRUCT = 0.24;
const A_HAIR = 0.1;
const A_WASH = 0.08;
const A_BLOOM = 0.04;
const THREADS = 4;
const A_BEHIND = 0.62; // the object is one more layer of cloth away than the veil

const FOCAL = 1000;
const POINTER_R = 42;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type V3 = { x: number; y: number; z: number };
type Edge = { a: number; b: number; struct: boolean };
type Face = { a: number; b: number; c: number; d: number; panel: number };

class Mesh {
  verts: V3[] = [];
  edges: Edge[] = [];
  faces: Face[] = [];
  panels = 0;
  private vmap = new Map<string, number>();

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
    if (a !== b) this.edges.push({ a, b, struct });
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

/** The room behind the veil: a tiled wall, a pedestal sink, two taps and a
 *  mirror. All of it is the same sewn cloth, none of it moves. */
function buildRoom() {
  const m = new Mesh();
  const WALL = 300;
  const TILE = 10;

  // subway tiling, offset course by course, which is what makes the wall read
  // as a wall rather than as graph paper
  for (let r = 0; r < 14; r++) {
    const y = -WALL * 0.62 + r * TILE * 1.6;
    const off = r % 2 ? TILE : 0;
    for (let c = -9; c <= 9; c++) {
      const x = c * TILE * 2 + off;
      m.patch((u, v) => ({ x: x + u * TILE * 2, y: y + v * TILE * 1.6, z: -60 }), 1, 1);
    }
  }

  // the mirror, a plain frame hung above the basin
  m.patch((u, v) => ({ x: -52 + u * 104, y: -186 + v * 92, z: -58 }), 4, 4);

  // basin. a shallow box with a thick rim, gridded so it reads sewn
  const BW = 118;
  const BD = 68;
  const BH = 26;
  for (const y of [-46, -46 + BH]) m.patch((u, v) => ({ x: -BW / 2 + u * BW, y, z: -BD / 2 + v * BD }), 5, 3);
  m.patch((u, v) => ({ x: -BW / 2 + u * BW, y: -46 + v * BH, z: -BD / 2 }), 5, 1);
  m.patch((u, v) => ({ x: -BW / 2 + u * BW, y: -46 + v * BH, z: BD / 2 }), 5, 1);
  m.patch((u, v) => ({ x: -BW / 2, y: -46 + v * BH, z: -BD / 2 + u * BD }), 3, 1);
  m.patch((u, v) => ({ x: BW / 2, y: -46 + v * BH, z: -BD / 2 + u * BD }), 3, 1);
  // the bowl, a dish sunk into the rim
  m.patch(
    (u, v) => {
      const a = u * Math.PI * 2;
      const rr = 1 - v;
      return { x: Math.cos(a) * 44 * rr, y: -46 + BH * 0.2 + v * 16, z: Math.sin(a) * 24 * rr };
    },
    16,
    3,
  );

  // pedestal, tapering to the floor, and its plinth
  m.patch((u, v) => {
    const a = u * Math.PI * 2;
    const rr = 22 + v * 12;
    return { x: Math.cos(a) * rr, y: -20 + v * 96, z: Math.sin(a) * rr * 0.7 };
  }, 12, 5);
  m.patch((u, v) => ({ x: -40 + u * 80, y: 76, z: -28 + v * 56 }), 4, 3);

  // taps and spout, structural only, because a tap is not cloth
  for (const tx of [-34, 34]) {
    const a = m.v(tx, -46, -22);
    const b = m.v(tx, -70, -22);
    m.e(a, b, true);
    m.e(b, m.v(tx + 9, -74, -22), true);
    m.e(b, m.v(tx - 9, -74, -22), true);
  }
  const s0 = m.v(0, -46, -22);
  const s1 = m.v(0, -78, -22);
  const s2 = m.v(0, -78, -6);
  const s3 = m.v(0, -68, -6);
  m.e(s0, s1, true);
  m.e(s1, s2, true);
  m.e(s2, s3, true);

  return m;
}

export default function VeilParting({
  variant = "full",
  cols = 26,
  weight = 0.5,
  className,
}: VeilPartingProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pinned, setPinned] = useState(true);
  const pinRef = useRef(pinned);
  useEffect(() => {
    pinRef.current = pinned;
  }, [pinned]);

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

      const room = buildRoom();
      const roomN = room.verts.length;
      const rx = new Float64Array(roomN);
      const ry = new Float64Array(roomN);
      const scale = Math.min(W / 340, H / 400);
      const cx = W / 2;
      const cy = H * 0.52;

      /* ---- the veil ---- */
      const NX = clamp(Math.round(cols), 10, 40);
      const NY = Math.max(8, Math.round((NX * H) / W / 1.15));
      const gx = W / NX;
      const gy = (H * 1.04) / NY;
      const stiff = 0.45 + clamp(weight, 0, 1) * 0.45;

      const engine = Engine.create();
      engine.gravity.x = 0;
      engine.gravity.y = 0.55;
      engine.constraintIterations = 5; // cloth needs passes or the yarn reads elastic
      engine.positionIterations = 6;
      engine.velocityIterations = 5;

      const grid: Body[][] = [];
      const rest: { x: number; y: number }[][] = [];
      const anchors: Constraint[] = [];
      const all: Body[] = [];
      for (let i = 0; i <= NX; i++) {
        grid[i] = [];
        rest[i] = [];
        for (let j = 0; j <= NY; j++) {
          const x = i * gx;
          const y = -gy * 0.5 + j * gy;
          rest[i][j] = { x, y };
          const b = Bodies.circle(x, y, Math.min(gx, gy) * 0.42, {
            frictionAir: 0.075,
            restitution: 0,
            friction: 0.6,
            slop: 0.02,
            // the veil only ever meets the pointer. yarn to yarn contact is
            // carried by the constraints, not by collision
            collisionFilter: { group: 0, category: 2, mask: 1 },
          });
          // the hem is weighted, the way a curtain is, so it swings last
          Body.setMass(b, j === NY ? 2.4 : 1);
          grid[i][j] = b;
          all.push(b);
          const stiffness = j === 0 ? 1 : 0.016;
          anchors.push(
            Constraint.create({
              pointA: { x, y },
              bodyB: b,
              length: 0,
              stiffness,
              damping: j === 0 ? 0.2 : 0.06,
              render: { visible: false },
            }),
          );
        }
      }

      const yarns: Constraint[] = [];
      const link = (a: Body, b: Body, s: number, d: number) => {
        const c = Constraint.create({
          bodyA: a,
          bodyB: b,
          length: Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y),
          stiffness: s,
          damping: d,
          render: { visible: false },
        });
        yarns.push(c);
      };
      for (let i = 0; i <= NX; i++) {
        for (let j = 0; j <= NY; j++) {
          if (i < NX) link(grid[i][j], grid[i + 1][j], stiff, 0.06); // weft
          if (j < NY) link(grid[i][j], grid[i][j + 1], stiff, 0.06); // warp
          if (i < NX && j < NY) {
            link(grid[i][j], grid[i + 1][j + 1], 0.16, 0.03); // bias
            link(grid[i + 1][j], grid[i][j + 1], 0.16, 0.03);
          }
          if (i < NX - 1) link(grid[i][j], grid[i + 2][j], 0.05, 0.02); // bending
          if (j < NY - 1) link(grid[i][j], grid[i][j + 2], 0.05, 0.02);
        }
      }

      const hand = Bodies.circle(-500, -500, POINTER_R, {
        isStatic: true,
        friction: 0.4,
        collisionFilter: { group: 0, category: 1, mask: 2 },
      });

      // something for a dropped veil to land on. it only matters once the rod
      // lets go, but without it the cloth falls out of the frame and is gone
      const floor = Bodies.rectangle(W / 2, H + 30, W * 3, 60, {
        isStatic: true,
        friction: 0.95,
        restitution: 0,
        collisionFilter: { group: 0, category: 1, mask: 2 },
      });

      Composite.add(engine.world, [...all, ...anchors, ...yarns, hand, floor]);

      const ptr = { x: -500, y: -500, px: -500, py: -500, on: false };
      const onMove = (ev: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        ptr.x = ev.clientX - r.left;
        ptr.y = ev.clientY - r.top;
        ptr.on = true;
      };
      const onLeave = () => {
        ptr.on = false;
        ptr.x = -500;
        ptr.y = -500;
      };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);

      const t0 = performance.now();
      let last = t0;
      let yaw = 0;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = clamp(now - last, 8, 40);
        last = now;
        const t = (now - t0) / 1000;

        // the room parallaxes a couple of degrees behind the veil, which is
        // what separates the two planes without moving the veil itself
        yaw += ((ptr.on ? (ptr.x / W) * 2 - 1 : 0) * 0.13 + Math.sin(t * 0.2) * 0.012 - yaw) * 0.035;
        const cyw = Math.cos(yaw);
        const syw = Math.sin(yaw);
        for (let i = 0; i < roomN; i++) {
          const v = room.verts[i];
          const x1 = v.x * cyw + v.z * syw;
          const z1 = -v.x * syw + v.z * cyw;
          const k = (FOCAL / (FOCAL + z1 * scale)) * scale;
          rx[i] = cx + x1 * k;
          ry[i] = cy + v.y * k;
        }

        // the hand carries its own velocity, so the cloth is swept and keeps
        // travelling after the pointer stops
        if (ptr.on) {
          Body.setPosition(hand, { x: ptr.x, y: ptr.y });
          Body.setVelocity(hand, { x: ptr.x - ptr.px, y: ptr.y - ptr.py });
        } else {
          Body.setPosition(hand, { x: -500, y: -500 });
          Body.setVelocity(hand, { x: 0, y: 0 });
        }
        ptr.px = ptr.x;
        ptr.py = ptr.y;

        // a slow draught through the room, so the veil is never quite still
        const gust = Math.sin(t * 0.27) * 0.6 + Math.sin(t * 0.61 + 2) * 0.25;
        for (let i = 0; i <= NX; i++) {
          for (let j = 1; j <= NY; j++) {
            const b = grid[i][j];
            Body.applyForce(b, b.position, {
              x: gust * 0.000028 * (j / NY) * (0.6 + Math.sin(i * 0.7 + t * 0.5) * 0.4),
              y: 0,
            });
          }
        }

        // the rod. take it away and nothing is holding the cloth to plumb
        // either, so the whole veil comes down and heaps on the floor
        const hung = pinRef.current;
        for (let i = 0; i <= NX; i++) {
          for (let j = 0; j <= NY; j++) {
            anchors[i * (NY + 1) + j].stiffness = hung ? (j === 0 ? 1 : 0.016) : 0;
          }
        }

        Engine.update(engine, dt);
        draw();
      };

      const roomByPanel: Face[][] = Array.from({ length: room.panels }, () => []);
      for (const f of room.faces) roomByPanel[f.panel].push(f);

      const draw = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintRoom(ctx, W, H, PAL, cx, cy - 40 * scale, 1);

        // the sink stands on something, so it gets the one soft shadow
        const shy = cy + 78 * scale;
        const g = ctx.createRadialGradient(cx, shy, 0, cx, shy, 150 * scale);
        g.addColorStop(0, `rgba(${PAL.line}, 0.13)`);
        g.addColorStop(0.55, `rgba(${PAL.line}, 0.04)`);
        g.addColorStop(1, `rgba(${PAL.line}, 0)`);
        ctx.globalCompositeOperation = "multiply";
        ctx.save();
        ctx.translate(cx, shy);
        ctx.scale(1, 0.12);
        ctx.translate(-cx, -shy);
        ctx.fillStyle = g;
        ctx.fillRect(0, shy - 150 * scale, W, 300 * scale);
        ctx.restore();

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // the room, one layer further away. tiles, basin, pedestal and mirror
        // each get their own wash, so the sink darkens where its own panels
        // overlap before the veil is even counted
        for (const list of roomByPanel) {
          if (!list.length) continue;
          ctx.beginPath();
          for (const f of list) {
            washCell(ctx, rx[f.a], ry[f.a], rx[f.b], ry[f.b], rx[f.c], ry[f.c], rx[f.d], ry[f.d]);
          }
          ctx.fillStyle = `rgba(${PAL.wash}, ${A_WASH * A_BEHIND})`;
          ctx.fill();

          ctx.beginPath();
          for (const f of list) {
            weaveCell(
              ctx,
              rx[f.a],
              ry[f.a],
              rx[f.b],
              ry[f.b],
              rx[f.c],
              ry[f.c],
              rx[f.d],
              ry[f.d],
              THREADS,
            );
          }
          ctx.lineWidth = W_HAIR;
          ctx.strokeStyle = `rgba(${PAL.line}, ${A_HAIR * A_BEHIND})`;
          ctx.stroke();
        }

        ctx.beginPath();
        for (const ed of room.edges) {
          if (!ed.struct) continue;
          ctx.moveTo(rx[ed.a], ry[ed.a]);
          ctx.lineTo(rx[ed.b], ry[ed.b]);
        }
        ctx.lineWidth = 5;
        ctx.strokeStyle = `rgba(${PAL.wash}, ${A_BLOOM})`;
        ctx.stroke();
        ctx.lineWidth = W_STRUCT;
        ctx.strokeStyle = `rgba(${PAL.line}, ${A_STRUCT * A_BEHIND})`;
        ctx.stroke();

        // the veil. its body first, which is what actually obscures the sink,
        // then the weave, then the selvedges and the hem
        ctx.beginPath();
        for (let i = 0; i < NX; i++) {
          for (let j = 0; j < NY; j++) {
            const a = grid[i][j].position;
            const b = grid[i + 1][j].position;
            const c = grid[i + 1][j + 1].position;
            const d = grid[i][j + 1].position;
            washCell(ctx, a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
          }
        }
        ctx.fillStyle = `rgba(${PAL.wash}, ${A_WASH})`;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < NX; i++) {
          for (let j = 0; j < NY; j++) {
            const a = grid[i][j].position;
            const b = grid[i + 1][j].position;
            const c = grid[i + 1][j + 1].position;
            const d = grid[i][j + 1].position;
            weaveCell(ctx, a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y, THREADS);
          }
        }
        for (let i = 0; i <= NX; i++) {
          for (let j = 0; j <= NY; j++) {
            const p = grid[i][j].position;
            if (i < NX) {
              const q = grid[i + 1][j].position;
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
            }
            if (j < NY) {
              const q = grid[i][j + 1].position;
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
            }
          }
        }
        ctx.lineWidth = W_HAIR;
        ctx.strokeStyle = `rgba(${PAL.line}, ${A_HAIR})`;
        ctx.stroke();

        ctx.beginPath();
        for (let j = 0; j <= NY; j++) {
          if (j < NY) {
            for (const i of [0, NX]) {
              const p = grid[i][j].position;
              const q = grid[i][j + 1].position;
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
            }
          }
        }
        for (let i = 0; i < NX; i++) {
          for (const j of [0, NY]) {
            const p = grid[i][j].position;
            const q = grid[i + 1][j].position;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
          }
        }
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
  }, [cols, weight]);

  return (
    <div className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""} ${className ?? ""}`}>
      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      <div className={styles.hud}>
        <span className={styles.state}>{pinned ? "veil on its rod" : "veil dropped"}</span>
        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.btn} ${pinned ? styles.on : ""}`}
            onClick={() => setPinned((p) => !p)}
          >
            {pinned ? "let it fall" : "hang it back"}
          </button>
          <span className={styles.hint}>sweep to part the cloth</span>
        </div>
      </div>
    </div>
  );
}
