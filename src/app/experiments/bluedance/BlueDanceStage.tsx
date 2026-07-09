"use client";

import { useState } from "react";
import BlueDance, { type BlueDanceMode } from "@/components/BlueDance/BlueDance";

const DEFAULTS = { speed: 1.05, pixel: 3, levels: 2, scale: 0.88 };

const MODES: BlueDanceMode[] = [
  "duoripple",
  "duotone",
  "ripple",
  "chromatic",
  "dither",
];

type Row = {
  key: keyof typeof DEFAULTS;
  label: string;
  min: number;
  max: number;
  step: number;
};

const ROWS: Row[] = [
  { key: "speed", label: "speed", min: -3, max: 3, step: 0.05 },
  { key: "pixel", label: "pixel", min: 1, max: 16, step: 1 },
  { key: "levels", label: "levels", min: 2, max: 8, step: 1 },
  { key: "scale", label: "scale", min: 0.3, max: 1, step: 0.01 },
];

export default function BlueDanceStage() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [mode, setMode] = useState<BlueDanceMode>("duoripple");
  const [open, setOpen] = useState(true);

  return (
    <main className="relative min-h-dvh bg-white">
      <BlueDance
        variant="full"
        mode={mode}
        speed={cfg.speed}
        pixel={cfg.pixel}
        levels={cfg.levels}
        scale={cfg.scale}
      />

      {open ? (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: 16,
            width: 224,
            padding: "14px 16px",
            borderRadius: 12,
            background: "rgba(10, 16, 34, 0.82)",
            color: "#eaf0ff",
            font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
            backdropFilter: "blur(6px)",
            boxShadow: "0 8px 30px rgba(10,16,34,0.25)",
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ letterSpacing: 1, opacity: 0.7 }}>BLUEDANCE</span>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: "#eaf0ff", cursor: "pointer", opacity: 0.7 }}
              aria-label="Hide controls"
            >
              hide
            </button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ opacity: 0.7, marginBottom: 6 }}>mode</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid rgba(234,240,255,0.25)",
                    background: mode === m ? "#3a5bff" : "none",
                    color: "#eaf0ff",
                    cursor: "pointer",
                    font: "inherit",
                    opacity: mode === m ? 1 : 0.75,
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {ROWS.map((r) => (
            <label key={r.key} style={{ display: "block", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>{r.label}</span>
                <span style={{ opacity: 0.7 }}>{cfg[r.key].toFixed(r.step < 1 ? 2 : 0)}</span>
              </div>
              <input
                type="range"
                min={r.min}
                max={r.max}
                step={r.step}
                value={cfg[r.key]}
                onChange={(e) =>
                  setCfg((c) => ({ ...c, [r.key]: parseFloat(e.target.value) }))
                }
                style={{ width: "100%", accentColor: "#3a5bff", cursor: "pointer" }}
              />
            </label>
          ))}

          <button
            onClick={() => setCfg(DEFAULTS)}
            style={{
              marginTop: 2,
              width: "100%",
              padding: "6px 0",
              borderRadius: 8,
              border: "1px solid rgba(234,240,255,0.25)",
              background: "none",
              color: "#eaf0ff",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            reset
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            top: 16,
            left: 16,
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(10, 16, 34, 0.82)",
            color: "#eaf0ff",
            border: "none",
            cursor: "pointer",
            font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: 1,
          }}
        >
          controls
        </button>
      )}
    </main>
  );
}
