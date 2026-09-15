"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS, startToggle, type ToggleParams, type ToggleHandle } from "./engine";
import styles from "./TinToggle.module.css";

type TinToggleProps = {
  variant?: "full" | "embed";
  onChange?: (on: boolean) => void;
};

type Control = { key: keyof ToggleParams; label: string; min: number; max: number; step: number };

const CONTROLS: Control[] = [
  { key: "press", label: "press depth", min: 0.05, max: 1.6, step: 0.01 },
  { key: "hammer", label: "planishing", min: 0, max: 1.4, step: 0.02 },
  { key: "rough", label: "finish", min: 0.05, max: 0.6, step: 0.01 },
  { key: "tarnish", label: "tarnish", min: 0, max: 0.8, step: 0.02 },
  { key: "sunHeight", label: "sun height", min: 0.15, max: 1.4, step: 0.02 },
  { key: "shadow", label: "shadow", min: 0, max: 1.4, step: 0.02 },
  { key: "glass", label: "glass", min: 0, max: 1.4, step: 0.02 },
  { key: "stiffness", label: "spring", min: 40, max: 400, step: 5 },
  { key: "exposure", label: "exposure", min: 0.3, max: 1.8, step: 0.02 },
];

export default function TinToggle({ variant = "full", onChange }: TinToggleProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<ToggleHandle | null>(null);
  const liveRef = useRef<ToggleParams>({ ...DEFAULT_PARAMS });
  const changeRef = useRef(onChange);
  // kept in an effect, not assigned during render
  useEffect(() => { changeRef.current = onChange; }, [onChange]);

  const [params, setParams] = useState<ToggleParams>({ ...DEFAULT_PARAMS });
  const [on, setOn] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: ToggleHandle | null = null;
    try {
      handle = startToggle(canvas, {
        params: liveRef.current,
        onChange: (next) => { setOn(next); changeRef.current?.(next); },
        onError: (message) => setError(message),
        onStats: (line) => setStats(line),
      });
      handleRef.current = handle;
    } catch (e) {
      const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
      queueMicrotask(() => setError(message));
    }
    return () => { handle?.dispose(); handleRef.current = null; };
  }, []);

  const setParam = useCallback((key: keyof ToggleParams, value: number) => {
    liveRef.current[key] = value;
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <figure className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""}`}>
      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="switch"
          aria-checked={on}
          aria-label="pressed tin switch"
        />
        {error ? <pre className={styles.error}>{error}</pre> : null}
        {!error && stats && typeof window !== "undefined"
          && new URLSearchParams(window.location.search).get("debug")
          ? <pre className={styles.stats}>{stats}</pre> : null}
      </div>

      <span className={styles.state}>{on ? "on" : "off"}</span>

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
