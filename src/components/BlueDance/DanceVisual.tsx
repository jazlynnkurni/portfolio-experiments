"use client";

import { Plus_Jakarta_Sans } from "next/font/google";
import BlueDance from "./BlueDance";
import FluidField from "./FluidField";
import styles from "./DanceVisual.module.css";
import type { CSSProperties } from "react";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600"],
  style: ["italic"],
});

// Plus Jakarta Sans semibold italic 40, matching the reference layout.
const label: CSSProperties = {
  position: "absolute",
  margin: 0,
  zIndex: 3,
  pointerEvents: "none",
  fontStyle: "italic",
  fontWeight: 600,
  fontSize: 40,
  lineHeight: 1.05,
  letterSpacing: "-0.01em",
  color: "#0b0b0c",
  whiteSpace: "nowrap",
};

export default function DanceVisual({
  palette = "cool",
}: {
  palette?: "cool" | "thermal";
}) {
  return (
    <main
      className={jakarta.className}
      style={{
        position: "relative",
        minHeight: "100dvh",
        background: "#ffffff",
        overflow: "hidden",
        cursor: "none",
      }}
    >
      {/* cursor-reactive dye field, full bleed behind everything */}
      <FluidField palette={palette} />

      {/* draggable spinning wheel, transparent so the field shows around it */}
      <div
        className={styles.dropIn}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "min(68vmin, 680px)", height: "min(68vmin, 680px)" }}>
          <BlueDance
            variant="embed"
            mode="flat"
            transparent
            interactive
            scale={0.92}
          />
        </div>
      </div>

      <span style={{ ...label, top: "8%", left: "8%" }}>I think</span>
      <span
        style={{ ...label, top: "50%", right: "4%", transform: "translateY(-50%)" }}
      >
        we should all
      </span>
      <span style={{ ...label, bottom: "8%", left: "6%" }}>go dancing.</span>
    </main>
  );
}
