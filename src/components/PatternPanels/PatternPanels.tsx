"use client";

import { useEffect, useRef, useState } from "react";
import { Bodies, Body, Composite, Constraint, Engine } from "matter-js";
import { JADE, paintRoom, washCell, weaveCell } from "@/components/FabricSkin/skin";
import styles from "./PatternPanels.module.css";

/**
 * PatternPanels - a door taken apart into the flat pieces it was sewn from.
 *
 * The whole conceit of the fabric work is that a solid object is really a set
 * of flat panels with seams between them, so this one scrolls between the two
 * readings. At the top of the scroll it is a door standing in its frame. By the
 * bottom it is a cutting layout: leaf front, leaf back, four edge strips, three
 * frame straps and a handle ring, laid out side by side the way a pattern is
 * laid on the cloth before anyone cuts it.
 *
 * NO PANEL IS DEDUPED. Panels that meet at a seam keep two separate rows of
 * vertices, joined by stitch constraints. That is the actual construction, and
 * it is what makes the opening legible: the seam is a thing that pays out, not
 * a fold in one continuous sheet.
 *
 * THE PHYSICS DOES THE CHOREOGRAPHY. Nothing animates a panel along a path.
 * Every vertex is given a rest point that is the blend of where it sits on the
 * standing door and where it sits in the flat layout, and a matter body chases
 * that point through a soft anchor while its neighbours pull on it. The swing,
 * the overshoot and the settle at the end are all just mass and air drag
 * arriving late. Panels are staggered a few percent of the scroll apart, so the
 * piece unpicks itself in order instead of exploding.
 *
 * HOVER REVEALS, IT DOES NOT SELECT. Pointing at a panel raises its density and
 * fades its pattern name in. No border, no fill, no highlight.
 */

type PatternPanelsProps = {
  variant?: "full" | "embed";
  /** how far each panel sags on its own seams, 0 stiff .. 1 loose */
  drape?: number;
  className?: string;
};

const PAL = JADE;

const W_STRUCT = 1.6;
const W_HAIR = 0.5;
const A_STRUCT = 0.24;
const A_HAIR = 0.1;
const A_WASH = 0.085;
const A_BLOOM = 0.045;
const THREADS = 4;

/* ---- door, in model units ---- */
const DW = 84;
const DH = 190;
const TH = 9; // leaf thickness
const JAMB = 15; // width of the frame strap
const FOCAL = 1000;
const MAX_SLIP = 26;

const MONO = `var(--font-ibm-mono), "IBM Plex Mono", ui-monospace, monospace`;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

type Panel = { name: string; from: number; to: number; delay: number };
type Edge = { a: number; b: number; struct: boolean };
type Face = { a: number; b: number; c: number; d: number; panel: number };

type Built = {
  solid: { x: number; y: number; z: number }[];
  flat: { x: number; y: number }[];
  edges: Edge[];
  faces: Face[];
  panels: Panel[];
  panelOf: Int16Array;
};

