"use client";

/**
 * Constellation
 * -------------
 * An ambient + interactive particle-field background. Points drift, link to
 * nearby points, gently follow the cursor, and scatter on click. Fully
 * config-driven so it can be tuned in /constellation-lab and reused.
 *
 * Currently used as the background of the /work/in-progress placeholder page
 * (case studies still being built).
 */

import { useEffect, useRef } from "react";

export type ConstellationConfig = {
  /** node density — points per 100k px² of viewport */
  density: number;
  linkDist: number;
  cursorDist: number;
  speed: number;
  attract: number;
  dotSize: number;
  nodeColor: string; // hex
  linkColor: string; // hex
  accentColor: string; // hex — cursor node, cursor links, click bursts
  nodeOpacity: number;
  linkOpacity: number;
};

export const DEFAULT_CONSTELLATION: ConstellationConfig = {
  density: 6,
  linkDist: 132,
  cursorDist: 175,
  speed: 0.24,
  attract: 0.045,
  dotSize: 1.8,
  nodeColor: "#717C4D",
  linkColor: "#717C4D",
  accentColor: "#C97836",
  nodeOpacity: 0.55,
  linkOpacity: 0.26,
};

function hexToRgb(hex: string): string {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return "0,0,0";
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

type Node = { x: number; y: number; vx: number; vy: number };

export default function Constellation({
  config = DEFAULT_CONSTELLATION,
  className,
  style,
}: {
  config?: ConstellationConfig;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cfg = useRef(config);
  cfg.current = config;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    let raf = 0;
    const nodes: Node[] = [];
    const bursts: { x: number; y: number; vx: number; vy: number; life: number }[] =
      [];
    const mouse = { x: -9999, y: -9999, active: false };

    const size = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    const desiredCount = () =>
      Math.round(Math.min(160, Math.max(12, (w * h * cfg.current.density) / 100000)));
    const spawn = () =>
      nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * cfg.current.speed,
        vy: (Math.random() - 0.5) * cfg.current.speed,
      });
    for (let i = desiredCount(); i > 0; i--) spawn();

    const rel = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onMove = (e: PointerEvent) => {
      rel(e);
      mouse.active = true;
    };
    const onDown = (e: PointerEvent) => {
      rel(e);
      const acc = hexToRgb(cfg.current.accentColor);
      for (let i = 0; i < 14; i++) {
        const a = (Math.PI * 2 * i) / 14;
        const s = 1 + Math.random() * 2.2;
        bursts.push({ x: mouse.x, y: mouse.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 });
      }
      void acc;
    };
    const onLeave = () => (mouse.active = false);
    const onResize = () => size();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("pointerleave", onLeave);

    const loop = () => {
      const c = cfg.current;
      const node = hexToRgb(c.nodeColor);
      const link = hexToRgb(c.linkColor);
      const accent = hexToRgb(c.accentColor);

      // keep node count in sync with density
      const want = desiredCount();
      while (nodes.length < want) spawn();
      while (nodes.length > want) nodes.pop();

      ctx.clearRect(0, 0, w, h);

      for (const p of nodes) {
        if (mouse.active) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < c.cursorDist && d > 1) {
            const f = (1 - d / c.cursorDist) * c.attract;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x += w;
        else if (p.x > w) p.x -= w;
        if (p.y < 0) p.y += h;
        else if (p.y > h) p.y -= h;
      }

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < c.linkDist) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${link},${(1 - d / c.linkDist) * c.linkOpacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
        if (mouse.active) {
          const d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
          if (d < c.cursorDist) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.strokeStyle = `rgba(${accent},${(1 - d / c.cursorDist) * 0.5})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      for (const p of nodes) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, c.dotSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${node},${c.nodeOpacity})`;
        ctx.fill();
      }
      if (mouse.active) {
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, c.dotSize + 1.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent},0.9)`;
        ctx.fill();
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const p = bursts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life -= 0.02;
        if (p.life <= 0) {
          bursts.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent},${p.life})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={className ?? "absolute inset-0 h-full w-full"}
      style={style}
    />
  );
}
