"use client";

import { useEffect, useRef, useState } from "react";
import Matter from "matter-js";

/**
 * Interactive mahjong-tile footer.
 *
 * A row of upright mahjong tiles stand on the ground. Click any tile and the
 * whole line collapses like real dominoes — each tile tips forward and is
 * caught by the next, so the row settles into a leaning diagonal "fan" (not a
 * flat pile), one tile at a time, left → right. Physics via matter.js drives
 * the DOM directly (no canvas), matching the snooker scene.
 *
 * Why it's tipped tile-by-tile rather than a single push: real dominoes rely on
 * being much taller than they are thick, so a falling one strikes the *top* of
 * its neighbour and topples it. Mahjong art is nearly square — when it tips,
 * only its low bottom corner reaches the next tile, which can't propagate a
 * chain (verified in simulation). So each tile gets an identical gentle nudge,
 * staggered left → right; because the collision bodies are close, each tipping
 * tile is caught mid-fall by the next and comes to rest leaning against it —
 * the same fanned-stack look a real domino run leaves behind.
 *
 * The collision body is slimmer than the artwork so the tiles tip gently
 * without flinging; the full-width face renders on top and the wide faces
 * overlap into the fan as they lean.
 */

// Default tile art (PNG files live in /public/mahjong).
const DEFAULT_TILES = [
  "/mahjong/Tile1.png",
  "/mahjong/Tile2.png",
  "/mahjong/Tile3.png",
  "/mahjong/Tile4.png",
  "/mahjong/Tile5.png",
  "/mahjong/Tile6.png",
  "/mahjong/Tile7.png",
  "/mahjong/Tile8.png",
  "/mahjong/Tile9.png",
];

// Tile art aspect ratio (from the source art 1608 × 1876 ≈ 402 × 469).
const TILE_ASPECT = 402 / 469;

// --- Tunable feel -----------------------------------------------------------
const TILE_H = 165; // upright tile height in px (before responsive scaling)
const GAP = 18; // px gap between standing tiles (close enough to catch & lean)
const SIDE_PAD = 40; // px padding on the left before the first tile
const GROUND_INSET = 48; // px of floor below the tiles (room for the shadow)
const GRAVITY = 0.85; // world gravity — lower = slower, more satisfying fall
const BODY_W_FRAC = 0.55; // collision-body width as a fraction of the artwork
const TIP_SPIN = 0.05; // gentle rotational nudge per tile (tips, never launches)
const DOMINO_STEP_MS = 240; // delay between each tile tipping (left → right)
const RESTITUTION = 0.22; // impact bounce (coefficient of restitution) — subtle recoil

// --- Auto stand-up ----------------------------------------------------------
// After a run falls and settles, the tiles wait, then rewind upright on their
// own as a timed reverse domino — right → left, edge-first (the last tile that
// fell rises first). No scrolling needed.
const STANDUP_TILE_MS = 480; // time for a single tile to rise
const STANDUP_STAGGER_MS = 95; // delay between consecutive tiles (right → left)
const FALL_SETTLE_MS = 1300; // ~time for the last tile to finish falling
const AUTO_RESET_HOLD_MS = 500; // how long the fallen tiles rest before rising

// --- Dithered floor shadow (WebGL2 shader) ---------------------------------
// Each tile casts a shadow whose footprint is its horizontal projection —
// ½·W·|cosθ| + ½·H·|sinθ| — so it widens and slides as the tile tips, driven
// straight from the physics angle. Rendered as an ordered (Bayer) dither, not
// a soft blur, to match the tiles' own dithered pixel art.
const SHADOW_MAX_DARK = 0.85; // peak shadow density (0..1) before dithering
const SHADOW_DITHER_PX = 2; // Bayer dither cell size in CSS px
const SHADOW_COLOR: [number, number, number] = [0.17, 0.14, 0.1]; // warm dark (in-palette)
// ---------------------------------------------------------------------------

// --- Hover breathing --------------------------------------------------------
// A hovered, still-standing tile floats up and gently bobs (breathing). The
// lift is fed to the shadow shader so the shadow shrinks/fades in step.
const HOVER_LIFT = 6; // base float height in px (before scaling)
const HOVER_BOB = 7; // extra bob amplitude in px (the breathing)
const HOVER_PERIOD_MS = 1900; // one breath in/out
const HOVER_EASE = 0.14; // per-frame ease toward hovered/un-hovered
// ---------------------------------------------------------------------------

