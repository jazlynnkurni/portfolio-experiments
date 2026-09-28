"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS, startTin, type TinParams, type TinHandle } from "./engine";
import styles from "./PressedTin.module.css";

type PressedTinProps = {
  variant?: "full" | "embed";
};

type Control = {
  key: keyof TinParams;
  label: string;
  min: number;
  max: number;
  step: number;
};

const CONTROLS: Control[] = [
  { key: "relief", label: "press depth", min: 0.004, max: 0.12, step: 0.002 },
  { key: "hammer", label: "planishing", min: 0, max: 1.4, step: 0.02 },
  { key: "rough", label: "finish", min: 0.05, max: 0.6, step: 0.01 },
  { key: "tarnish", label: "tarnish", min: 0, max: 0.8, step: 0.02 },
  { key: "tilt", label: "tilt", min: 0, max: 1, step: 0.02 },
  { key: "swing", label: "idle sway", min: 0, max: 0.8, step: 0.02 },
  { key: "exposure", label: "exposure", min: 0.3, max: 2, step: 0.02 },
  { key: "drift", label: "room drift", min: 0, max: 0.4, step: 0.01 },
];

export default function PressedTin({ variant = "full" }: PressedTinProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<TinHandle | null>(null);
  const liveRef = useRef<TinParams>({ ...DEFAULT_PARAMS });
  const [params, setParams] = useState<TinParams>({ ...DEFAULT_PARAMS });
  const [hintGone, setHintGone] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: TinHandle | null = null;
    try {
      handle = startTin(canvas, {
        params: liveRef.current,
        onError: (message) => setError(message),
        onFirstTouch: () => setHintGone(true),
      });
      handleRef.current = handle;
    } catch (e) {
      const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
      queueMicrotask(() => setError(message));
    }
    const timer = window.setTimeout(() => setHintGone(true), 5200);
    return () => {
      window.clearTimeout(timer);
      handle?.dispose();
      handleRef.current = null;
    };
  }, []);

  const setParam = useCallback((key: keyof TinParams, value: number) => {
    liveRef.current[key] = value;
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <figure className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""}`}>
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div className={`${styles.hint} ${hintGone ? styles.hintGone : ""}`}>
          drag to tilt it
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
                  <b>{Math.round(params[c.key] * 1000) / 1000}</b>
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
