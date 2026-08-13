"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./RigEditor.module.css";
import {
  DEFAULT_RIG,
  MODEL_H,
  MODEL_W,
  buildGallop,
  cloneRig,
  type Rig,
  type Shape,
} from "./horse";

/** how close the pointer has to get to grab a handle, in css pixels */
const GRAB = 13;

type View = { scale: number; offX: number; offY: number };

/**
 * Fills one tapered capsule: the two end discs plus the quad between their
 * outer tangents. Everything is drawn in the same ink and allowed to overlap,
 * so the union comes out right without any path arithmetic.
 */
function fillCone(ctx: CanvasRenderingContext2D, s: Shape, v: View) {
  const ax = s.ax * v.scale + v.offX;
  const ay = s.ay * v.scale + v.offY;
  const bx = s.bx * v.scale + v.offX;
  const by = s.by * v.scale + v.offY;
  const r1 = s.r1 * v.scale;
  const r2 = s.r2 * v.scale;

  ctx.beginPath();
  ctx.arc(ax, ay, Math.max(r1, 0.1), 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx, by, Math.max(r2, 0.1), 0, Math.PI * 2);
  ctx.fill();

  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  const dr = r1 - r2;
  if (d < 1e-6 || Math.abs(dr) >= d) return;

  const ux = dx / d;
  const uy = dy / d;
  const sn = dr / d;
  const cs = Math.sqrt(Math.max(0, 1 - sn * sn));
  const nx = -uy;
  const ny = ux;

  ctx.beginPath();
  ctx.moveTo(ax + r1 * (ux * sn + nx * cs), ay + r1 * (uy * sn + ny * cs));
  ctx.lineTo(bx + r2 * (ux * sn + nx * cs), by + r2 * (uy * sn + ny * cs));
  ctx.lineTo(bx + r2 * (ux * sn - nx * cs), by + r2 * (uy * sn - ny * cs));
  ctx.lineTo(ax + r1 * (ux * sn - nx * cs), ay + r1 * (uy * sn - ny * cs));
  ctx.closePath();
  ctx.fill();
}

const LEG_KEYS = [
  ["foreL1", "fore upper", 20, 50],
  ["foreL2", "fore lower", 12, 40],
  ["hindL1", "hind upper", 18, 46],
  ["hindL2", "hind lower", 14, 40],
  ["foreTop", "fore top r", 3, 14],
  ["foreKnee", "fore knee r", 1, 7],
  ["foreCannon", "fore cannon r", 0.8, 6],
  ["foreHoof", "fore hoof r", 1, 6],
  ["hindTop", "hind top r", 4, 18],
  ["hindStifle", "hind stifle r", 2, 12],
  ["hindHock", "hind hock r", 1, 7],
  ["hindCannon", "hind cannon r", 0.8, 6],
  ["hindHoof", "hind hoof r", 1, 6],
  ["farScale", "off side scale", 0.6, 1],
] as const;

