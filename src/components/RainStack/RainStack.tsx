"use client";

import { useEffect, useRef } from "react";

/**
 * RainStack - the word RAIN falls like real rain, glides down the umbrella the
 * way water runs off a surface, pours off the edge and pools on the ground,
 * stacking up until it fills the page. Nothing ever appears under the umbrella:
 * its exact silhouette (sampled from the PNG's alpha) blocks every word, so the
 * area beneath reads as a clean dry shadow.
 *
 * Physics:
 *  - free fall accelerates under gravity toward a terminal velocity;
 *  - on contact with the umbrella outline a word rides the surface, tilting to
 *    the local slope (each hit lands at a different angle, so no two are stiff),
 *    accelerating downhill, then releases off the edge as a projectile;
 *  - it lands on a per-column height field and settles, raising the pile.
 *
 * Rendered imperatively (DOM nodes moved each frame) so a full page stays smooth.
 */

const WORD = "RAIN";
const FONT = "var(--font-ibm-mono), 'IBM Plex Mono', ui-monospace, monospace";
const SIZE = 22; // uniform size for every word
const WEIGHT = 400; // uniform weight
const COLOR = "#6c7d97"; // rain blue-grey on white
const OPACITY = 0.92;

const SPAWN_RATE = 7; // words per second (gentle drizzle)
const FALL_SPEED = 130; // initial downward speed, px/s
const GRAVITY = 210; // px/s^2
const TERMINAL = 300; // max fall speed, px/s
const WIND = 0; // horizontal drift, px/s
const PACK = 0.82; // stacking density (fraction of word height added per stack)
const UMBRELLA_W = 300; // umbrella width, px

const COL_W = 6; // height-field resolution, px
const SAMPLE_W = 300; // alpha sampling resolution (columns)
const ALPHA_MIN = 40; // opacity threshold for "covered by umbrella"
const MAX_WORDS = 3200;
const DEG = 180 / Math.PI;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type Drop = {
  el: HTMLSpanElement;
  x: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  vx: number;
  s: number; // along-surface speed while gliding
  rot: number;
  settleRot: number;
  rotBias: number; // per-word tilt personality
  tiltGain: number;
  gliding: boolean;
  hasGlided: boolean;
  dir: number;
  settled: boolean;
  dead: boolean;
};

