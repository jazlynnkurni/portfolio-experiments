"use client";

import { useState } from "react";
import styles from "./WongKarWai.module.css";

type WongKarWaiProps = {
  variant?: "full" | "embed";
};

/**
 * Pixel-art scene shown crisp and pixelated in a framed widget, with a soft
 * grey drop shadow. Self-contained, scoped styles, relative asset.
 */
export default function WongKarWai({ variant = "full" }: WongKarWaiProps) {
  const [aspect, setAspect] = useState("1 / 1");

  return (
    <div
      className={`${styles.frame} ${variant === "embed" ? styles.embed : styles.full}`}
      style={{ aspectRatio: aspect }}
    >
      <img
        className={styles.art}
        src="/experiments/wong-kar-wai/scene.png"
        alt="Pixel art scene of a figure smoking by the water"
        onLoad={(e) => {
          const im = e.currentTarget;
          if (im.naturalWidth) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`);
        }}
      />
    </div>
  );
}