function buildDoor(): Built {
  const solid: { x: number; y: number; z: number }[] = [];
  const flat: { x: number; y: number }[] = [];
  const edges: Edge[] = [];
  const faces: Face[] = [];
  const panels: Panel[] = [];
  const owner: number[] = [];

  /** one cut piece: a parametric surface on the standing door, and a rectangle
   *  in the cutting layout. the same (u, v) addresses both. */
  const piece = (
    name: string,
    delay: number,
    f: (u: number, v: number) => { x: number; y: number; z: number },
    fx: number,
    fy: number,
    fw: number,
    fh: number,
    nu: number,
    nv: number,
  ) => {
    const from = solid.length;
    const idx: number[][] = [];
    for (let i = 0; i <= nu; i++) {
      idx[i] = [];
      for (let j = 0; j <= nv; j++) {
        const u = i / nu;
        const v = j / nv;
        idx[i][j] = solid.length;
        solid.push(f(u, v));
        flat.push({ x: fx + u * fw, y: fy + v * fh });
        owner.push(panels.length);
      }
    }
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        if (i < nu) edges.push({ a: idx[i][j], b: idx[i + 1][j], struct: j === 0 || j === nv });
        if (j < nv) edges.push({ a: idx[i][j], b: idx[i][j + 1], struct: i === 0 || i === nu });
        if (i < nu && j < nv) {
          edges.push({ a: idx[i][j], b: idx[i + 1][j + 1], struct: false });
          faces.push({
            a: idx[i][j],
            b: idx[i + 1][j],
            c: idx[i + 1][j + 1],
            d: idx[i][j + 1],
            panel: panels.length,
          });
        }
      }
    }
    panels.push({ name, from, to: solid.length, delay });
  };

  // the two faces of the leaf
  piece("leaf, front", 0.02, (u, v) => ({ x: u * DW, y: v * DH, z: 0 }), 0, 0, DW, DH, 4, 9);
  piece("leaf, back", 0.16, (u, v) => ({ x: u * DW, y: v * DH, z: TH }), DW + 24, 0, DW, DH, 4, 9);

  // the four edge strips that give the leaf its thickness
  piece("hinge edge", 0.3, (u, v) => ({ x: 0, y: v * DH, z: u * TH }), -26, 0, TH, DH, 1, 9);
  piece("lock edge", 0.3, (u, v) => ({ x: DW, y: v * DH, z: u * TH }), 2 * DW + 34, 0, TH, DH, 1, 9);
  piece("head edge", 0.38, (u, v) => ({ x: u * DW, y: 0, z: v * TH }), 0, -22, DW, TH, 4, 1);
  piece("sill edge", 0.38, (u, v) => ({ x: u * DW, y: DH, z: v * TH }), 0, DH + 12, DW, TH, 4, 1);

  // the frame the leaf stands in, three straps of the same cloth
  piece(
    "jamb, hinge",
    0.5,
    (u, v) => ({ x: -JAMB + u * JAMB, y: -JAMB + v * (DH + JAMB), z: TH / 2 }),
    -26 - JAMB - 16,
    -JAMB,
    JAMB,
    DH + JAMB,
    1,
    9,
  );
  piece(
    "jamb, lock",
    0.5,
    (u, v) => ({ x: DW + u * JAMB, y: -JAMB + v * (DH + JAMB), z: TH / 2 }),
    2 * DW + 34 + TH + 16,
    -JAMB,
    JAMB,
    DH + JAMB,
    1,
    9,
  );
  piece(
    "head",
    0.6,
    (u, v) => ({ x: -JAMB + u * (DW + 2 * JAMB), y: -JAMB + v * JAMB, z: TH / 2 }),
    0,
    -22 - JAMB - 14,
    DW + 2 * JAMB,
    JAMB,
    5,
    1,
  );

  // the handle. a ring of cloth over a rod, so it is structural all the way
  {
    const from = solid.length;
    const R = 9;
    const N = 14;
    const hx = DW - 14;
    const hy = DH * 0.46;
    const fx = DW + 24 + DW * 0.5;
    const fy = DH + 44;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      solid.push({ x: hx + Math.cos(a) * R, y: hy + Math.sin(a) * R, z: -6 });
      flat.push({ x: fx + Math.cos(a) * R, y: fy + Math.sin(a) * R });
      owner.push(panels.length);
    }
    for (let i = 0; i < N; i++) edges.push({ a: from + i, b: from + ((i + 1) % N), struct: true });
    panels.push({ name: "handle", from, to: solid.length, delay: 0.72 });
  }

  // stitches. two panels that touch on the standing door are sewn together,
  // and those threads are the only thing holding the layout in one piece as it
  // opens out
  const cell = new Map<string, number[]>();
  for (let i = 0; i < solid.length; i++) {
    const p = solid[i];
    const k = `${Math.round(p.x / 5)}:${Math.round(p.y / 5)}:${Math.round(p.z / 5)}`;
    const list = cell.get(k);
    if (list) list.push(i);
    else cell.set(k, [i]);
  }
  for (const list of cell.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a];
        const j = list[b];
        if (owner[i] === owner[j]) continue;
        const p = solid[i];
        const q = solid[j];
        if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > 4) continue;
        edges.push({ a: i, b: j, struct: false });
      }
    }
  }

  return { solid, flat, edges, faces, panels, panelOf: Int16Array.from(owner) };
}

