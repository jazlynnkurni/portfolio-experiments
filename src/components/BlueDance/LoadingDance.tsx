"use client";

import { Plus_Jakarta_Sans } from "next/font/google";
import BlueDance, { type BlueDanceMode } from "./BlueDance";
import styles from "./LoadingDance.module.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "600"] });

type LoadingDanceProps = {
  /** the microcopy shown above the fill bar (trailing "..." animates on its own) */
  phrase?: string;
  /** on-screen size of the spinning circle in px */
  size?: number;
  // circle look-and-feel (kept as props so we can lock in your tuned values)
  mode?: BlueDanceMode;
  speed?: number;
  pixel?: number;
  levels?: number;
  scale?: number;
};

export default function LoadingDance({
  phrase = "loading your Friday night",
  size = 220,
  mode = "duoripple",
  speed,
  pixel,
  levels,
  scale,
}: LoadingDanceProps) {
  return (
    <main
      className={jakarta.className}
      style={{
        minHeight: "100dvh",
        background: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className={styles.enter}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 44,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 320 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "#0b0b0c",
            }}
          >
            {phrase.includes("Friday") ? (
              <>
                {phrase.split("Friday")[0]}
                <span className={styles.friday}>Friday</span>
                {phrase.split("Friday")[1]}
              </>
            ) : (
              phrase
            )}
            <span className={styles.dots} aria-hidden="true" />
          </div>
          <div className={styles.track} role="progressbar" aria-label={phrase}>
            <div className={styles.fill} />
          </div>
        </div>

        <div
          className={styles.enterCircle}
          style={{ width: size, height: size, flexShrink: 0 }}
        >
          <BlueDance
            variant="embed"
            mode={mode}
            speed={speed}
            pixel={pixel}
            levels={levels}
            scale={scale}
          />
        </div>
      </div>
    </main>
  );
}
