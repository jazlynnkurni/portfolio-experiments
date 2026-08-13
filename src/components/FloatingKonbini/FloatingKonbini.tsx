"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import type { Group } from "three";
import styles from "./FloatingKonbini.module.css";
import { Store } from "./Store";
import { Water } from "./Water";

type Variant = "full" | "embed";

type FloatingKonbiniProps = {
  variant?: Variant;
  className?: string;
  style?: CSSProperties;
};

const ACCENT = "#FF5A1F";
const ACCENT_2 = "#38BDF8";
const NIGHT = "#050912";

/**
 * The store rides the swell. Everything the shop is built from stays static,
 * so the whole raft is moved as one body: a slow heave with a second, slower
 * beat over it, plus a little roll and pitch that lag the heave the way a real
 * hull lags the water it sits in.
 */
function Raft({
  swell,
  glow,
  quality,
}: {
  swell: number;
  glow: number;
  quality: "high" | "low";
}) {
  const ref = useRef<Group>(null);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.position.y = (Math.sin(t * 0.62) * 0.17 + Math.sin(t * 0.29 + 1.3) * 0.1) * swell;
    g.rotation.z = Math.sin(t * 0.47 + 0.7) * 0.022 * swell;
    g.rotation.x = Math.sin(t * 0.36 + 2.1) * 0.017 * swell;
    g.rotation.y = Math.sin(t * 0.19) * 0.03 * swell;
  });

  return (
    <group ref={ref}>
      <Store glow={glow} accent={ACCENT} accent2={ACCENT_2} quality={quality} />
    </group>
  );
}

function Scene({
  glow,
  waves,
  quality,
  spin,
  reduced,
}: {
  glow: number;
  waves: number;
  quality: "high" | "low";
  spin: boolean;
  reduced: boolean;
}) {
  const swell = reduced ? 0 : waves;

  return (
    <>
      <color attach="background" args={[NIGHT]} />
      <fogExp2 attach="fog" args={[NIGHT, 0.022]} />

      {/* moonlight from behind and above, cold and weak. The store supplies
          nearly all of the light in this scene, which is the whole point. */}
      <ambientLight intensity={0.13} color="#4a6a9c" />
      <directionalLight position={[-14, 18, -12]} intensity={0.32} color="#7fa3d8" />

      <Stars
        radius={90}
        depth={40}
        count={quality === "low" ? 900 : 2200}
        factor={3.4}
        saturation={0}
        fade
        speed={reduced ? 0 : 0.4}
      />

      <Raft swell={swell} glow={glow} quality={quality} />

      <Water
        size={130}
        waves={waves}
        tint="#04080f"
        center={[0, 0]}
        glowColor={ACCENT}
        glow={glow}
        quality={quality}
      />

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        minDistance={9}
        maxDistance={34}
        // never let the camera drop under the waterline
        maxPolarAngle={Math.PI / 2 - 0.04}
        minPolarAngle={0.45}
        target={[0, 1.4, 0]}
        autoRotate={spin && !reduced}
        autoRotateSpeed={0.35}
      />
    </>
  );
}

export default function FloatingKonbini({
  variant = "full",
  className = "",
  style,
}: FloatingKonbiniProps) {
  const [ui, setUi] = useState({
    glow: 1,
    waves: 0.55,
    spin: true,
    quality: (variant === "embed" ? "low" : "high") as "high" | "low",
  });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <div className={`${styles.root} ${className}`} data-variant={variant} style={style}>
      <div className={styles.stage}>
        <Canvas
          shadows={ui.quality === "high"}
          dpr={ui.quality === "high" ? [1, 2] : [1, 1.5]}
          gl={{ antialias: true }}
          camera={{ position: [11, 4.6, 13], fov: 38, near: 0.1, far: 220 }}
        >
          <Suspense fallback={null}>
            <Scene
              glow={ui.glow}
              waves={ui.waves}
              quality={ui.quality}
              spin={ui.spin}
              reduced={reduced}
            />
          </Suspense>
        </Canvas>
        <p className={styles.hint} aria-hidden="true">
          drag to orbit / scroll to zoom
        </p>
      </div>

      {variant === "full" && (
        <div className={styles.hud}>
          <div className={styles.hudRow}>
            <span className={styles.title}>open all night</span>
            <span className={styles.meta}>
              floating konbini / planar reflection / {ui.quality} quality
            </span>
          </div>

          <div className={styles.controls}>
            <label className={styles.slider}>
              <span>glow</span>
              <input
                type="range"
                min={0.2}
                max={1.6}
                step={0.05}
                value={ui.glow}
                onChange={(e) =>
                  setUi((u) => ({ ...u, glow: Number(e.target.value) }))
                }
              />
            </label>
            <label className={styles.slider}>
              <span>swell</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={ui.waves}
                onChange={(e) =>
                  setUi((u) => ({ ...u, waves: Number(e.target.value) }))
                }
              />
            </label>

            <button
              type="button"
              className={styles.chip}
              data-active={ui.spin}
              aria-pressed={ui.spin}
              onClick={() => setUi((u) => ({ ...u, spin: !u.spin }))}
            >
              drift
            </button>
            <button
              type="button"
              className={styles.chip}
              data-active={ui.quality === "high"}
              aria-pressed={ui.quality === "high"}
              onClick={() =>
                setUi((u) => ({
                  ...u,
                  quality: u.quality === "high" ? "low" : "high",
                }))
              }
            >
              high quality
            </button>
          </div>

          {reduced && (
            <p className={styles.reduced}>
              Reduced motion is on, so the raft is held level and the drift is
              off. Dragging still orbits the camera.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
