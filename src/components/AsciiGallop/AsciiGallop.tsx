"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import styles from "./AsciiGallop.module.css";
import { MODEL_H, MODEL_W, buildGallop, distGroups } from "./horse";
import { EDGE_GLYPHS, LENS_WORDS, RISO, SOLID_GLYPHS, type Palette } from "./palettes";
import {
  createShaderLayer,
  type ShaderFrame,
  type ShaderLayer,
  type ShaderRipple,
} from "./shader";

type Variant = "full" | "embed";

type AsciiGallopProps = {
  variant?: Variant;
  /** caption shown under the plate, on the left */
  title?: string;
  /** caption shown under the plate, on the right */
  date?: string;
  className?: string;
  style?: CSSProperties;
};

/** poses in one stride, the flipbook steps through these */
const CYCLE_FRAMES = 16;
/** printed rings around the silhouette */
const HALO = 2;
/** band values: the three ink separations, then the halo rings outward */
const BAND_HORSE = 1;
const BAND_RIDER = 2;
const BAND_FAR = 3;
const BAND_RING = 4;
/** a click ripple is gone after this many seconds */
const RIPPLE_LIFE = 1.6;
/** ripple speed in fractions of the canvas width per second */
const RIPPLE_SPEED = 0.55;

const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

const codesOf = (s: string) => Uint16Array.from(s, (ch) => ch.charCodeAt(0));
const SOLID_CODES = codesOf(SOLID_GLYPHS);
const EDGE_CODES = codesOf(EDGE_GLYPHS);

/**
 * Every colour a palette can print, flattened into one list so a cell can pick
 * an ink by index instead of by string.
 */
type Inks = {
  colors: string[];
  bg: number;
  edge: number;
  accent: number;
  solid: number[];
  far: number[];
  rider: number[];
  confetti: number[];
};

function buildInks(pal: Palette): Inks {
  // fixed layout, never deduped: the indices must stay put while the colours
  // underneath them rotate every frame
  const colors = [
    pal.bg,
    pal.edge,
    pal.accent,
    ...pal.solid,
    ...pal.far,
    ...pal.rider,
    ...pal.confetti,
  ];
  let i = 3;
  const run = (n: number) => Array.from({ length: n }, () => i++);
  return {
    colors,
    bg: 0,
    edge: 1,
    accent: 2,
    solid: run(pal.solid.length),
    far: run(pal.far.length),
    rider: run(pal.rider.length),
    confetti: run(pal.confetti.length),
  };
}

/** turns a slice of char codes into a string without building it per character */
function decode(buf: Uint16Array, from: number, to: number): string {
  let out = "";
  const CHUNK = 4096;
  for (let i = from; i < to; i += CHUNK) {
    out += String.fromCharCode(...buf.subarray(i, Math.min(to, i + CHUNK)));
  }
  return out;
}

/** cheap integer hash, stable per cell per pose so the noise does not crawl */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

type Engine = {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  font: string;
  /** device pixels per css pixel, cached so hot paths never re-measure */
  dpr: number;
  scale: number;
  offX: number;
  offY: number;
  bands: Uint8Array;
  heat: Float32Array;
  /** false once the trail has fully cooled, so the decay sweep can be skipped */
  heatLive: boolean;
  /** 0 none, 1 ripple crest, 2 lens word, 3 lens hole */
  overlay: Uint8Array;
  overlayCh: Uint16Array;
  inks: Inks;
  inkKey: string;
  /** one lane of char codes per ink, laid out as ink * cols + col */
  inkBuf: Uint16Array;
  inkMin: Int32Array;
  inkMax: Int32Array;
  colorStep: number;
  builtFrame: number;
  builtKey: string;
  phase: number;
  pointerX: number;
  pointerY: number;
  inside: boolean;
  dragging: boolean;
  dragStartX: number;
  dragStartPhase: number;
  dragMoved: boolean;
  lastX: number;
  lastY: number;
  ripples: { x: number; y: number; born: number }[];
};

