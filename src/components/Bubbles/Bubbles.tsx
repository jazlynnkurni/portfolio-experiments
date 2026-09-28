"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS, startBubbles, type BubbleParams, type BubblesHandle } from "./engine";
import styles from "./Bubbles.module.css";

type BubblesProps = {
  variant?: "full" | "embed";
};

type Control = {
  key: keyof BubbleParams;
  label: string;
  min: number;
  max: number;
  step: number;
};

// Only the dials worth turning. The rest of the optics stays where the physics
// put it.
const CONTROLS: Control[] = [
  { key: "density", label: "how many", min: 0.2, max: 3, step: 0.05 },
  { key: "film", label: "wall thickness", min: 120, max: 900, step: 5 },
  { key: "gain", label: "iridescence", min: 0.4, max: 5, step: 0.05 },
  { key: "refract", label: "refraction", min: 0, max: 2, step: 0.02 },
  { key: "bloom", label: "bloom", min: 0, max: 1.2, step: 0.02 },
  { key: "dof", label: "depth of field", min: 0, max: 4, step: 0.05 },
  { key: "focus", label: "focus depth", min: 0, max: 1, step: 0.02 },
  { key: "gravity", label: "gravity", min: 0, max: 2200, step: 20 },
];

export default function Bubbles({ variant = "full" }: BubblesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<BubblesHandle | null>(null);
  // The engine reads this object every frame, so a slider can retune the optics
  // without restarting anything. React keeps its own copy to render from.
  const liveRef = useRef<BubbleParams>({ ...DEFAULT_PARAMS });
  const [params, setParams] = useState<BubbleParams>({ ...DEFAULT_PARAMS });
  const [hintGone, setHintGone] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let handle: BubblesHandle | null = null;
    try {
      handle = startBubbles(canvas, {
        params: liveRef.current,
        onError: (message) => setError(message),
        onFirstTouch: () => setHintGone(true),
      });
      handleRef.current = handle;
    } catch (e) {
      // Reported after the effect settles, so the first paint is not blocked
      // by a state update from inside it.
      const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
      queueMicrotask(() => setError(message));
    }

    const timer = window.setTimeout(() => setHintGone(true), 4200);
    return () => {
      window.clearTimeout(timer);
      handle?.dispose();
      handleRef.current = null;
    };
  }, []);

  const setParam = useCallback((key: keyof BubbleParams, value: number) => {
    liveRef.current[key] = value;
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <figure className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""}`}>
      <div className={styles.well}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div className={`${styles.hint} ${hintGone ? styles.hintGone : ""}`}>
          tap a bubble to burst it
        </div>
        {error ? <pre className={styles.error}>{error}</pre> : null}
      </div>

      {variant === "full" ? (
        <figcaption className={styles.bar}>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.gear}
            aria-label="settings"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            &#9881;
          </button>

          {panelOpen ? (
            <div className={styles.panel}>
              {CONTROLS.map((c) => (
                <label key={c.key} className={styles.row}>
                  <span>{c.label}</span>
                  <b>{Math.round(params[c.key] * 100) / 100}</b>
                  <input
                    type="range"
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={params[c.key]}
                    onChange={(e) => setParam(c.key, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
