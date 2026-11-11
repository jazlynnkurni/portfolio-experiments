"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SUN } from "../config";
import { applyUniforms, motion, setSunAt, stepMotion, sunDirection } from "./sun";

// Stage 6 lighting. A cool sky dome with the warm sun in it as a soft disc and
// broad halo (an area-light approximation, prefiltered into the environment),
// plus a warm directional light for thin highlights and selective glints on
// ridges that face it. On glass with full transmission, direct light adds
// reflection only: the colour still comes from what passes through.

function skyScene(): THREE.Scene {
  const S = SUN;
  const scene = new THREE.Scene();
  const sunCol = new THREE.Color(S.colour);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Vector3(...S.sky.zenith) },
      uHorizon: { value: new THREE.Vector3(...S.sky.horizon) },
      uGround: { value: new THREE.Vector3(...S.sky.ground) },
      uSunDir: { value: setSunAt(0, new THREE.Vector3()) },
      uSunCol: { value: new THREE.Vector3(sunCol.r, sunCol.g, sunCol.b) },
      uGlow: { value: S.glow.strength },
      uInner: { value: Math.cos((S.glow.innerDeg * Math.PI) / 180) },
      uOuter: { value: Math.cos((S.glow.outerDeg * Math.PI) / 180) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol;
      uniform float uGlow, uInner, uOuter;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, d.y));
        vec3 col = d.y >= 0.0 ? sky : mix(uHorizon, uGround, smoothstep(0.0, 0.6, -d.y));
        float c = dot(d, uSunDir);
        // soft disc plus a wide, gentle halo
        float disc = smoothstep(uOuter, uInner, c);
        col += uSunCol * uGlow * (disc * disc + 0.25 * disc);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), material));
  return scene;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

type SunRigProps = { animate?: boolean; active?: boolean };

export default function SunRig({ animate = true, active = false }: SunRigProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const light = useRef<THREE.DirectionalLight>(null);
  const reduced = usePrefersReducedMotion();
  const drifting = animate && !reduced;
  // reduced motion keeps everything still, hover included
  const hovered = active && !reduced;
  useEffect(() => {
    motion.hovered = hovered;
  }, [hovered]);

  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const scene = skyScene();
    const texture = pmrem.fromScene(scene, 0.02).texture;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();
    return texture;
  }, [gl]);
  useEffect(() => () => env.dispose(), [env]);

  // One driver for all motion: the slow idle drift, the hover clock, the
  // glide home and the landing snap (lighting/sun.ts). Idle drift is
  // throttled; hover runs at full frame rate. Geometry never moves, only the
  // hands and the light.
  useEffect(() => {
    const place = () => {
      light.current?.position.copy(sunDirection).multiplyScalar(1000);
      invalidate();
    };
    let raf = 0;
    let last = performance.now();
    let lastDraw = 0;
    const step = 1000 / SUN.sway.fps;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (drifting) motion.idle += dt;
      const hoverMoving = stepMotion(dt);
      if (hoverMoving || (drifting && now - lastDraw >= step)) {
        lastDraw = now;
        place();
      }
      raf = requestAnimationFrame(tick);
    };
    applyUniforms();
    place();
    if (!drifting && !hovered && motion.mode === "rest") return;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drifting, hovered, invalidate]);

  const rest = useMemo(() => setSunAt(0, new THREE.Vector3()).multiplyScalar(1000), []);

  return (
    <>
      <primitive attach="environment" object={env} />
      <directionalLight ref={light} position={rest} color={SUN.colour} intensity={SUN.intensity} />
    </>
  );
}
