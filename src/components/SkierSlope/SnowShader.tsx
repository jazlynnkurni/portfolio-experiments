"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

/**
 * Procedural snow surface rendered with a GLSL fragment shader. An fbm
 * heightfield of drifts is lit by one low raking light, so ridges highlight
 * and valleys fall into soft shadow. On top of that, a separate low-frequency
 * noise mask paints dappled sunlight: soft warm patches that slowly drift
 * across the snow, like sun through moving cloud, while other areas stay in
 * cooler shade. Palette stays near-white and low contrast so it reads as
 * sculpted snow, not rock.
 *
 * Performance: the Canvas runs on demand and is driven at a capped low frame
 * rate (the drift is slow, so ~30fps is plenty). Under prefers-reduced-motion
 * it renders a single static frame with no drift.
 */

// Fullscreen quad: pass the [-1,1] plane straight to clip space, ignore camera.
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec3 uLightDir;        // direction toward the raking light
  uniform float uRidgeScale;     // noise frequency: size of the drifts
  uniform float uRidgeHeight;    // heightfield amplitude: ridge contrast
  uniform float uShadowSoftness; // spread of the light-to-shadow transition
  uniform vec3 uHigh;            // warm-white highlight
  uniform vec3 uShadow;          // faint cool-grey shadow

  uniform float uTime;           // seconds, drives the dapple drift
  uniform float uPatchScale;     // size of the sunlight pools (low = bigger)
  uniform float uDriftSpeed;     // how fast the patches travel
  uniform float uDappleIntensity;// strength of lit vs shaded
  uniform float uWarmth;         // warmth of the lit patches

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 6; i++) {
      v += a * noise(p);
      p = m * p;
      a *= 0.5;
    }
    return v;
  }

  // snow height at a point: large drifts plus finer wind ripples
  float height(vec2 uv) {
    float drifts = fbm(uv * uRidgeScale);
    float ripples = fbm(uv * uRidgeScale * 3.0) * 0.15;
    return (drifts + ripples) * uRidgeHeight;
  }

  void main() {
    float e = 0.0016;
    float hL = height(vUv - vec2(e, 0.0));
    float hR = height(vUv + vec2(e, 0.0));
    float hD = height(vUv - vec2(0.0, e));
    float hU = height(vUv + vec2(0.0, e));

    // surface normal from the height gradient (finite differences)
    vec2 grad = vec2(hR - hL, hU - hD) / (2.0 * e);
    vec3 n = normalize(vec3(-grad, 1.0));

    vec3 L = normalize(uLightDir);
    float ndl = dot(n, L);

    // soft raking light: ridges face the light (bright), valleys shadow
    float litRidge = smoothstep(-uShadowSoftness, uShadowSoftness, ndl);
    vec3 col = mix(uShadow, uHigh, litRidge);

    // subtle sheen so ridge crests glint
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 28.0) * 0.10;
    col += spec;

    // dappled drifting sunlight: a separate low-frequency mask, decorrelated
    // from the ridge noise by a domain offset, drifting slowly over time
    vec2 drift = vec2(uTime * uDriftSpeed, uTime * uDriftSpeed * 0.45);
    float mask = fbm(vUv * uPatchScale + vec2(17.3, 9.1) + drift);
    float sun = smoothstep(0.42, 0.72, mask); // patchy: big soft pools

    // sunlit patches read brighter and a touch warmer; shade keeps current col
    vec3 sunlit = col * (1.0 + 0.16 * uDappleIntensity)
                + vec3(0.05, 0.032, 0.0) * (uWarmth * uDappleIntensity);
    col = mix(col, sunlit, sun);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export type SnowUniforms = {
  lightDir: [number, number, number];
  ridgeScale: number;
  ridgeHeight: number;
  shadowSoftness: number;
  high: string;
  shadow: string;
  patchScale: number;
  driftSpeed: number;
  dappleIntensity: number;
  warmth: number;
};

// Tunable defaults, lifted to props so the look can be adjusted by eye.
const DEFAULTS: SnowUniforms = {
  lightDir: [0.72, 0.5, 0.42], // low raking light from the upper right
  ridgeScale: 3.0,
  ridgeHeight: 0.3,
  shadowSoftness: 0.8,
  high: "#FDFCF9",
  shadow: "#E2E5EB",
  patchScale: 1.6, // a few big sunlight pools across the square
  driftSpeed: 0.018, // slow cloud-shadow drift
  dappleIntensity: 0.85, // clearly visible but still snow, not spotlights
  warmth: 1.0, // warmth of the lit patches
};

const FPS = 30; // capped render rate; the drift is slow so this is plenty

function SnowPlane({ settings, animate }: { settings: SnowUniforms; animate: boolean }) {
  const invalidate = useThree((s) => s.invalidate);

  const uniforms = useMemo(
    () => ({
      uLightDir: { value: new THREE.Vector3(...settings.lightDir).normalize() },
      uRidgeScale: { value: settings.ridgeScale },
      uRidgeHeight: { value: settings.ridgeHeight },
      uShadowSoftness: { value: settings.shadowSoftness },
      uHigh: { value: new THREE.Color(settings.high) },
      uShadow: { value: new THREE.Color(settings.shadow) },
      uTime: { value: 0 },
      uPatchScale: { value: settings.patchScale },
      uDriftSpeed: { value: settings.driftSpeed },
      uDappleIntensity: { value: settings.dappleIntensity },
      uWarmth: { value: settings.warmth },
    }),
    [settings]
  );

  // drive the drift at a capped frame rate, or render one static frame
  useEffect(() => {
    if (!animate) {
      uniforms.uTime.value = 0;
      invalidate();
      return;
    }
    const start = performance.now();
    const tick = setInterval(() => {
      uniforms.uTime.value = (performance.now() - start) / 1000;
      invalidate();
    }, 1000 / FPS);
    return () => clearInterval(tick);
  }, [animate, invalidate, uniforms]);

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}

export default function SnowShader({
  settings = DEFAULTS,
  className,
}: {
  settings?: SnowUniforms;
  className?: string;
}) {
  // honour reduced-motion: no drift, just a single static frame
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <Canvas
      className={className}
      frameloop="demand"
      orthographic
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ position: "absolute", inset: 0 }}
    >
      <SnowPlane settings={settings} animate={!reducedMotion} />
    </Canvas>
  );
}