interface MahjongTilesProps {
  tiles?: string[];
  /** Container height in px. */
  height?: number;
  className?: string;
}

interface ShadowConfig {
  width: number;
  height: number;
  scale: number;
  tileW: number;
  tileH: number;
  groundY: number;
  count: number;
  liftMax: number;
}

/**
 * Builds a WebGL2 renderer that draws one dithered floor shadow per tile.
 *
 * The fragment shader takes each tile's centre-x and angle and computes the
 * tile's horizontal footprint on the floor (½W·|cosθ| + ½H·|sinθ|), places a
 * flat elliptical shadow there, biases it toward the leaning/contact side, and
 * quantises the result through a 4×4 Bayer matrix so the shadow reads as a
 * halftone dither rather than a soft blur. Returns null (no shadow) if WebGL2
 * is unavailable.
 */
function createShadowRenderer(
  canvas: HTMLCanvasElement | null,
  cfg: ShadowConfig
): {
  render: (bodies: Matter.Body[], lifts: number[]) => void;
  dispose: () => void;
} | null {
  if (!canvas) return null;
  const { width, height, scale, tileW, tileH, groundY, count } = cfg;
  const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
  });
  if (!gl) return null;

  const vsrc = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const fsrc = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform float uDpr, uGroundY, uTileW, uTileH, uScale, uDither, uMaxDark, uLiftMax;
uniform vec3 uColor;
uniform vec4 uTiles[${count}];   // x = centre-x, y = centre-y, z = angle, w = hover lift px
out vec4 o;

float bayer(ivec2 p){
  const float m[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0);
  int i = (p.x & 3) + (p.y & 3) * 4;
  return (m[i] + 0.5) / 16.0;
}

