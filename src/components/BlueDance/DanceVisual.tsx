"use client";

import { Plus_Jakarta_Sans } from "next/font/google";
import BlueDance, { type BlueDanceMode } from "./BlueDance";
import type { CSSProperties } from "react";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600"],
  style: ["italic"],
});

type DanceVisualProps = {
  /** effect run over the spinning wheel */
  mode?: BlueDanceMode;
};

// Plus Jakarta Sans semibold italic 48, matching the reference layout.
const label: CSSProperties = {
  position: "absolute",
  margin: 0,
  fontStyle: "italic",
  fontWeight: 600,
  fontSize: 48,
  lineHeight: 1.05,
  letterSpacing: "-0.01em",
  color: "#0b0b0c",
  whiteSpace: "nowrap",
};

export default function DanceVisual({ mode = "dither" }: DanceVisualProps) {
  return (
    <main
      className={jakarta.className}
      style={{
        position: "relative",
        minHeight: "100dvh",
        background: "#ffffff",
        overflow: "hidden",
      }}
    >
      <span style={{ ...label, top: "8%", left: "8%" }}>I think</span>
      <span style={{ ...label, top: "17%", right: "7%" }}>we should all</span>
      <span style={{ ...label, bottom: "8%", left: "6%" }}>go dancing.</span>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "min(80vmin, 860px)", height: "min(80vmin, 860px)" }}>
          <BlueDance variant="embed" mode={mode} scale={0.94} />
        </div>
      </div>
    </main>
  );
}