export default function RainStack() {
  const stageRef = useRef<HTMLDivElement>(null);
  const umbRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let W = stage.clientWidth;
    let H = stage.clientHeight;
    let ncols = Math.max(1, Math.ceil(W / COL_W));
    let surface = new Float32Array(ncols).fill(H);
    let sheltered = new Uint8Array(ncols);
    const drops: Drop[] = [];
    let settledCount = 0;

    // --- umbrella silhouette, sampled from the PNG alpha channel ---
    let ready = false;
    let aspect = 662 / 886;
    const topFrac = new Float32Array(SAMPLE_W).fill(-1); // topmost opaque row / height, per column
    let minFrac = 0;
    let maxFrac = 1; // opaque horizontal extent, as fractions of the image width
    // display geometry in stage coordinates (umbrella centred on the stage)
    let dispH = UMBRELLA_W * aspect;
    let dispLeft = 0;
    let dispTop = 0;
    let spanL = 0;
    let spanR = 0;
    const umbCx = () => W / 2;

    function computeGeom() {
      dispH = UMBRELLA_W * aspect;
      dispLeft = W / 2 - UMBRELLA_W / 2;
      dispTop = H / 2 - dispH / 2;
      spanL = dispLeft + minFrac * UMBRELLA_W;
      spanR = dispLeft + maxFrac * UMBRELLA_W;
      sheltered = new Uint8Array(ncols);
      if (!ready) return;
      for (let i = 0; i < ncols; i++) {
        const x = i * COL_W + COL_W / 2;
        const fx = (x - dispLeft) / UMBRELLA_W;
        if (fx < 0 || fx >= 1) continue;
        const si = Math.min(SAMPLE_W - 1, Math.floor(fx * SAMPLE_W));
        if (topFrac[si] >= 0) sheltered[i] = 1;
      }
    }

    // top surface of the umbrella at stage-x (Infinity where uncovered)
    function umbTopY(x: number): number {
      if (!ready) return Infinity;
      const fx = (x - dispLeft) / UMBRELLA_W;
      if (fx < 0 || fx >= 1) return Infinity;
      const si = Math.min(SAMPLE_W - 1, Math.floor(fx * SAMPLE_W));
      const tf = topFrac[si];
      if (tf < 0) return Infinity;
      return dispTop + tf * dispH;
    }
    function umbSlope(x: number): number {
      const a = umbTopY(x - COL_W);
      const b = umbTopY(x + COL_W);
      if (a === Infinity || b === Infinity) return 0;
      return (b - a) / (2 * COL_W);
    }

    // sample the PNG once it's decoded
    const img = new Image();
    img.src = "/rain-umbrella/umbrella.png";
    img.onload = () => {
      aspect = img.naturalHeight / img.naturalWidth;
      const sh = Math.max(1, Math.round(SAMPLE_W * aspect));
      const cv = document.createElement("canvas");
      cv.width = SAMPLE_W;
      cv.height = sh;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, SAMPLE_W, sh);
      const data = ctx.getImageData(0, 0, SAMPLE_W, sh).data;
      let lo = SAMPLE_W;
      let hi = -1;
      for (let i = 0; i < SAMPLE_W; i++) {
        let firstRow = -1;
        for (let r = 0; r < sh; r++) {
          const a = data[(r * SAMPLE_W + i) * 4 + 3];
          if (a >= ALPHA_MIN) {
            firstRow = r;
            break;
          }
        }
        topFrac[i] = firstRow < 0 ? -1 : firstRow / sh;
        if (firstRow >= 0) {
          if (i < lo) lo = i;
          if (i > hi) hi = i;
        }
      }
      minFrac = hi < 0 ? 0 : lo / SAMPLE_W;
      maxFrac = hi < 0 ? 1 : (hi + 1) / SAMPLE_W;
      ready = true;
      computeGeom();
    };

    function reset() {
      for (const d of drops) d.el.remove();
      drops.length = 0;
      surface = new Float32Array(ncols).fill(H);
      settledCount = 0;
      computeGeom();
    }

    function onResize() {
      W = stage!.clientWidth;
      H = stage!.clientHeight;
      ncols = Math.max(1, Math.ceil(W / COL_W));
      reset();
    }
    window.addEventListener("resize", onResize);
    computeGeom();

    function spawn() {
      if (settledCount >= MAX_WORDS) return;
      const el = document.createElement("span");
      el.textContent = WORD;
      el.style.position = "absolute";
      el.style.left = "0";
      el.style.top = "0";
      el.style.fontFamily = FONT;
      el.style.fontWeight = String(WEIGHT);
      el.style.fontSize = `${SIZE}px`;
      el.style.lineHeight = "1";
      el.style.letterSpacing = "0.02em";
      el.style.color = COLOR;
      el.style.opacity = String(OPACITY);
      el.style.whiteSpace = "nowrap";
      el.style.willChange = "transform";
      el.style.userSelect = "none";
      el.style.pointerEvents = "none";
      stage!.appendChild(el);
      const w = el.offsetWidth || SIZE * 3;
      const h = el.offsetHeight || SIZE;
      const x = Math.random() * Math.max(1, W - w);
      const settleRot = (Math.random() * 2 - 1) * 4;
      const d: Drop = {
        el,
        x,
        y: -h - Math.random() * 60,
        w,
        h,
        vy: FALL_SPEED,
        vx: WIND + (Math.random() * 2 - 1) * 10,
        s: 0,
        rot: settleRot,
        settleRot,
        rotBias: (Math.random() * 2 - 1) * 7,
        tiltGain: 0.35 + Math.random() * 0.4,
        gliding: false,
        hasGlided: false,
        dir: 0,
        settled: false,
        dead: false,
      };
      el.style.transform = `translate3d(${x}px, ${d.y}px, 0) rotate(${d.rot}deg)`;
      drops.push(d);
    }

    function place(d: Drop) {
      d.el.style.transform = `translate3d(${d.x}px, ${d.y}px, 0) rotate(${d.rot}deg)`;
    }

    function settle(d: Drop) {
      const c0 = Math.max(0, Math.floor(d.x / COL_W));
      const c1 = Math.min(ncols - 1, Math.floor((d.x + d.w) / COL_W));
      let rest = Infinity;
      let any = false;
      for (let i = c0; i <= c1; i++) {
        if (sheltered[i]) continue;
        any = true;
        if (surface[i] < rest) rest = surface[i];
      }
      if (!any) {
        d.el.remove();
        d.dead = true;
        return;
      }
      d.y = rest - d.h;
      d.settled = true;
      settledCount++;
      const newSurface = rest - d.h * PACK;
      for (let i = c0; i <= c1; i++) {
        if (sheltered[i]) continue;
        if (newSurface < surface[i]) surface[i] = newSurface;
      }
      place(d);
    }

    let raf = 0;
    let last = performance.now();
    let spawnTimer = 0.3;

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.045) dt = 0.045;

      let minSurf = H;
      for (let i = 0; i < ncols; i++) {
        if (!sheltered[i] && surface[i] < minSurf) minSurf = surface[i];
      }
      const full = minSurf <= SIZE * 1.2;

      if (!full && ready) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawn();
          spawnTimer = (0.5 + Math.random() * 1.4) / SPAWN_RATE;
        }
      }

      for (const d of drops) {
        if (d.settled || d.dead) continue;

        if (d.gliding) {
          const slope = umbSlope(d.x + d.w / 2);
          const theta = Math.atan(slope);
          d.s += (GRAVITY * Math.abs(Math.sin(theta)) + 45) * dt;
          d.x += d.dir * d.s * Math.cos(theta) * dt;
          const cx = d.x + d.w / 2;
          const topY = umbTopY(cx);
          const target = clamp(d.dir * Math.abs(theta) * DEG * d.tiltGain + d.rotBias, -34, 34);
          d.rot += (target - d.rot) * 0.18;
          if (cx <= spanL || cx >= spanR || topY === Infinity) {
            // released off the edge -> projectile
            d.gliding = false;
            d.vx = d.dir * d.s * Math.cos(theta);
            d.vy = Math.max(FALL_SPEED * 0.5, d.s * Math.abs(Math.sin(theta)));
          } else {
            d.y = topY - d.h;
          }
          if (d.x < -d.w || d.x > W + d.w) {
            d.el.remove();
            d.dead = true;
            continue;
          }
          place(d);
          continue;
        }

        // free fall toward terminal velocity
        d.vy = Math.min(TERMINAL, d.vy + GRAVITY * dt);
        d.y += d.vy * dt;
        d.x += d.vx * dt;
        if (!d.hasGlided) d.rot += (d.settleRot - d.rot) * 0.08;

        // contact with the umbrella outline -> start gliding on top of it
        const cx = d.x + d.w / 2;
        const topY = umbTopY(cx);
        if (topY !== Infinity && d.y + d.h >= topY) {
          d.gliding = true;
          d.hasGlided = true;
          d.dir = cx < umbCx() ? -1 : 1;
          d.s = Math.max(50, d.vy * 0.4);
          d.y = topY - d.h;
          place(d);
          continue;
        }

        // land on the pile
        const c0 = Math.max(0, Math.floor(d.x / COL_W));
        const c1 = Math.min(ncols - 1, Math.floor((d.x + d.w) / COL_W));
        let rest = Infinity;
        for (let i = c0; i <= c1; i++) {
          if (sheltered[i]) continue;
          if (surface[i] < rest) rest = surface[i];
        }
        if (d.y + d.h >= rest) {
          settle(d);
          continue;
        }
        if (d.y > H + 80) {
          d.el.remove();
          d.dead = true;
          continue;
        }
        place(d);
      }

      if (drops.length > 500) {
        for (let i = drops.length - 1; i >= 0; i--) {
          if (drops[i].dead || drops[i].settled) drops.splice(i, 1);
        }
      }
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      for (const d of drops) d.el.remove();
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: "#ffffff" }}>
      <div ref={stageRef} style={{ position: "absolute", inset: 0, background: "#ffffff" }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={umbRef}
        src="/rain-umbrella/umbrella.png"
        alt="Umbrella"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: UMBRELLA_W,
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          filter: "drop-shadow(0 14px 26px rgba(40,60,80,0.16))",
          zIndex: 5,
        }}
      />
    </div>
  );
}
