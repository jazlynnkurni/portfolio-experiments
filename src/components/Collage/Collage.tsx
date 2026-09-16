"use client";

import { useEffect, useRef, useState } from "react";
import { startCollage, type CollageHandle } from "./engine";
import styles from "./Collage.module.css";

type CollageProps = {
  variant?: "full" | "embed";
};

export default function Collage({ variant = "full" }: CollageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<CollageHandle | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: CollageHandle | null = null;
    try {
      handle = startCollage(canvas, {
        onError: (message) => setError(message),
        onPick: (id) => setPicked(id),
      });
      handleRef.current = handle;
    } catch (e) {
      const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
      queueMicrotask(() => setError(message));
    }
    return () => { handle?.dispose(); handleRef.current = null; };
  }, []);

  return (
    <figure className={styles.wrap}>
      <div className={styles.board}>
        <canvas ref={canvasRef} className={styles.canvas} />
        {error ? <pre className={styles.error}>{error}</pre> : null}
      </div>
      {variant === "full" ? (
        <figcaption className={styles.bar}>
          <span>drag to move, drag a corner to resize</span>
          <span className={styles.spacer} />
          <span>{picked ?? ""}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
