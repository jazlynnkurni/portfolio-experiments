"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS, startBlobs, type BlobParams, type BlobsHandle } from "./engine";
import styles from "./Blobs.module.css";

type BlobsProps = { variant?: "full" | "embed" };
type Control = { key: keyof BlobParams; label: string; min: number; max: number; step: number };

const CONTROLS: Control[] = [
  // the shape
  { key: "radius", label: "disc size", min: 0.3, max: 1.6, step: 0.01 },
  { key: "reach", label: "reach", min: 1.2, max: 4, step: 0.05 },
  { key: "thresh", label: "threshold", min: 0.1, max: 1.5, step: 0.02 },
  // the light
  { key: "rim", label: "edge width", min: 0.004, max: 0.12, step: 0.002 },
  { key: "gain", label: "edge", min: 0, max: 1.2, step: 0.02 },
  { key: "fillIn", label: "body", min: 0, max: 1, step: 0.01 },
  // the print
  { key: "levels", label: "levels", min: 1, max: 24, step: 1 },
  { key: "pixel", label: "dot size", min: 0.5, max: 5, step: 0.25 },
  { key: "plate", label: "plate", min: 0, max: 0.5, step: 0.01 },
  { key: "grad", label: "falloff", min: 0, max: 1.2, step: 0.02 },
  // the timing
  { key: "knit", label: "knit", min: 0, max: 0.5, step: 0.01 },
  { key: "hold", label: "hold", min: 0, max: 0.6, step: 0.01 },
  { key: "speed", label: "speed", min: 0.2, max: 2.5, step: 0.05 },
];

export default function Blobs({ variant = "full" }: BlobsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<BlobsHandle | null>(null);
  const liveRef = useRef<BlobParams>({ ...DEFAULT_PARAMS });
  const [params, setParams] = useState<BlobParams>({ ...DEFAULT_PARAMS });
  const [hintGone, setHintGone] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: BlobsHandle | null = null;
    try {
      handle = startBlobs(canvas, {
        params: liveRef.current,
        onError: (m) => setError(m),
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

  const setParam = useCallback((key: keyof BlobParams, value: number) => {
    liveRef.current[key] = value;
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <figure className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""}`}>
      <div className={styles.well}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onPointerDown={() => setHintGone(true)}
        />
        <div className={`${styles.hint} ${hintGone ? styles.hintGone : ""}`}>
          drag to pull a bubble, tap one to pop it
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
                    min={c.min} max={c.max} step={c.step}
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
