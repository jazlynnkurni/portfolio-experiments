"use client";

import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

/**
 * Procedural snow surface rendered with a GLSL fragment shader. An fbm
 * heightfield of drifts is lit by one low raking light, so ridges highlight
 * and valleys fall into soft shadow. Palette stays near-white and low contrast
 * so it reads as sculpted snow, not rock. Its own painterly-digital look, not
 * a photo match. Rendered once (frameloop demand): no per-frame work, which
 * also satisfies prefers-reduced-motion since nothing animates.
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
    float lit = smoothstep(-uShadowSoftness, uShadowSoftness, ndl);
    vec3 col = mix(uShadow, uHigh, lit);

    // subtle sheen so ridge crests glint
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 28.0) * 0.10;
    col += spec;

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
};

// Tunable defaults, lifted to props so the look can be adjusted by eye.
const DEFAULTS: SnowUniforms = {
  lightDir: [0.72, 0.5, 0.42], // low raking light from the upper right
  ridgeScale: 3.0, // larger, softer drifts
  ridgeHeight: 0.3, // gentle relief so it stays snow, not rock
  shadowSoftness: 0.8, // wide, soft light-to-shadow transition
  high: "#FDFCF9", // warm white
  shadow: "#E2E5EB", // faint cool grey
};

function SnowPlane({ settings }: { settings: SnowUniforms }) {
  const uniforms = useMemo(
    () => ({
      uLightDir: { value: new THREE.Vector3(...settings.lightDir).normalize() },
      uRidgeScale: { value: settings.ridgeScale },
      uRidgeHeight: { value: settings.ridgeHeight },
      uShadowSoftness: { value: settings.shadowSoftness },
      uHigh: { value: new THREE.Color(settings.high) },
      uShadow: { value: new THREE.Color(settings.shadow) },
    }),
    [settings]
  );

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
  return (
    <Canvas
      className={className}
      frameloop="demand"
      orthographic
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ position: "absolute", inset: 0 }}
    >
      <SnowPlane settings={settings} />
    </Canvas>
  );
}
