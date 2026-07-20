"use client";

import { AnimatePresence, motion, useMotionValue, useSpring, type MotionValue } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * BagelBuilder - a "build your bagel" cycler. Each layer (bagel top, filling,
 * cream cheese, bagel bottom) is independently hover-responsive and carries its
 * own left/right arrows - no labels, just arrows. Layers are centre-aligned and
 * spaced so nothing overlaps, and every layer is run through an ordered (Bayer)
 * dither for a cohesive retro riso texture. Bagels are photographic (dithered);
 * cream cheese and fillings are drawn procedurally then dithered to match.
 */

// ----- catalogue -----
type Bread = { id: string; label: string; src: string; whiteKey: boolean };
const BREADS: Bread[] = [
  { id: "sesame", label: "Sesame", src: "/bagel/sesame.png", whiteKey: false },
  { id: "everything", label: "Everything", src: "/bagel/everything.jpg", whiteKey: true },
  { id: "plain", label: "Plain", src: "/bagel/plain.jpg", whiteKey: true },
];
const CHEESES = ["plain", "chive", "strawberry", "honeynut", "veggie"] as const;
const FILLINGS = ["lox", "tomato", "cucumber", "egg", "avocado", "onion"] as const;

// spoken descriptions surfaced by the cursor pill on hover
const CHEESE_LABEL: Record<string, string> = {
  plain: "Plain Schmear",
  chive: "Scallion Schmear",
  strawberry: "Strawberry Schmear",
  honeynut: "Honey-Nut Schmear",
  veggie: "Garden Veggie Schmear",
};
const FILLING_LABEL: Record<string, string> = {
  lox: "Smoked Lox",
  tomato: "Vine Tomato",
  cucumber: "Fresh Cucumber",
  egg: "Boiled Egg",
  avocado: "Sliced Avocado",
  onion: "Red Onion",
};

// ----- dither -----
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const PIXEL = 2; // on-screen size of one dithered block (smaller = finer)
const LEVELS = 7; // quantisation steps per channel (more = smoother, less banding)
const clampi = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function mkCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

type DitherOpts = { whiteKey?: boolean; flipV?: boolean; darken?: number };

/** Downsample a source image/canvas, ordered-dither it, return a data URL. */
function dither(
  source: HTMLImageElement | HTMLCanvasElement,
  displayW: number,
  opts: DitherOpts = {}
): string {
  const sw = (source as HTMLImageElement).naturalWidth || source.width;
  const sh = (source as HTMLImageElement).naturalHeight || source.height;
  const lowW = Math.max(1, Math.round(displayW / PIXEL));
  const lowH = Math.max(1, Math.round((lowW * sh) / sw));
  const tmp = mkCanvas(lowW, lowH);
  const ctx = tmp.getContext("2d")!;
  if (opts.flipV) {
    ctx.translate(0, lowH);
    ctx.scale(1, -1);
  }
  ctx.drawImage(source, 0, 0, lowW, lowH);
  const img = ctx.getImageData(0, 0, lowW, lowH);
  const d = img.data;
  const dk = opts.darken ? 1 - opts.darken : 1;
  for (let y = 0; y < lowH; y++) {
    for (let x = 0; x < lowW; x++) {
      const i = (y * lowW + x) * 4;
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const a = d[i + 3];
      if (opts.whiteKey) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (a < 8 || (lum > 0.85 && mx - mn < 26)) {
          d[i + 3] = 0;
          continue;
        }
      }
      if (a < 8) continue;
      r *= dk; g *= dk; b *= dk;
      const t = (BAYER[y & 3][x & 3] / 16 - 0.5) / LEVELS;
      d[i] = clampi(Math.round((r / 255 + t) * (LEVELS - 1)) * (255 / (LEVELS - 1)));
      d[i + 1] = clampi(Math.round((g / 255 + t) * (LEVELS - 1)) * (255 / (LEVELS - 1)));
      d[i + 2] = clampi(Math.round((b / 255 + t) * (LEVELS - 1)) * (255 / (LEVELS - 1)));
    }
  }
  ctx.putImageData(img, 0, 0);
  return tmp.toDataURL();
}