export default function PatternPanels({
  variant = "full",
  drape = 0.5,
  className,
}: PatternPanelsProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(0);

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

      const M = buildDoor();
      const n = M.solid.length;

      // two fits: the standing door, and the whole cutting layout, which is far
      // wider. the view zooms out as it opens, the way a camera pulls back
      const solidScale = (H * 0.78) / (DH + 2 * JAMB);
      let fx0 = 1e9,
        fx1 = -1e9,
        fy0 = 1e9,
        fy1 = -1e9;
      for (const p of M.flat) {
        if (p.x < fx0) fx0 = p.x;
        if (p.x > fx1) fx1 = p.x;
        if (p.y < fy0) fy0 = p.y;
        if (p.y > fy1) fy1 = p.y;
      }
      const flatScale = Math.min((W * 0.9) / (fx1 - fx0), (H * 0.86) / (fy1 - fy0));
      const fcx = (fx0 + fx1) / 2;
      const fcy = (fy0 + fy1) / 2;
      const cx = W / 2;
      const cy = H / 2;

      const engine = Engine.create();
      engine.gravity.x = 0;
      engine.gravity.y = 0.3;
      engine.constraintIterations = 4;
      engine.positionIterations = 6;
      engine.velocityIterations = 5;

      const soft = 0.15 - clamp(drape, 0, 1) * 0.115;
      const bodies: Body[] = [];
      const anchors: Constraint[] = [];
      const rest = new Float64Array(n * 2);
      const depth = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        const b = Bodies.circle(cx, cy, 2, {
          frictionAir: 0.075,
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
            stiffness: soft,
            damping: 0.11,
            render: { visible: false },
          }),
        );
      }
      const yarns = M.edges.map((ed) =>
        Constraint.create({
          bodyA: bodies[ed.a],
          bodyB: bodies[ed.b],
          length: 1,
          stiffness: ed.struct ? 0.5 : 0.24,
          damping: 0.08,
          render: { visible: false },
        }),
      );
      Composite.add(engine.world, [...bodies, ...anchors, ...yarns]);

      /* ---- scroll drives the opening, pointer drives everything else ---- */
      let sT = 0;
      let s = 0;
      let yawT = 0;
      let pitchT = 0;
      let yaw = -0.26;
      let pitch = 0.05;
      const ptr = { x: -1e5, y: -1e5, on: false };
      const hoverAmt = new Float64Array(M.panels.length);
      let hovered = -1;

      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        sT = clamp(sT + ev.deltaY / 1400, 0, 1);
      };
      const onMove = (ev: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        ptr.x = ev.clientX - r.left;
        ptr.y = ev.clientY - r.top;
        ptr.on = true;
        yawT = ((ptr.x / W) * 2 - 1) * 0.16;
        pitchT = ((ptr.y / H) * 2 - 1) * 0.07;
      };
      const onLeave = () => {
        ptr.on = false;
        ptr.x = -1e5;
        yawT = 0;
        pitchT = 0;
      };
      let dragY = 0;
      let dragging = false;
      const onDown = (ev: PointerEvent) => {
        dragging = true;
        dragY = ev.clientY;
        canvas.setPointerCapture(ev.pointerId);
      };
      const onDrag = (ev: PointerEvent) => {
        if (!dragging) return;
        sT = clamp(sT + (dragY - ev.clientY) / -420, 0, 1);
        dragY = ev.clientY;
      };
      const onUp = () => {
        dragging = false;
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointermove", onDrag);
      canvas.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointerleave", onLeave);

      const t0 = performance.now();
      let last = t0;
      let reported = -1;

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = clamp(now - last, 8, 40);
        last = now;
        const t = (now - t0) / 1000;

        s += (sT - s) * 0.07; // the scroll itself lags, before any cloth does
        const shown = Math.round(s * 100);
        if (shown !== reported) {
          reported = shown;
          setOpen(shown);
        }

        yaw += (yawT - 0.26 * (1 - s) + Math.sin(t * 0.27) * 0.02 - yaw) * 0.04;
        pitch += (pitchT + Math.sin(t * 0.19 + 1) * 0.01 - pitch) * 0.04;
        const cyw = Math.cos(yaw);
        const syw = Math.sin(yaw);
        const cpt = Math.cos(pitch);
        const spt = Math.sin(pitch);
        const heave = Math.sin(t * 0.21) * 2.4;

        // hover picks a panel by proximity, and the pick eases rather than flips
        if (ptr.on) {
          let best = -1;
          let bd = 46 * 46;
          for (let i = 0; i < n; i++) {
            const dx = bodies[i].position.x - ptr.x;
            const dy = bodies[i].position.y - ptr.y;
            const d = dx * dx + dy * dy;
            if (d < bd) {
              bd = d;
              best = M.panelOf[i];
            }
          }
          hovered = best;
        } else hovered = -1;
        for (let p = 0; p < hoverAmt.length; p++) {
          hoverAmt[p] += ((p === hovered ? 1 : 0) - hoverAmt[p]) * 0.09;
        }

        for (let p = 0; p < M.panels.length; p++) {
          const pan = M.panels[p];
          // stagger. each piece waits its turn, so the door unpicks in order
          const sp = smooth(clamp((s - pan.delay) / (1 - pan.delay || 1), 0, 1));
          for (let i = pan.from; i < pan.to; i++) {
            const v = M.solid[i];
            const x = v.x - DW / 2;
            const y = v.y - DH / 2;
            const z = v.z - TH / 2;
            const x1 = x * cyw + z * syw;
            const z1 = -x * syw + z * cyw;
            const y2 = y * cpt - z1 * spt;
            const z2 = y * spt + z1 * cpt;
            const k = (FOCAL / (FOCAL + z2 * solidScale)) * solidScale;
            const sx = cx + x1 * k;
            const sy = cy + y2 * k + heave;
            const f = M.flat[i];
            const lx = cx + (f.x - fcx) * flatScale;
            const ly = cy + (f.y - fcy) * flatScale;
            rest[i * 2] = sx + (lx - sx) * sp;
            rest[i * 2 + 1] = sy + (ly - sy) * sp;
            depth[i] = z2 * (1 - sp);
            anchors[i].pointA.x = rest[i * 2];
            anchors[i].pointA.y = rest[i * 2 + 1];
          }
        }

        for (let e = 0; e < yarns.length; e++) {
          const ed = M.edges[e];
          const dx = rest[ed.b * 2] - rest[ed.a * 2];
          const dy = rest[ed.b * 2 + 1] - rest[ed.a * 2 + 1];
          yarns[e].length = Math.hypot(dx, dy);
        }

        Engine.update(engine, dt);

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

        draw(s);
      };

      const byPanel: Face[][] = Array.from({ length: M.panels.length }, () => []);
      for (const f of M.faces) byPanel[f.panel].push(f);
      const structByPanel: Edge[][] = Array.from({ length: M.panels.length }, () => []);
      for (const ed of M.edges) {
        if (ed.struct) structByPanel[M.panelOf[ed.a]].push(ed);
      }

      const draw = (sNow: number) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintRoom(ctx, W, H, PAL, cx, cy, 1 - sNow * 0.45);

        // the floor shadow belongs to the standing door. as the pattern lays
        // out flat there is nothing left standing to cast one, so it goes
        const shAlpha = (1 - sNow) * (1 - sNow);
        ctx.globalCompositeOperation = "multiply";
        if (shAlpha > 0.01) {
          const shy = cy + (DH / 2) * solidScale + 22;
          const spread = DW * solidScale * 1.5;
          const g = ctx.createRadialGradient(cx, shy, 0, cx, shy, spread);
          g.addColorStop(0, `rgba(${PAL.line}, ${0.18 * shAlpha})`);
          g.addColorStop(0.5, `rgba(${PAL.line}, ${0.06 * shAlpha})`);
          g.addColorStop(1, `rgba(${PAL.line}, 0)`);
          ctx.save();
          ctx.translate(cx, shy);
          ctx.scale(1, 0.12);
          ctx.translate(-cx, -shy);
          ctx.fillStyle = g;
          ctx.fillRect(0, shy - spread, W, spread * 2);
          ctx.restore();
        }

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // panels draw one at a time, because hover has to be able to raise a
        // single piece out of the stack without touching the rest. that lift is
        // density, not a highlight: the same cloth, read through more of itself
        for (let p = 0; p < M.panels.length; p++) {
          // the handle is a ring with no cells in it, so it takes the seam pass
          // and nothing else. a rod in a casing is not a woven panel
          const list = byPanel[p];
          const lift = 1 + hoverAmt[p] * 0.85;
          const fade = (0.72 + 0.28 * (1 - clamp((depth[M.panels[p].from] + 60) / 120, 0, 1))) * lift;

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

          ctx.beginPath();
          for (const ed of structByPanel[p]) {
            const a = bodies[ed.a].position;
            const b = bodies[ed.b].position;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.lineWidth = 5.5;
          ctx.strokeStyle = `rgba(${PAL.wash}, ${A_BLOOM * fade})`;
          ctx.stroke();
          ctx.lineWidth = W_STRUCT;
          ctx.strokeStyle = `rgba(${PAL.line}, ${A_STRUCT * fade})`;
          ctx.stroke();
        }

        // pattern names, the way they are chalked on the cloth. they belong to
        // the flat reading, so they arrive with the layout
        ctx.globalCompositeOperation = "source-over";
        ctx.font = `500 10px ${MONO}`;
        ctx.textAlign = "center";
        for (let p = 0; p < M.panels.length; p++) {
          const a = sNow * 0.55 + hoverAmt[p] * 0.45;
          if (a < 0.04) continue;
          const pan = M.panels[p];
          let mx = 0;
          let my = 0;
          for (let i = pan.from; i < pan.to; i++) {
            mx += bodies[i].position.x;
            my += bodies[i].position.y;
          }
          const c = pan.to - pan.from;
          ctx.fillStyle = `rgba(${PAL.line}, ${a * 0.9})`;
          ctx.fillText(pan.name.toUpperCase(), mx / c, my / c);
        }
      };

      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointermove", onDrag);
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
  }, [drape]);

  return (
    <div className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""} ${className ?? ""}`}>
      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      <div className={styles.hud}>
        <span className={styles.state}>
          {open < 6 ? "door, assembled" : open > 94 ? "cutting layout" : `unpicked ${open}%`}
        </span>
        <span className={styles.hint}>scroll or drag to unpick, hover a piece</span>
      </div>
    </div>
  );
}
