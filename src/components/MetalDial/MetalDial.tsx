"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS, startDial, type DialParams, type DialHandle } from "./engine";
import styles from "./MetalDial.module.css";

type MetalDialProps = {
  variant?: "full" | "embed";
};

type Control = {
  key: keyof DialParams;
  label: string;
  min: number;
  max: number;
  step: number;
};

const CONTROLS: Control[] = [
  { key: "acrossRough", label: "brush depth", min: 0.05, max: 0.7, step: 0.01 },
  { key: "alongRough", label: "polish", min: 0.004, max: 0.2, step: 0.002 },
  { key: "grain", label: "grain", min: 0, max: 0.25, step: 0.005 },
  { key: "dish", label: "dish", min: -0.3, max: 0.4, step: 0.01 },
  { key: "tilt", label: "tilt", min: 0, max: 1.1, step: 0.02 },
  { key: "anodise", label: "anodise", min: 0, max: 1, step: 0.02 },
  { key: "exposure", label: "exposure", min: 0.4, max: 2, step: 0.02 },
  { key: "drift", label: "room drift", min: 0, max: 0.4, step: 0.01 },
];

export default function MetalDial({ variant = "full" }: MetalDialProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<DialHandle | null>(null);
  const liveRef = useRef<DialParams>({ ...DEFAULT_PARAMS });
  const [params, setParams] = useState<DialParams>({ ...DEFAULT_PARAMS });
  const [hintGone, setHintGone] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: DialHandle | null = null;
    try {
      handle = startDial(canvas, {
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

  const setParam = useCallback((key: keyof DialParams, value: number) => {
    liveRef.current[key] = value;
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <figure className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""}`}>
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div className={`${styles.hint} ${hintGone ? styles.hintGone : ""}`}>
          drag to turn it
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