void main(){
  // CSS-pixel coords, y-down, matching the matter.js world.
  float px = gl_FragCoord.x / uDpr;
  float py = uRes.y - gl_FragCoord.y / uDpr;

  float acc = 0.0;
  for (int i = 0; i < ${count}; i++){
    float cx = uTiles[i].x;
    float a  = uTiles[i].z;
    float sa = abs(sin(a));
    float ca = abs(cos(a));
    // How high the tile is floating (hover breathing), 0..1.
    float ln = clamp(uTiles[i].w / max(uLiftMax, 1.0), 0.0, 1.0);
    // Horizontal footprint of the tile on the floor — grows as it tips,
    // shrinks a little as it lifts off the ground.
    float E = (0.5 * uTileW * ca + 0.5 * uTileH * sa) * (1.0 - 0.16 * ln);
    float drop = 4.0 * uScale;                        // sits just in front of base
    float eh   = (9.0 * uScale + 0.10 * E) * (1.0 + 0.35 * ln); // softer when lifted
    float sx   = cx + 0.18 * uTileH * sin(a);         // slide toward the leaning side
    float dx = (px - sx) / max(E, 1.0);
    float dy = (py - (uGroundY + drop)) / max(eh, 1.0);
    float r  = sqrt(dx * dx + dy * dy);
    float shape = 1.0 - smoothstep(0.55, 1.0, r);
    // Darker/tighter contact when upright & grounded; fainter as it lifts.
    float dark  = uMaxDark * mix(0.8, 1.0, ca) * (1.0 - 0.5 * ln);
    acc = max(acc, dark * shape);
  }
  acc = clamp(acc, 0.0, 1.0);

  float th = bayer(ivec2(gl_FragCoord.xy / uDither));
  if (acc <= th) discard;
  o = vec4(uColor, 1.0);
}`;

  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("[MahjongTiles] shadow shader failed:", gl.getShaderInfoLog(s));
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vsrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsrc);
  const prog = gl.createProgram() as WebGLProgram;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[MahjongTiles] shadow program link failed:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  gl.useProgram(prog);
  const uTiles = gl.getUniformLocation(prog, "uTiles");
  gl.uniform2f(gl.getUniformLocation(prog, "uRes"), width, height);
  gl.uniform1f(gl.getUniformLocation(prog, "uDpr"), dpr);
  gl.uniform1f(gl.getUniformLocation(prog, "uGroundY"), groundY);
  gl.uniform1f(gl.getUniformLocation(prog, "uTileW"), tileW);
  gl.uniform1f(gl.getUniformLocation(prog, "uTileH"), tileH);
  gl.uniform1f(gl.getUniformLocation(prog, "uScale"), scale);
  gl.uniform1f(gl.getUniformLocation(prog, "uDither"), SHADOW_DITHER_PX * dpr);
  gl.uniform1f(gl.getUniformLocation(prog, "uMaxDark"), SHADOW_MAX_DARK);
  gl.uniform1f(gl.getUniformLocation(prog, "uLiftMax"), Math.max(1, cfg.liftMax));
  gl.uniform3f(
    gl.getUniformLocation(prog, "uColor"),
    SHADOW_COLOR[0],
    SHADOW_COLOR[1],
    SHADOW_COLOR[2]
  );
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const buf = new Float32Array(count * 4);
  return {
    render(bodies: Matter.Body[], lifts: number[] = []) {
      for (let i = 0; i < count; i++) {
        const b = bodies[i];
        if (!b) continue;
        buf[i * 4] = b.position.x;
        buf[i * 4 + 1] = b.position.y;
        buf[i * 4 + 2] = b.angle;
        buf[i * 4 + 3] = lifts[i] || 0;
      }
      gl.uniform4fv(uTiles, buf);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

export default function MahjongTiles({
  tiles = DEFAULT_TILES,
  height = 300,
  className = "",
}: MahjongTilesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tileElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const bodiesRef = useRef<Matter.Body[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const kickedRef = useRef<boolean[]>([]);
  const hoverRef = useRef(-1); // index of the tile under the cursor (-1 none)
  const hoverAmtRef = useRef<number[]>([]); // eased 0..1 hover weight per tile
  const homeRef = useRef<{ x: number; y: number }[]>([]); // upright rest poses
  const playedRef = useRef(false); // a run has toppled → needs standing back up
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const standupRef = useRef<{
    start: number;
    poses: { x: number; y: number; angle: number }[];
  } | null>(null); // active stand-up animation
  const visibleRef = useRef(true); // footer intersects the viewport
  const [width, setWidth] = useState(0);

  // Measure container width (responsive rebuild).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      setWidth((prev) => (Math.abs(prev - w) > 2 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the world whenever the measured width changes.
  useEffect(() => {
    if (!width) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const n = tiles.length;

    // Responsive scale so all tiles fit the measured width.
    const baseW = TILE_H * TILE_ASPECT;
    const baseSpan = SIDE_PAD * 2 + n * baseW + (n - 1) * GAP;
    const scale = Math.min(1, width / baseSpan);

    const tileH = TILE_H * scale;
    const tileW = baseW * scale;
    const gap = GAP * scale;
    const pad = SIDE_PAD * scale;
    const step = tileW + gap;

    // Centre the row so it stays balanced (full-bleed rug, not left-anchored).
    // When the row fills the width (scale < 1) this collapses back to `pad`.
    const rowW = n * tileW + (n - 1) * gap;
    const originX = Math.max(pad, (width - rowW) / 2);

    const groundY = height - GROUND_INSET;
    const centerY = groundY - tileH / 2;

    const engine = Matter.Engine.create();
    engine.gravity.y = GRAVITY;
    // Stiffer solver so the leaning tiles rest cleanly against each other.
    engine.positionIterations = 10;
    engine.velocityIterations = 8;
    const world = engine.world;

    // Static boundaries: floor + side walls to keep tiles on screen.
    const wallT = 200;
    const floor = Matter.Bodies.rectangle(
      width / 2,
      groundY + wallT / 2,
      width * 2,
      wallT,
      { isStatic: true, friction: 0.9 }
    );
    const leftWall = Matter.Bodies.rectangle(
      -wallT / 2,
      height / 2,
      wallT,
      height * 4,
      { isStatic: true }
    );
    const rightWall = Matter.Bodies.rectangle(
      width + wallT / 2,
      height / 2,
      wallT,
      height * 4,
      { isStatic: true }
    );
    Matter.World.add(world, [floor, leftWall, rightWall]);

    // Tile bodies, standing upright left → right. The collision box is slimmer
    // than the artwork (see file header) so tiles topple like real dominoes.
    const bodyW = tileW * BODY_W_FRAC;
    const bodies: Matter.Body[] = [];
    const home: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const cx = originX + tileW / 2 + i * step;
      home.push({ x: cx, y: centerY });
      const body = Matter.Bodies.rectangle(cx, centerY, bodyW, tileH, {
        friction: 0.55, // grip the floor so tiles topple instead of sliding
        frictionStatic: 0.9,
        // Small coefficient of restitution: every impact — including the last
        // tile hitting the end of the run — rebounds a little and settles,
        // instead of stopping dead. Kept low so it reads as a subtle recoil.
        restitution: RESTITUTION,
        density: 0.004,
        chamfer: { radius: 3 * scale },
        label: `tile-${i}`,
      });
      bodies.push(body);
    }
    bodiesRef.current = bodies;
    kickedRef.current = bodies.map(() => false);
    hoverAmtRef.current = bodies.map(() => 0);
    homeRef.current = home;
    playedRef.current = false;
    standupRef.current = null;
    Matter.World.add(world, bodies);

    // Size AND position the DOM tiles up front so they never flash at the
    // image's intrinsic (huge) size or stacked at 0,0 before the first frame.
    tileElsRef.current.forEach((el, i) => {
      if (!el) return;
      el.style.width = `${tileW}px`;
      el.style.height = `${tileH}px`;
      const b = bodies[i];
      if (b) {
        el.style.transform = `translate(${b.position.x - tileW / 2}px, ${
          b.position.y - tileH / 2
        }px) rotate(0rad)`;
      }
    });
    // Now that tiles are correctly sized + placed, reveal (fade in).
    containerRef.current?.classList.add("is-ready");

    // Dithered floor-shadow renderer (WebGL2). Degrades gracefully to no
    // shadow if WebGL2 is unavailable.
    const liftMax = (HOVER_LIFT + HOVER_BOB) * scale;
    const shadow = createShadowRenderer(canvasRef.current, {
      width,
      height,
      scale,
      tileW,
      tileH,
      groundY,
      count: n,
      liftMax,
    });

    // Engine → DOM render loop.
    const lifts = new Array<number>(n).fill(0);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Skip all physics/DOM/WebGL work while the footer is offscreen — no
      // point stepping the sim or redrawing shadows the user can't see.
      if (!visibleRef.current) {
        last = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      try {
        frame(now);
      } catch {
        // Never let a stray frame error kill the loop (e.g. transient HMR).
      }
      raf = requestAnimationFrame(tick);
    };
    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const frame = (now: number) => {
      const dt = Math.min(1000 / 60, now - last);
      last = now;

      const su = standupRef.current;
      if (su) {
        // --- Timed reverse-domino stand-up (right → left, physics paused) ---
        if (su.start === 0) su.start = now; // stamp start on the first frame
        const elapsed = now - su.start;
        let allDone = true;
        for (let i = 0; i < bodies.length; i++) {
          const rank = bodies.length - 1 - i; // rightmost tile rises first
          const lt = clamp01(
            (elapsed - rank * STANDUP_STAGGER_MS) / STANDUP_TILE_MS
          );
          if (lt < 1) allDone = false;
          const e = lt * lt * (3 - 2 * lt); // smoothstep
          const b = bodies[i];
          const hp = homeRef.current[i];
          const fp = su.poses[i];
          Matter.Body.setPosition(b, {
            x: fp.x + (hp.x - fp.x) * e,
            y: fp.y + (hp.y - fp.y) * e,
          });
          Matter.Body.setAngle(b, fp.angle * (1 - e));
        }
        if (allDone) {
          for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            const hp = homeRef.current[i];
            Matter.Body.setStatic(b, false);
            Matter.Body.setPosition(b, { x: hp.x, y: hp.y });
            Matter.Body.setAngle(b, 0);
            Matter.Body.setVelocity(b, { x: 0, y: 0 });
            Matter.Body.setAngularVelocity(b, 0);
          }
          kickedRef.current = bodies.map(() => false);
          playedRef.current = false;
          standupRef.current = null;
        }
      } else {
        Matter.Engine.update(engine, dt);
      }

      // Breathing bob (shared phase → cohesive across tiles). Held flat for
      // visitors who prefer reduced motion — hovered tiles still lift, just
      // without the perpetual up/down breathing.
      const bob = reduceMotion
        ? 0
        : 0.5 + 0.5 * Math.sin((now * 2 * Math.PI) / HOVER_PERIOD_MS);
      const hoverAmt = hoverAmtRef.current;

      for (let i = 0; i < bodies.length; i++) {
        const el = tileElsRef.current[i];
        if (!el) continue;
        const b = bodies[i];

        // Only a hovered, still-standing tile floats.
        const target = hoverRef.current === i && !kickedRef.current[i] ? 1 : 0;
        hoverAmt[i] += (target - hoverAmt[i]) * HOVER_EASE;
        const lift = hoverAmt[i] * (HOVER_LIFT + HOVER_BOB * bob) * scale;
        lifts[i] = lift;

        el.style.transform = `translate(${b.position.x - tileW / 2}px, ${
          b.position.y - tileH / 2 - lift
        }px) rotate(${b.angle}rad)`;
      }
      shadow?.render(bodies, lifts);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
      kickedRef.current = [];
      standupRef.current = null;
      shadow?.dispose();
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
      bodiesRef.current = [];
    };
  }, [width, height, tiles]);

  // Pause the render loop while the footer is offscreen (battery/CPU/GPU).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Begin the reverse-domino stand-up (right → left). The frame loop animates
  // it out from the tiles' fallen poses.
  const triggerStandUp = () => {
    if (standupRef.current || !playedRef.current) return;
    const bodies = bodiesRef.current;
    if (!bodies.length) return;
    const poses = bodies.map((b) => ({
      x: b.position.x,
      y: b.position.y,
      angle: b.angle,
    }));
    bodies.forEach((b) => Matter.Body.setStatic(b, true));
    // start stamped from the rAF clock on the first frame (see frame loop).
    standupRef.current = { start: 0, poses };
  };

  // Start the domino run at the clicked tile: gently tip it, then each tile to
  // its right in turn (staggered by DOMINO_STEP_MS), so the line collapses one
  // tile at a time from the click rightward. Tiles to the left stay standing.
  // Per-tile tracking means a later click on an earlier tile topples the
  // still-standing ones without re-nudging those already down. Once the run
  // has fallen + rested, it stands itself back up automatically.
  const cascade = (start: number) => {
    // Ignore clicks while the tiles are standing back up.
    if (standupRef.current) return;
    const bodies = bodiesRef.current;
    const kicked = kickedRef.current;
    if (!bodies.length) return;
    let seq = 0;
    for (let j = start; j < bodies.length; j++) {
      if (kicked[j]) continue;
      kicked[j] = true;
      playedRef.current = true;
      const body = bodies[j];
      timersRef.current.push(
        setTimeout(
          () => Matter.Body.setAngularVelocity(body, TIP_SPIN),
          seq * DOMINO_STEP_MS
        )
      );
      seq++;
    }
    if (seq > 0) {
      // (Re)schedule the auto stand-up: last tile finishes falling, rests a
      // beat, then rewinds. Rescheduled from now so extra clicks extend the wait.
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      const lastKickDelay = (seq - 1) * DOMINO_STEP_MS;
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        triggerStandUp();
      }, lastKickDelay + FALL_SETTLE_MS + AUTO_RESET_HOLD_MS);
    }
  };

  return (
    <div className={`relative w-full ${className}`} style={{ height }}>
      {/* Decorative interactive flourish — hidden from the a11y tree. */}
      <div
        ref={containerRef}
        aria-hidden="true"
        className="mahjong-layer absolute inset-0"
      >
        {/* Dithered floor shadows render here, beneath the tiles. */}
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
        {tiles.map((src, i) => (
          <div
            key={src + i}
            ref={(el) => {
              tileElsRef.current[i] = el;
            }}
            onClick={() => cascade(i)}
            onMouseEnter={() => {
              hoverRef.current = i;
            }}
            onMouseLeave={() => {
              if (hoverRef.current === i) hoverRef.current = -1;
            }}
            className="absolute left-0 top-0 cursor-pointer select-none"
            style={{ transformOrigin: "center center", willChange: "transform" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              className="pointer-events-none h-full w-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