// ----- procedural cream cheese + fillings (drawn top-down, wide canvas) -----
const SW = 480;
const SH = 320;

function speckle(ctx: CanvasRenderingContext2D, n: number, R: number, colors: string[]) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * R * 0.92;
    const x = SW / 2 + Math.cos(a) * rr;
    const y = SH / 2 + Math.sin(a) * rr * 0.62;
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + Math.random() * 4, 2 + Math.random() * 3, Math.random() * 3, 0, 7);
    ctx.fill();
  }
}

function blob(ctx: CanvasRenderingContext2D, R: number, wob: number) {
  ctx.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.18) {
    const r = R * (1 + wob * (Math.sin(a * 5) * 0.5 + Math.cos(a * 3 + 1) * 0.5));
    const x = SW / 2 + Math.cos(a) * r;
    const y = SH / 2 + Math.sin(a) * r * 0.6; // squashed for top-down perspective
    if (a === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawCheese(id: string): HTMLCanvasElement {
  const c = mkCanvas(SW, SH);
  const ctx = c.getContext("2d")!;
  const palette: Record<string, { base: string; hi: string; specks?: string[]; n?: number }> = {
    plain: { base: "#f1e6c9", hi: "#fbf4e2" },
    chive: { base: "#ede4c6", hi: "#f8f1dd", specks: ["#6f8f3f", "#587433"], n: 90 },
    strawberry: { base: "#f0cbd5", hi: "#f8e2e8", specks: ["#d46a86", "#c65274"], n: 40 },
    honeynut: { base: "#efd69c", hi: "#f8ecbf", specks: ["#a9772f", "#8a5f24"], n: 55 },
    veggie: { base: "#eee3c6", hi: "#f7efd8", specks: ["#c1503f", "#6f8f3f", "#d98a34", "#4f7d8a"], n: 100 },
  };
  const p = palette[id] ?? palette.plain;
  const R = SW * 0.41;
  // soft cast shadow
  ctx.fillStyle = "rgba(120,90,50,0.18)";
  blob(ctx, R * 1.02, 0.06);
  ctx.filter = "blur(6px)";
  ctx.fill();
  ctx.filter = "none";
  // body
  ctx.fillStyle = p.base;
  blob(ctx, R, 0.07);
  ctx.fill();
  // highlight sweep
  ctx.save();
  ctx.clip();
  const g = ctx.createLinearGradient(0, SH * 0.15, 0, SH * 0.85);
  g.addColorStop(0, p.hi);
  g.addColorStop(0.6, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SW, SH);
  // little knife swirls
  ctx.strokeStyle = "rgba(180,150,90,0.25)";
  ctx.lineWidth = 4;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.ellipse(SW / 2, SH / 2, R * (0.4 + k * 0.15), R * (0.24 + k * 0.08), 0.3, 0.5, 4.5);
    ctx.stroke();
  }
  if (p.specks) speckle(ctx, p.n ?? 60, R, p.specks);
  ctx.restore();
  return c;
}

function drawFilling(id: string): HTMLCanvasElement {
  const c = mkCanvas(SW, SH);
  const ctx = c.getContext("2d")!;
  const cx = SW / 2, cy = SH / 2;
  const slice = (x: number, y: number, r: number, rim: string, inner: string, seeds?: string) => {
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.82, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.82, r * 0.66, 0, 0, 7);
    ctx.fill();
    if (seeds) {
      ctx.fillStyle = seeds;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.32, 4, 8, a, 0, 7);
        ctx.fill();
      }
    }
  };
  switch (id) {
    case "lox": {
      for (let k = 0; k < 5; k++) {
        const off = (k - 2) * 30;
        const grd = ctx.createLinearGradient(cx - 150, cy + off, cx + 150, cy + off);
        grd.addColorStop(0, "#e0764f");
        grd.addColorStop(0.5, "#f0a07c");
        grd.addColorStop(1, "#dd6b46");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(cx - 170, cy + off);
        for (let x = -170; x <= 170; x += 20) {
          ctx.lineTo(cx + x, cy + off + Math.sin(x * 0.03 + k) * 14);
        }
        for (let x = 170; x >= -170; x -= 20) {
          ctx.lineTo(cx + x, cy + off + 24 + Math.sin(x * 0.03 + k) * 14);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,240,230,0.7)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = -170; x <= 170; x += 20)
          ctx.lineTo(cx + x, cy + off + 7 + Math.sin(x * 0.03 + k) * 14);
        ctx.stroke();
      }
      break;
    }
    case "tomato":
      slice(cx - 90, cy - 22, 108, "#c8483b", "#e0685a", "#f4cfa0");
      slice(cx + 95, cy + 30, 100, "#c8483b", "#e0685a", "#f4cfa0");
      break;
    case "cucumber":
      slice(cx - 110, cy - 20, 70, "#6f9a45", "#dff0c4", "#c7e29a");
      slice(cx - 5, cy + 25, 70, "#6f9a45", "#dff0c4", "#c7e29a");
      slice(cx + 105, cy - 10, 70, "#6f9a45", "#dff0c4", "#c7e29a");
      break;
    case "egg":
      for (let k = 0; k < 3; k++) {
        const x = cx + (k - 1) * 120;
        ctx.fillStyle = "#f6f1e4";
        ctx.beginPath();
        ctx.ellipse(x, cy, 82, 66, 0, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#f2c53f";
        ctx.beginPath();
        ctx.ellipse(x, cy, 36, 30, 0, 0, 7);
        ctx.fill();
      }
      break;
    case "avocado":
      for (let k = 0; k < 6; k++) {
        const a = -0.6 + k * 0.22;
        const g = ctx.createLinearGradient(cx, cy - 110, cx, cy + 110);
        g.addColorStop(0, "#cfe19a");
        g.addColorStop(1, "#7fa24e");
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, -10, 26, 110, 0, 0, Math.PI);
        ctx.fill();
        ctx.restore();
      }
      break;
    case "onion":
      for (let k = 0; k < 4; k++) {
        const x = cx + (k - 1.5) * 90;
        ctx.strokeStyle = "#9a5a8f";
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.ellipse(x, cy + (k % 2 ? 16 : -16), 56, 44, 0, 0, 7);
        ctx.stroke();
        ctx.strokeStyle = "#e6d2e8";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.ellipse(x, cy + (k % 2 ? 16 : -16), 56, 44, 0, 0, 7);
        ctx.stroke();
      }
      break;
    default:
      break; // none
  }
  return c;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// ----- display widths per layer -----
