"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GlassCompass from "./GlassCompass";
import styles from "./Showcase.module.css";

type ShowcaseProps = {
  variant?: "full" | "embed";
  animate?: boolean;
};

// Embedded in another page (the sandbox shows every experiment in an
// iframe), the tile is shown small, so it runs the lighter embed variant.
function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent: certainly embedded
  }
}

// The finished tile, centred, with a soft drop shadow and a faint floor
// reflection: the same treatment as the horse folder lab. The reflection is
// the rendered tile itself, copied each frame at half resolution, mirrored
// about the tile's bottom edge, blurred, faded out.
//
// Hover (a tap on touch screens) sets the hands turning and the light moving;
// leaving glides it all home. Off screen, nothing renders.
export default function Showcase({ variant, animate = true }: ShowcaseProps) {
  const scene = useRef<HTMLDivElement>(null);
  const mirror = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [visible, setVisible] = useState(true);
  // decided once, on the client, before the canvas builds anything
  const [resolved] = useState<"full" | "embed">(() => variant ?? (isEmbedded() ? "embed" : "full"));

  useEffect(() => {
    const el = scene.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onFrame = useCallback((source: HTMLCanvasElement) => {
    const target = mirror.current;
    if (!target) return;
    const w = Math.max(1, Math.round(source.width / 2));
    const h = Math.max(1, Math.round(source.height / 2));
    if (target.width !== w || target.height !== h) {
      target.width = w;
      target.height = h;
    }
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
  }, []);

  return (
    <div ref={scene} className={styles.scene}>
      <canvas ref={mirror} className={styles.mirror} aria-hidden="true" />
      <GlassCompass
        className={styles.tile}
        variant={resolved}
        animate={animate && visible}
        active={active && visible}
        onFrame={onFrame}
      />
      {/* hover area cut to the tile's rounded silhouette, above the canvas */}
      <div
        className={styles.hit}
        onPointerEnter={(e) => e.pointerType === "mouse" && setActive(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(false)}
        onPointerUp={(e) => e.pointerType !== "mouse" && setActive((a) => !a)}
      />
    </div>
  );
}