export default function AsciiGallop({
  variant = "full",
  title = "giddy-up, horsey",
  date = "Aug 13, 2026",
  className = "",
  style,
}: AsciiGallopProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const asciiRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const relayout = useRef<(() => void) | null>(null);
  const scrub = useRef<((frames: number) => void) | null>(null);
  const burst = useRef<(() => void) | null>(null);

  const [ui, setUi] = useState({
    density: variant === "embed" ? 11 : 8,
    fps: 12,
    paused: false,
    lens: false,
  });
  const [shaderReady, setShaderReady] = useState(false);
  const [reduced, setReduced] = useState(false);

  // the render loop reads options through a ref so changing one never tears
  // down the WebGL context or restarts the animation
  const opts = useRef(ui);
  useEffect(() => {
    opts.current = ui;
  }, [ui]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = asciiRef.current;
    const gl = glRef.current;
    if (!stage || !canvas || !gl) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const eng: Engine = {
      cols: 0,
      rows: 0,
      cellW: 8,
      cellH: 14,
      font: `14px ${MONO_FALLBACK}`,
      dpr: 1,
      scale: 1,
      offX: 0,
      offY: 0,
      bands: new Uint8Array(0),
      heat: new Float32Array(0),
      heatLive: false,
      overlay: new Uint8Array(0),
      overlayCh: new Uint16Array(0),
      inks: buildInks(RISO),
      inkKey: "",
      inkBuf: new Uint16Array(0),
      inkMin: new Int32Array(0),
      inkMax: new Int32Array(0),
      colorStep: -1,
      builtFrame: -1,
      builtKey: "",
      phase: 0,
      pointerX: -1,
      pointerY: -1,
      inside: false,
      dragging: false,
      dragStartX: 0,
      dragStartPhase: 0,
      dragMoved: false,
      lastX: -1,
      lastY: -1,
      ripples: [],
    };

    let shader: ShaderLayer | null = null;
    let raf = 0;
    let disposed = false;
    let probed = false;
    let wheelAcc = 0;
    const start = performance.now();
    let prev = start;

    /** true when the WebGL layer drew nothing at all, so we can fall back */
    const isBlank = () => {
      const glCtx = gl.getContext("webgl") as WebGLRenderingContext | null;
      if (!glCtx) return true;
      const px = new Uint8Array(4);
      glCtx.readPixels(
        Math.floor(gl.width / 2),
        Math.floor(gl.height / 2),
        1,
        1,
        glCtx.RGBA,
        glCtx.UNSIGNED_BYTE,
        px,
      );
      return px[0] === 0 && px[1] === 0 && px[2] === 0 && px[3] === 0;
    };

    // ---- layout -----------------------------------------------------------
    const layout = () => {
      const rect = stage.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, variant === "embed" ? 1.5 : 2);
      eng.dpr = dpr;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      canvas.width = w;
      canvas.height = h;

      const fontPx = Math.max(6, opts.current.density) * dpr;
      // next/font hands us a hashed family name, so read whatever actually applied
      const family = getComputedStyle(canvas).fontFamily.trim() || MONO_FALLBACK;
      eng.font = `${fontPx}px ${family}`;
      ctx.font = eng.font;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      // Runs are padded with spaces where other inks sit, so a space has to
      // advance exactly as far as a digit. If the applied font turns out to be
      // proportional the whole grid shears, so check and fall back rather than
      // draw a smeared plate.
      let advance = ctx.measureText("0").width;
      if (Math.abs(ctx.measureText(" ").width - advance) > 0.01) {
        eng.font = `${fontPx}px ${MONO_FALLBACK}`;
        ctx.font = eng.font;
        advance = ctx.measureText("0").width;
      }
      eng.cellW = advance || fontPx * 0.6;
      eng.cellH = fontPx * 1.02;
      eng.cols = Math.max(8, Math.ceil(w / eng.cellW));
      eng.rows = Math.max(8, Math.ceil(h / eng.cellH));

      const count = eng.cols * eng.rows;
      eng.bands = new Uint8Array(count);
      eng.heat = new Float32Array(count);
      eng.overlay = new Uint8Array(count);
      eng.overlayCh = new Uint16Array(count);

      // fit the horse model into the stage without distorting it
      const pad = variant === "embed" ? 0.92 : 0.82;
      eng.scale = Math.min(w / MODEL_W, h / MODEL_H) * pad;
      eng.offX = (w - MODEL_W * eng.scale) / 2;
      eng.offY = (h - MODEL_H * eng.scale) / 2;

      eng.builtKey = "";
      shader?.resize(w, h);
    };

    // ---- silhouette -------------------------------------------------------
    const buildBands = (poseFrame: number) => {
      const frame = buildGallop(poseFrame / CYCLE_FRAMES);
      const { cols, rows, cellW, cellH, scale, offX, offY, bands } = eng;
      // one ring is exactly one character wide, measured in model units
      const ring = cellW / scale;
      const reach = ring * HALO;
      bands.fill(0);

      // the animal covers a small part of a full bleed grid, so clip to its
      // bounding box first and skip the distance field everywhere else
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const all = [...frame.horse, ...frame.rider, ...frame.far];
      for (const g of all) {
        if (g.x0 < minX) minX = g.x0;
        if (g.y0 < minY) minY = g.y0;
        if (g.x1 > maxX) maxX = g.x1;
        if (g.y1 > maxY) maxY = g.y1;
      }

      const c0 = Math.max(0, Math.floor(((minX - reach) * scale + offX) / cellW));
      const c1 = Math.min(cols - 1, Math.ceil(((maxX + reach) * scale + offX) / cellW));
      const r0 = Math.max(0, Math.floor(((minY - reach) * scale + offY) / cellH));
      const r1 = Math.min(rows - 1, Math.ceil(((maxY + reach) * scale + offY) / cellH));

      for (let r = r0; r <= r1; r++) {
        const my = ((r + 0.5) * cellH - offY) / scale;
        const base = r * cols;
        for (let c = c0; c <= c1; c++) {
          const mx = ((c + 0.5) * cellW - offX) / scale;
          // the rider is nearest the camera, then the horse, then its off side
          const dr = distGroups(frame.rider, mx, my);
          if (dr <= 0) {
            bands[base + c] = BAND_RIDER;
            continue;
          }
          const dh = distGroups(frame.horse, mx, my);
          if (dh <= 0) {
            bands[base + c] = BAND_HORSE;
            continue;
          }
          const df = distGroups(frame.far, mx, my);
          if (df <= 0) {
            bands[base + c] = BAND_FAR;
            continue;
          }
          const d = Math.min(dr, dh, df);
          if (d < reach) bands[base + c] = BAND_RING + Math.floor(d / ring);
        }
      }
    };

    // ---- pointer heat -----------------------------------------------------
    const stampHeat = (px: number, py: number) => {
      const { cols, rows, cellW, cellH, heat } = eng;
      const radius = 68 * eng.dpr;
      const cc = px / cellW;
      const cr = py / cellH;
      const spanC = Math.ceil(radius / cellW);
      const spanR = Math.ceil(radius / cellH);
      const c0 = Math.max(0, Math.floor(cc) - spanC);
      const c1 = Math.min(cols - 1, Math.floor(cc) + spanC);
      const r0 = Math.max(0, Math.floor(cr) - spanR);
      const r1 = Math.min(rows - 1, Math.floor(cr) + spanR);
      for (let r = r0; r <= r1; r++) {
        const dy = ((r + 0.5) * cellH - py) / radius;
        for (let c = c0; c <= c1; c++) {
          const dx = ((c + 0.5) * cellW - px) / radius;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1) continue;
          const v = (1 - d2) * (1 - d2);
          const i = r * cols + c;
          if (v > heat[i]) heat[i] = v;
        }
      }
      eng.heatLive = true;
    };

    // ---- overlays: click rings and the cursor word lens --------------------
    const stampOverlays = (now: number) => {
      const { cols, rows, cellW, cellH, overlay, overlayCh } = eng;
      overlay.fill(0);

      for (const rip of eng.ripples) {
        const age = (now - rip.born) / 1000;
        // width normalised to match the ring the shader draws
        const radius = age * RIPPLE_SPEED * canvas.width;
        const band = eng.cellW * 1.6;
        const outer = radius + band;
        const inner = Math.max(0, radius - band);
        const spanR = Math.ceil(outer / cellH);
        const cr = Math.floor(rip.y / cellH);
        for (let r = Math.max(0, cr - spanR); r <= Math.min(rows - 1, cr + spanR); r++) {
          const dy = (r + 0.5) * cellH - rip.y;
          const oSpan = outer * outer - dy * dy;
          if (oSpan <= 0) continue;
          // walk only the two arcs this row actually crosses, never the disc
          const ox = Math.sqrt(oSpan);
          const iSpan = inner * inner - dy * dy;
          const ix = iSpan > 0 ? Math.sqrt(iSpan) : 0;
          const arcs: [number, number][] =
            ix > 0
              ? [
                  [rip.x - ox, rip.x - ix],
                  [rip.x + ix, rip.x + ox],
                ]
              : [[rip.x - ox, rip.x + ox]];
          for (const [a, b] of arcs) {
            const from = Math.max(0, Math.floor(a / cellW));
            const to = Math.min(cols - 1, Math.ceil(b / cellW));
            for (let c = from; c <= to; c++) {
              const i = r * cols + c;
              overlay[i] = 1;
              overlayCh[i] = 48 + (hash(c, r, 7) % 10);
            }
          }
        }
      }

      if (!opts.current.lens || !eng.inside || variant === "embed") return;

      const radius = 96 * eng.dpr;
      const cc = eng.pointerX / cellW;
      const cr = eng.pointerY / cellH;
      const spanC = Math.ceil(radius / cellW);
      const spanR = Math.ceil(radius / cellH);
      // punch a clean hole so the stamped words read against the flat field
      for (let r = Math.max(0, Math.floor(cr) - spanR); r <= Math.min(rows - 1, Math.floor(cr) + spanR); r++) {
        const dy = ((r + 0.5) * cellH - eng.pointerY) / radius;
        for (let c = Math.max(0, Math.floor(cc) - spanC); c <= Math.min(cols - 1, Math.floor(cc) + spanC); c++) {
          const dx = ((c + 0.5) * cellW - eng.pointerX) / radius;
          if (dx * dx + dy * dy > 1) continue;
          const i = r * cols + c;
          if (overlay[i] === 0) overlay[i] = 3;
        }
      }
      // then stamp a different word on every row of the lens
      const rowCenter = Math.round(cr);
      const colCenter = Math.round(cc);
      const drift = Math.floor(now / 900);
      for (let dr = -spanR; dr <= spanR; dr++) {
        const r = rowCenter + dr;
        if (r < 0 || r >= rows) continue;
        const half = Math.sqrt(Math.max(0, 1 - (dr / spanR) * (dr / spanR)));
        const word = LENS_WORDS[Math.abs(r + drift) % LENS_WORDS.length];
        const room = Math.floor((half * radius) / cellW) * 2;
        if (word.length > room) continue;
        const startC = colCenter - Math.floor(word.length / 2);
        for (let k = 0; k < word.length; k++) {
          const c = startC + k;
          if (c < 0 || c >= cols) continue;
          const i = r * cols + c;
          if (overlay[i] === 1) continue;
          overlay[i] = 2;
          overlayCh[i] = word.charCodeAt(k);
        }
      }
    };

    // ---- draw -------------------------------------------------------------
    const draw = (now: number) => {
      const o = opts.current;
      const t = (now - start) / 1000;
      // the colour clock steps at the frame rate, so paper and ink both jump
      // to a new hue on every pose rather than sliding between them
      const colorStep = reducedRef.current ? 0 : Math.floor(t * o.fps);
      // one plate, one set of inks, always
      const pal = RISO;
      const { cols, rows, cellW, cellH, bands, heat, overlay, overlayCh } = eng;
      const poseFrame = Math.floor(eng.phase * CYCLE_FRAMES);
      const key = `${cols}x${rows}`;

      if (poseFrame !== eng.builtFrame || key !== eng.builtKey) {
        buildBands(((poseFrame % CYCLE_FRAMES) + CYCLE_FRAMES) % CYCLE_FRAMES);
        eng.builtFrame = poseFrame;
        eng.builtKey = key;
      }

      const inkKey = `${pal.id}:${cols}`;
      if (eng.inkKey !== inkKey) {
        eng.inks = buildInks(pal);
        eng.inkBuf = new Uint16Array(eng.inks.colors.length * cols);
        eng.inkMin = new Int32Array(eng.inks.colors.length);
        eng.inkMax = new Int32Array(eng.inks.colors.length);
        eng.inkKey = inkKey;
        eng.colorStep = -1;
      }
      // re-ink in place when the hue moves, the layout is unchanged
      if (eng.colorStep !== colorStep) {
        eng.inks.colors = buildInks(pal).colors;
        eng.colorStep = colorStep;
      }

      stampOverlays(now);

      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = eng.font;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const colorFrame = colorStep;

      const inks = eng.inks;
      const inkCount = inks.colors.length;
      const { inkBuf, inkMin, inkMax } = eng;

      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * cellH;
        const base = r * cols;
        // one lane per ink, padded with spaces. Neighbouring cells almost never
        // share a colour, so drawing runs would mean one fillText per character.
        // Spaces advance exactly one cell in a monospace face, so a whole row
        // collapses into one fillText per ink instead.
        inkBuf.fill(32);
        inkMin.fill(cols);
        inkMax.fill(-1);

        for (let c = 0; c < cols; c++) {
          const i = base + c;
          const h = hash(c, r, poseFrame);
          const hc = hash(c, r, colorFrame + 977);
          const hot = heat[i];
          const band = bands[i];
          let code: number;
          let ink: number;

          if (overlay[i] === 1) {
            code = overlayCh[i];
            ink = hc % 3 === 0 ? inks.edge : inks.accent;
          } else if (overlay[i] === 2) {
            code = overlayCh[i];
            ink = band && band < BAND_RING ? inks.bg : inks.accent;
          } else if (overlay[i] === 3) {
            continue;
          } else if (band === BAND_HORSE) {
            code = SOLID_CODES[h % SOLID_CODES.length];
            ink =
              hot > 0.55
                ? inks.confetti[(hc >>> 5) % inks.confetti.length]
                : inks.solid[(hc >>> 3) % inks.solid.length];
          } else if (band === BAND_RIDER) {
            code = SOLID_CODES[h % SOLID_CODES.length];
            ink = inks.rider[(hc >>> 3) % inks.rider.length];
          } else if (band === BAND_FAR) {
            code = SOLID_CODES[h % SOLID_CODES.length];
            ink = inks.far[(hc >>> 3) % inks.far.length];
          } else if (band >= BAND_RING) {
            code = EDGE_CODES[h % EDGE_CODES.length];
            // the first ring is the hard outline, everything past it is confetti
            ink =
              band === BAND_RING && hot < 0.4
                ? inks.edge
                : inks.confetti[(hc >>> (band & 7)) % inks.confetti.length];
          } else if (hot > 0.3) {
            // the cursor prints confetti onto the flat field it passes over
            code = EDGE_CODES[h % EDGE_CODES.length];
            ink = hot > 0.62 ? inks.edge : inks.confetti[(hc >>> 4) % inks.confetti.length];
          } else {
            // bare paper, nothing printed on it
            continue;
          }

          inkBuf[ink * cols + c] = code;
          if (c < inkMin[ink]) inkMin[ink] = c;
          if (c > inkMax[ink]) inkMax[ink] = c;
        }

        for (let k = 0; k < inkCount; k++) {
          const hi = inkMax[k];
          if (hi < 0) continue;
          const lo = inkMin[k];
          ctx.fillStyle = inks.colors[k];
          ctx.fillText(decode(inkBuf, k * cols + lo, k * cols + hi + 1), lo * cellW, y);
        }
      }
    };

    // ---- loop -------------------------------------------------------------
    // one frame object, mutated in place, so a 60fps loop allocates nothing
    const frame: ShaderFrame = {
      time: 0,
      cursor: [0, 0],
      cursorActive: 0,
      ripples: [] as ShaderRipple[],
      grain: 1,
    };

    const tick = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const o = opts.current;

      if (!o.paused && !eng.dragging && !reducedRef.current) {
        eng.phase += (dt * o.fps) / CYCLE_FRAMES;
      }
      if (eng.phase < 0) eng.phase += Math.ceil(-eng.phase);

      // skip the decay sweep entirely once the trail has cooled to nothing
      if (eng.heatLive) {
        const decay = Math.pow(0.94, dt * 60);
        let peak = 0;
        for (let i = 0; i < eng.heat.length; i++) {
          const v = eng.heat[i] * decay;
          eng.heat[i] = v;
          if (v > peak) peak = v;
        }
        if (peak < 0.004) {
          eng.heat.fill(0);
          eng.heatLive = false;
        }
      }
      if (eng.inside) stampHeat(eng.pointerX, eng.pointerY);

      while (eng.ripples.length && now - eng.ripples[0].born >= RIPPLE_LIFE * 1000) {
        eng.ripples.shift();
      }

      draw(now);

      if (shader) {
        frame.ripples.length = 0;
        for (const rip of eng.ripples) {
          frame.ripples.push({
            x: rip.x / canvas.width,
            y: rip.y / canvas.height,
            age: (now - rip.born) / 1000,
          });
        }
        // a frozen clock stops the grain, the wobble and the aberration pulse
        // outright, rather than just turning them down
        frame.time = reducedRef.current ? 0 : (now - start) / 1000;
        frame.cursor[0] = eng.pointerX / canvas.width;
        frame.cursor[1] = eng.pointerY / canvas.height;
        frame.cursorActive = eng.inside ? 1 : 0;
        frame.grain = reducedRef.current ? 0.5 : 1;
        shader.render(frame);
        // the 2d plate is hidden while the shader is on, so make sure the
        // shader is really drawing something before we trust it
        if (!probed) {
          probed = true;
          if (isBlank()) {
            shader.dispose();
            shader = null;
            setShaderReady(false);
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };

    // ---- input ------------------------------------------------------------
    const toCanvas = (e: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      const sx = canvas.width / Math.max(1, rect.width);
      const sy = canvas.height / Math.max(1, rect.height);
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    };

    const onMove = (e: PointerEvent) => {
      const p = toCanvas(e);
      eng.inside = true;
      // fill in the gaps between pointer events so fast moves still leave a trail
      if (eng.lastX >= 0) {
        const steps = Math.min(6, Math.ceil(Math.hypot(p.x - eng.lastX, p.y - eng.lastY) / eng.cellW));
        for (let s = 1; s < steps; s++) {
          const k = s / steps;
          stampHeat(eng.lastX + (p.x - eng.lastX) * k, eng.lastY + (p.y - eng.lastY) * k);
        }
      }
      eng.pointerX = p.x;
      eng.pointerY = p.y;
      eng.lastX = p.x;
      eng.lastY = p.y;

      if (eng.dragging) {
        const dx = p.x - eng.dragStartX;
        if (Math.abs(dx) > eng.cellW) eng.dragMoved = true;
        // drag the stride like a strip of film
        eng.phase = eng.dragStartPhase + dx / (canvas.width * 0.45);
      }
    };

    const onEnter = () => {
      eng.inside = true;
    };
    const onLeave = () => {
      eng.inside = false;
      eng.lastX = -1;
      eng.lastY = -1;
      eng.dragging = false;
    };
    const onDown = (e: PointerEvent) => {
      const p = toCanvas(e);
      eng.dragging = true;
      eng.dragMoved = false;
      eng.dragStartX = p.x;
      eng.dragStartPhase = eng.phase;
      stage.setPointerCapture?.(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      if (eng.dragging && !eng.dragMoved) {
        const p = toCanvas(e);
        eng.ripples.push({ x: p.x, y: p.y, born: performance.now() });
        if (eng.ripples.length > 6) eng.ripples.shift();
      }
      eng.dragging = false;
      if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    };
    // without this a gesture the OS takes over leaves dragging stuck true,
    // which freezes the stride until the next full press and release
    const onCancel = (e: PointerEvent) => {
      eng.dragging = false;
      eng.inside = false;
      eng.lastX = -1;
      eng.lastY = -1;
      if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      if (variant === "embed") return;
      // never swallow the page scroll on a casual hover, only once the plate
      // has been focused on purpose
      if (document.activeElement !== stage) return;
      e.preventDefault();
      // a trackpad flick fires dozens of events, so move a step per notch of
      // travel rather than per event
      wheelAcc += e.deltaY;
      const step = Math.trunc(wheelAcc / 60);
      if (!step) return;
      wheelAcc -= step * 60;
      setUi((u) => ({ ...u, density: Math.min(24, Math.max(6, u.density + step)) }));
    };

    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerenter", onEnter);
    stage.addEventListener("pointerleave", onLeave);
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onCancel);
    stage.addEventListener("wheel", onWheel, { passive: false });

    // ---- start ------------------------------------------------------------
    layout();
    shader = createShaderLayer(gl, canvas);
    if (shader) {
      shader.resize(canvas.width, canvas.height);
      setShaderReady(true);
    }

    const ro = new ResizeObserver(() => layout());
    ro.observe(stage);
    // the webfont can land after first paint and changes the advance width,
    // but the promise outlives the effect, so re-check before touching anything
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!disposed) layout();
      });
    }

    raf = requestAnimationFrame(tick);

    relayout.current = layout;
    // the keyboard path needs to reach the engine, which lives only in here
    scrub.current = (frames: number) => {
      eng.phase += frames / CYCLE_FRAMES;
    };
    burst.current = () => {
      eng.ripples.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        born: performance.now(),
      });
      if (eng.ripples.length > 6) eng.ripples.shift();
    };

    return () => {
      disposed = true;
      relayout.current = null;
      scrub.current = null;
      burst.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerenter", onEnter);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onCancel);
      stage.removeEventListener("wheel", onWheel);
      shader?.dispose();
      setShaderReady(false);
    };
  }, [variant]);

  // density changes only need a fresh grid, never a fresh WebGL context
  useEffect(() => {
    relayout.current?.();
  }, [ui.density]);

  const printOn = shaderReady;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (variant === "embed") return;
    if (e.key === " ") {
      e.preventDefault();
      setUi((u) => ({ ...u, paused: !u.paused }));
    } else if (e.key === "w" || e.key === "W") {
      setUi((u) => ({ ...u, lens: !u.lens }));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = e.key === "ArrowUp" ? 1 : -1;
      setUi((u) => ({ ...u, fps: Math.min(30, Math.max(2, u.fps + step)) }));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // the keyboard equivalent of dragging the stride like film
      e.preventDefault();
      scrub.current?.(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      burst.current?.();
    } else if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      const step = e.key === "-" ? 1 : -1;
      setUi((u) => ({ ...u, density: Math.min(24, Math.max(6, u.density + step)) }));
    }
  };

  return (
    <div
      className={`${styles.root} ${className}`}
      data-variant={variant}
      style={{ ...style, ["--plate" as string]: RISO.bg }}
    >
      <div
        ref={stageRef}
        className={styles.stage}
        tabIndex={0}
        role="img"
        aria-label="Animated ASCII artwork of a rider on a galloping horse, drawn entirely from numbers and words"
        aria-keyshortcuts={
          variant === "full"
            ? "ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space W"
            : undefined
        }
        onKeyDown={onKeyDown}
      >
        <canvas ref={asciiRef} className={styles.ascii} data-under={printOn} />
        <canvas ref={glRef} className={styles.gl} data-on={printOn} />
      </div>

      <div className={styles.caption}>
        <span className={styles.title}>{title}</span>
        <span className={styles.date}>{date}</span>
      </div>

    </div>
  );
}