const W_CROWN = 230;
const W_FILL = 256; // match the bagel diameter
const W_CHEESE = 256;
const W_HEEL = 246;
const SLOT = 300; // fixed centre column so arrows line up and never touch the art
const ROWW = 392; // arrow + slot + arrow (keeps art centred whether arrows show or not)
const STAGE_H = 560;
// vertical position of each layer: clustered (assembled) vs branched apart
const Y_ASSEMBLED = [150, 195, 230, 256];
const Y_BRANCHED = [0, 148, 268, 388];

type Assets = {
  crowns: Record<string, string>;
  heels: Record<string, string>;
  cheeses: Record<string, string>;
  fillings: Record<string, string>;
};

export default function BagelBuilder() {
  const [assets, setAssets] = useState<Assets | null>(null);
  const [bread, setBread] = useState(0);
  const [cheese, setCheese] = useState(0);
  const [filling, setFilling] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false); // assembled -> branched on hover
  const [inside, setInside] = useState(false);
  const [pillLabel, setPillLabel] = useState("");
  const titleColor = "#1e38be";
  const cursorColor = "#1f8c18";
  const mx = useMotionValue(-200);
  const my = useMotionValue(-200);
  const sx = useSpring(mx, { stiffness: 600, damping: 34, mass: 0.4 });
  const sy = useSpring(my, { stiffness: 600, damping: 34, mass: 0.4 });

  useEffect(() => {
    let alive = true;
    (async () => {
      const [imgs, loxImg] = await Promise.all([
        Promise.all(BREADS.map((b) => loadImage(b.src))),
        loadImage("/bagel/lox.png"),
      ]);
      if (!alive) return;
      const crowns: Record<string, string> = {};
      const heels: Record<string, string> = {};
      BREADS.forEach((b, i) => {
        crowns[b.id] = dither(imgs[i], W_CROWN, { whiteKey: b.whiteKey });
        heels[b.id] = dither(imgs[i], W_HEEL, { whiteKey: b.whiteKey, flipV: true, darken: 0.14 });
      });
      const cheeses: Record<string, string> = {};
      CHEESES.forEach((id) => (cheeses[id] = dither(drawCheese(id), W_CHEESE)));
      const fillings: Record<string, string> = {};
      FILLINGS.forEach(
        (id) =>
          (fillings[id] =
            id === "lox"
              ? dither(loxImg, W_FILL, { whiteKey: true })
              : dither(drawFilling(id), W_FILL))
      );
      setAssets({ crowns, heels, cheeses, fillings });
    })();
    return () => {
      alive = false;
    };
  }, []);

  // each layer index -> which catalogue it cycles (0 & 3 both drive the bread)
  const cycleIndex = useCallback((index: number, dir: number) => {
    if (index === 0 || index === 3) setBread((v) => (v + dir + BREADS.length) % BREADS.length);
    else if (index === 1) setFilling((v) => (v + dir + FILLINGS.length) % FILLINGS.length);
    else if (index === 2) setCheese((v) => (v + dir + CHEESES.length) % CHEESES.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hovered == null) return;
      if (e.key === "ArrowLeft") cycleIndex(hovered, -1);
      else if (e.key === "ArrowRight") cycleIndex(hovered, 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hovered, cycleIndex]);

  const breadId = BREADS[bread].id;
  const cheeseId = CHEESES[cheese];
  const fillingId = FILLINGS[filling];

  const labelFor = (i: number | null) =>
    i == null
      ? ""
      : i === 1
      ? FILLING_LABEL[fillingId]
      : i === 2
      ? CHEESE_LABEL[cheeseId]
      : `${BREADS[bread].label} Bagel`;

  // keep the pill's text while it retracts, so it doesn't blank mid-animation
  useEffect(() => {
    if (hovered != null) setPillLabel(labelFor(hovered));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, bread, cheese, filling]);

  return (
    <div
      onMouseMove={(e) => {
        mx.set(e.clientX);
        my.set(e.clientY);
      }}
      onMouseEnter={() => setInside(true)}
      onMouseLeave={() => {
        setInside(false);
        setHovered(null);
      }}
      style={{
        minHeight: "100dvh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: "36px 16px",
        background: "#ffffff",
        fontFamily: "var(--font-ibm-mono), 'IBM Plex Mono', ui-monospace, monospace",
        color: "#5a2f10",
        cursor: "none",
      }}
    >
      <style jsx global>{`
        @font-face {
          font-family: "ABC Arizona Serif Condensed";
          src: url("/bagel/fonts/ABCArizonaSerifCondensedTrial-Medium.otf") format("opentype");
          font-weight: 500;
          font-display: swap;
        }
        @font-face {
          font-family: "ABC Arizona Serif Condensed";
          src: url("/bagel/fonts/ABCArizonaSerifCondensedTrial-Bold.otf") format("opentype");
          font-weight: 700;
          font-display: swap;
        }
      `}</style>
      <CursorPill x={sx} y={sy} label={pillLabel} expanded={hovered != null} visible={inside} color={cursorColor} />
      <header style={{ textAlign: "center" }}>
        <h1
          style={{
            fontSize: 56,
            lineHeight: 1,
            margin: 0,
            fontFamily: "'ABC Arizona Serif Condensed', Georgia, serif",
            fontWeight: 500,
            color: titleColor,
            letterSpacing: "0.01em",
          }}
        >
          Build Your Bagel
        </h1>
      </header>

      <div
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => {
          setExpanded(false);
          setHovered(null);
        }}
        style={{ position: "relative", width: ROWW, maxWidth: "96vw", height: STAGE_H }}
      >
        {assets ? (
          [
            { src: assets.crowns[breadId], w: W_CROWN, bob: 0 },
            { src: assets.fillings[fillingId], w: W_FILL, bob: 0.4 },
            { src: assets.cheeses[cheeseId], w: W_CHEESE, bob: 0.8 },
            { src: assets.heels[breadId], w: W_HEEL, bob: 1.2 },
          ].map((L, i) => (
            <motion.div
              key={i}
              style={{ position: "absolute", top: 0, left: "50%", marginLeft: -ROWW / 2, width: ROWW, zIndex: 4 - i }}
              animate={{ y: (expanded ? Y_BRANCHED : Y_ASSEMBLED)[i] }}
              transition={{ type: "spring", stiffness: 180, damping: 22, delay: expanded ? i * 0.04 : 0 }}
            >
              <LayerRow
                index={i}
                src={L.src}
                w={L.w}
                bob={L.bob}
                hovered={hovered}
                setHovered={setHovered}
                cycle={cycleIndex}
              />
            </motion.div>
          ))
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: 0.6, fontSize: 13 }}>
            toasting&hellip;
          </div>
        )}
      </div>

    </div>
  );
}

