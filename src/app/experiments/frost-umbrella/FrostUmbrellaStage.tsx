"use client";

import { useState } from "react";
import FrostUmbrella from "@/components/FrostUmbrella/FrostUmbrella";

const DEFAULTS = {
  color: "#5a7cf0",
  frost: 0.4,
  gradient: 0.6,
  angleDeg: 69,
  edge: 0.3,
  scale: 0.6,
};

type Row = {
  key: "frost" | "gradient" | "angleDeg" | "edge" | "scale";
  label: string;
  min: number;
  max: number;
  step: number;
};

const ROWS: Row[] = [
  { key: "frost", label: "frost", min: 0, max: 1, step: 0.01 },
  { key: "edge", label: "abstract", min: 0, max: 1, step: 0.01 },
  { key: "gradient", label: "gradient", min: 0, max: 1, step: 0.01 },
  { key: "angleDeg", label: "angle", min: 0, max: 360, step: 1 },
  { key: "scale", label: "size", min: 0.4, max: 0.85, step: 0.01 },
];

export default function FrostUmbrellaStage() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [open, setOpen] = useState(true);

  return (
    <main className="relative min-h-dvh">
      <FrostUmbrella
        variant="full"
        color={cfg.color}
        frost={cfg.frost}
        gradient={cfg.gradient}
        angle={(cfg.angleDeg * Math.PI) / 180}
        edge={cfg.edge}
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
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ letterSpacing: 1, opacity: 0.7 }}>UMBRELLA</span>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: "#eaf0ff", cursor: "pointer", opacity: 0.7 }}
              aria-label="Hide controls"
            >
              hide
            </button>
          </div>

          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span>color</span>
            <input
              type="color"
              value={cfg.color}
              onChange={(e) => setCfg((c) => ({ ...c, color: e.target.value }))}
              style={{
                width: 44,
                height: 24,
                padding: 0,
                border: "1px solid rgba(234,240,255,0.25)",
                borderRadius: 6,
                background: "none",
                cursor: "pointer",
              }}
            />
          </label>

          {ROWS.map((r) => (
            <label key={r.key} style={{ display: "block", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>{r.label}</span>
                <span style={{ opacity: 0.7 }}>
                  {r.step < 1 ? cfg[r.key].toFixed(2) : cfg[r.key].toFixed(0)}
                </span>
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
                style={{ width: "100%", accentColor: "#7d92ea", cursor: "pointer" }}
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
