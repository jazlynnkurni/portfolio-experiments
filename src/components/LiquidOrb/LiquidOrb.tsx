"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS, startOrb, type OrbParams, type OrbHandle } from "./engine";
import styles from "./LiquidOrb.module.css";

type LiquidOrbProps = {
  variant?: "full" | "embed";
  lines?: string[];
};

type Control = { key: keyof OrbParams; label: string; min: number; max: number; step: number };

const CONTROLS: Control[] = [
  { key: "speed", label: "turn", min: -1.5, max: 1.5, step: 0.02 },
  { key: "wobble", label: "liquid", min: 0, max: 0.2, step: 0.002 },
  { key: "wobScale", label: "liquid scale", min: 0.4, max: 6, step: 0.05 },
  { key: "wobSpeed", label: "liquid speed", min: 0, max: 1.2, step: 0.02 },
  { key: "tilt", label: "axis lean", min: -0.7, max: 0.7, step: 0.02 },
  { key: "ink", label: "ink", min: 0.4, max: 2.5, step: 0.02 },
  { key: "edgeInk", label: "edge ink", min: 0, max: 1.5, step: 0.02 },
  { key: "through", label: "far side", min: 0, max: 1.6, step: 0.02 },
  { key: "swirl", label: "swirl", min: 0, max: 2, step: 0.02 },
  { key: "radius", label: "size", min: 0.5, max: 1, step: 0.01 },
  { key: "grain", label: "grain", min: 0, max: 0.25, step: 0.005 },
];

const DEFAULT_LINES = ["Yale Photo", "Lecture Series", "presents"];

export default function LiquidOrb({ variant = "full", lines }: LiquidOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<OrbHandle | null>(null);
  const liveRef = useRef<OrbParams>({ ...DEFAULT_PARAMS });
  const [params, setParams] = useState<OrbParams>({ ...DEFAULT_PARAMS });
  const [text, setText] = useState((lines ?? DEFAULT_LINES).join("\n"));
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: OrbHandle | null = null;
    try {
      handle = startOrb(canvas, {
        params: liveRef.current,
        lines: (lines ?? DEFAULT_LINES),
        onError: (message) => setError(message),
      });
      handleRef.current = handle;
    } catch (e) {
      const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
      queueMicrotask(() => setError(message));
    }
    return () => { handle?.dispose(); handleRef.current = null; };
  }, [lines]);

  const setParam = useCallback((key: keyof OrbParams, value: number) => {
    liveRef.current[key] = value;
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onText = useCallback((value: string) => {
    setText(value);
    handleRef.current?.setLines(value.split("\n"));
  }, []);

  return (
    <figure className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""}`}>
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
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
              <label className={styles.row}>
                <span>words</span>
                <b>{text.split("\n").length} lines</b>
                <textarea
                  className={styles.text}
                  rows={4}
                  value={text}
                  onChange={(e) => onText(e.target.value)}
                />
              </label>
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