function CursorPill({
  x,
  y,
  label,
  expanded,
  visible,
  color,
}: {
  x: MotionValue<number>;
  y: MotionValue<number>;
  label: string;
  expanded: boolean;
  visible: boolean;
  color: string;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [textW, setTextW] = useState(0);
  useEffect(() => {
    if (spanRef.current) setTextW(spanRef.current.offsetWidth);
  }, [label]);

  // hug the text exactly when open; a clean 30px circle when closed
  const width = expanded && textW ? textW : 30;
  return (
    <motion.div
      style={{ position: "fixed", left: 0, top: 0, x, y, zIndex: 60, pointerEvents: "none" }}
    >
      <div
        style={{
          transform: "translate(-15px, -50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 30,
          borderRadius: 15,
          background: color,
          color: "#ffffff",
          overflow: "hidden",
          width,
          opacity: visible ? 1 : 0,
          boxShadow: "0 6px 16px -6px rgba(90,50,20,0.55)",
          transition: "width 0.42s cubic-bezier(.68,-0.6,.27,1.6), opacity 0.25s ease",
        }}
      >
        <span
          ref={spanRef}
          style={{
            padding: "0 16px",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif',
            fontWeight: 700,
            fontSize: 12.5,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            opacity: expanded ? 1 : 0,
            transition: `opacity 0.18s ease ${expanded ? "0.14s" : "0s"}`,
          }}
        >
          {label}
        </span>
      </div>
    </motion.div>
  );
}

function LayerRow({
  index,
  src,
  w,
  bob,
  hovered,
  setHovered,
  cycle,
}: {
  index: number;
  src: string;
  w: number;
  bob: number;
  hovered: number | null;
  setHovered: (v: number | null) => void;
  cycle: (index: number, dir: number) => void;
}) {
  const active = hovered === index;
  return (
    <div
      onMouseEnter={() => setHovered(index)}
      onMouseLeave={() => setHovered(null)}
      style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ width: SLOT, display: "grid", placeItems: "center", minHeight: w * 0.5 }}>
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut", delay: bob }}
        >
          <motion.div
            animate={{ scale: active ? 1.1 : 1, y: active ? -4 : 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 20 }}
          >
            <AnimatePresence mode="popLayout">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <motion.img
                key={src}
                src={src}
                alt=""
                onClick={() => cycle(index, 1)}
                initial={{ opacity: 0, y: -18, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 18, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
                style={{
                  width: w,
                  display: "block",
                  cursor: "none",
                  imageRendering: "pixelated",
                  filter: `drop-shadow(0 ${active ? 14 : 8}px ${active ? 14 : 10}px rgba(90,50,20,0.28))`,
                }}
              />
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