export default function RigEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rig, setRig] = useState<Rig>(() => cloneRig(DEFAULT_RIG));
  const [pose, setPose] = useState(0.35);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [showHandles, setShowHandles] = useState(true);
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState("");

  const viewRef = useRef<View>({ scale: 1, offX: 0, offY: 0 });
  const dragRef = useRef<string | null>(null);

  // handles are only meaningful with the oscillations frozen, so editing is
  // always done on the neutral pose and playback is a preview
  const neutral = !playing;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const scale = Math.min(w / MODEL_W, h / MODEL_H) * 0.9;
    const v: View = {
      scale,
      offX: (w - MODEL_W * scale) / 2,
      offY: (h - MODEL_H * scale) / 2,
    };
    viewRef.current = v;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // the ground the hooves are solved against
    ctx.strokeStyle = "rgba(42,22,8,0.16)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, 120 * scale + v.offY);
    ctx.lineTo(w, 120 * scale + v.offY);
    ctx.stroke();

    const frame = buildGallop(pose, rig, neutral);
    const paint = (groups: { shapes: Shape[] }[], ink: string) => {
      ctx.fillStyle = ink;
      for (const g of groups) for (const s of g.shapes) fillCone(ctx, s, v);
    };
    paint(frame.far, "#F0466E");
    paint(frame.horse, "#C2123C");
    paint(frame.rider, "#FF8A00");

    if (!showHandles || playing) return;

    // handles, drawn in neutral model space so a drag maps one to one
    for (const key of Object.keys(rig.nodes)) {
      const nd = rig.nodes[key];
      const x = nd.x * scale + v.offX;
      const y = nd.y * scale + v.offY;
      const on = key === selected;
      const near = key === hover;

      if (nd.r > 0) {
        ctx.strokeStyle = on ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.42)";
        ctx.lineWidth = (on ? 2 : 1) * dpr;
        ctx.beginPath();
        ctx.arc(x, y, nd.r * scale, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, (on ? 6.5 : near ? 5.5 : 4) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = on ? "#0B7285" : near ? "#12A594" : "#0B1440";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      if (on || near) {
        ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = "#0B1440";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(key, x + 9 * dpr, y - 7 * dpr);
      }
    }
  }, [rig, pose, neutral, showHandles, playing, selected, hover]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setPose(((now - start) / 1400) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  /** nearest node to a css-pixel point, or null */
  const pick = useCallback((cssX: number, cssY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    const v = viewRef.current;
    let best: string | null = null;
    let bestD = GRAB;
    for (const key of Object.keys(rig.nodes)) {
      const nd = rig.nodes[key];
      const x = (nd.x * v.scale + v.offX) / dpr;
      const y = (nd.y * v.scale + v.offY) / dpr;
      const d = Math.hypot(cssX - x, cssY - y);
      if (d < bestD) {
        bestD = d;
        best = key;
      }
    }
    return best;
  }, [rig]);

  const toModel = (cssX: number, cssY: number): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    const v = viewRef.current;
    return [
      (cssX * dpr - v.offX) / v.scale,
      (cssY * dpr - v.offY) / v.scale,
    ];
  };

  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (playing) return;
    const [cx, cy] = local(e);
    const hit = pick(cx, cy);
    setSelected(hit);
    dragRef.current = hit;
    if (hit) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (playing) return;
    const [cx, cy] = local(e);
    const key = dragRef.current;
    if (!key) {
      setHover(pick(cx, cy));
      return;
    }
    const [mx, my] = toModel(cx, cy);
    setRig((prev) => {
      const next = cloneRig(prev);
      next.nodes[key] = {
        ...next.nodes[key],
        x: Math.round(mx * 10) / 10,
        y: Math.round(my * 10) / 10,
      };
      return next;
    });
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // scrolling over a handle fattens or thins that part
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (playing) return;
      const r = canvas.getBoundingClientRect();
      const key = pick(e.clientX - r.left, e.clientY - r.top) ?? selected;
      if (!key) return;
      e.preventDefault();
      setRig((prev) => {
        const next = cloneRig(prev);
        const step = e.deltaY > 0 ? -0.2 : 0.2;
        next.nodes[key] = {
          ...next.nodes[key],
          r: Math.max(0, Math.round((next.nodes[key].r + step) * 10) / 10),
        };
        return next;
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [pick, selected, playing]);

  const nudge = (dx: number, dy: number) => {
    if (!selected) return;
    setRig((prev) => {
      const next = cloneRig(prev);
      const nd = next.nodes[selected];
      next.nodes[selected] = { ...nd, x: nd.x + dx, y: nd.y + dy };
      return next;
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-step, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); nudge(step, 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); nudge(0, -step); }
    else if (e.key === "ArrowDown") { e.preventDefault(); nudge(0, step); }
  };

  const rigJson = JSON.stringify(rig, null, 2);

  const applyPaste = () => {
    try {
      const parsed = JSON.parse(paste) as Rig;
      if (!parsed?.nodes || !parsed?.legs || !parsed?.blend) {
        setNote("that json is missing nodes, legs or blend");
        return;
      }
      setRig(cloneRig(parsed));
      setNote("rig loaded");
    } catch {
      setNote("could not parse that json");
    }
  };

  const sel = selected ? rig.nodes[selected] : null;

  return (
    <div className={styles.root}>
      <div className={styles.stageWrap}>
        <canvas
          ref={canvasRef}
          className={styles.stage}
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
          aria-label="Horse rig editor. Drag the handles to reshape the animal."
        />
        <p className={styles.hint}>
          drag a handle to move it / scroll over one to fatten or thin it /
          arrows nudge, shift for bigger steps
        </p>
      </div>

      <div className={styles.panel}>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.chip}
            data-active={playing}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "playing" : "paused"}
          </button>
          <button
            type="button"
            className={styles.chip}
            data-active={showHandles}
            onClick={() => setShowHandles((h) => !h)}
          >
            handles
          </button>
          <button
            type="button"
            className={styles.chip}
            onClick={() => {
              setRig(cloneRig(DEFAULT_RIG));
              setNote("reset to default");
            }}
          >
            reset
          </button>
          <button
            type="button"
            className={styles.chip}
            onClick={() => {
              void navigator.clipboard?.writeText(rigJson);
              setNote("rig copied to clipboard");
            }}
          >
            copy rig
          </button>
        </div>

        <label className={styles.slider}>
          <span>pose {pose.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={0.999}
            step={0.001}
            value={pose}
            disabled={playing}
            onChange={(e) => setPose(Number(e.target.value))}
          />
        </label>

        {sel && selected && (
          <div className={styles.selected}>
            <strong>{selected}</strong>
            <label className={styles.slider}>
              <span>radius {sel.r.toFixed(1)}</span>
              <input
                type="range"
                min={0}
                max={20}
                step={0.1}
                value={sel.r}
                onChange={(e) =>
                  setRig((prev) => {
                    const next = cloneRig(prev);
                    next.nodes[selected] = {
                      ...next.nodes[selected],
                      r: Number(e.target.value),
                    };
                    return next;
                  })
                }
              />
            </label>
            <span className={styles.coords}>
              x {sel.x.toFixed(1)} / y {sel.y.toFixed(1)}
            </span>
          </div>
        )}

        <details className={styles.details}>
          <summary>limb proportions</summary>
          <div className={styles.legs}>
            {LEG_KEYS.map(([key, label, min, max]) => (
              <label key={key} className={styles.slider}>
                <span>
                  {label} {rig.legs[key].toFixed(2)}
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={0.01}
                  value={rig.legs[key]}
                  onChange={(e) =>
                    setRig((prev) => {
                      const next = cloneRig(prev);
                      next.legs[key] = Number(e.target.value);
                      return next;
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>

        <details className={styles.details}>
          <summary>rig json</summary>
          <textarea
            className={styles.json}
            readOnly
            value={rigJson}
            rows={10}
            aria-label="Current rig as JSON"
          />
          <textarea
            className={styles.json}
            placeholder="paste a rig json here to load it"
            value={paste}
            rows={4}
            onChange={(e) => setPaste(e.target.value)}
            aria-label="Paste a rig JSON to load"
          />
          <button type="button" className={styles.chip} onClick={applyPaste}>
            load pasted rig
          </button>
        </details>

        {note && <p className={styles.note}>{note}</p>}
      </div>
    </div>
  );
}
