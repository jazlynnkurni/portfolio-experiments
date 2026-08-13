"use client";

import { MeshReflectorMaterial } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * Water - the night water surface a floating konbini sits on.
 *
 * Two stacked planes, both centred on the origin at y ~ 0:
 *  1. a real planar reflection (drei MeshReflectorMaterial) so the store is
 *     genuinely mirrored, darkened toward a deep tint and blurred with a
 *     depth-based fade so distant reflection dissolves;
 *  2. an additive shader plane holding the light that spills off the store,
 *     radial falloff broken into drifting ripple bands so it reads as light
 *     lying ON water rather than a flat disc.
 *
 * Everything is procedural, no external image assets, so the component stays
 * self-contained and portable.
 */

export type WaterProps = {
  /** plane size in world units */
  size?: number;
  /** 0..1 surface movement */
  waves?: number;
  /** deep water colour */
  tint?: string;
  /** x,z where the store sits */
  center?: [number, number];
  /** colour of light spilling from the store */
  glowColor?: string;
  /** 0..1 spill strength */
  glow?: number;
  /** "low" halves reflection res and kills blur */
  quality?: "high" | "low";
};

/* -------------------------------------------------------------------------- */
/* procedural distortion map                                                   */
/* -------------------------------------------------------------------------- */

/** integer hash -> 0..1, deterministic so the texture never changes run to run */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** value noise on a wrapping lattice, so every octave tiles seamlessly */
function periodicNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wrap = (n: number) => ((n % period) + period) % period;
  const x0 = wrap(xi);
  const y0 = wrap(yi);
  const x1 = wrap(xi + 1);
  const y1 = wrap(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/**
 * Layered value noise plus two stretched sine bands, drawn once into an
 * offscreen canvas. Only the red channel is read by the reflector, the other
 * channels carry the same field so the texture stays readable if inspected.
 */
function makeRippleTexture(res: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const img = ctx.createImageData(res, res);
  const data = img.data;
  const TAU = Math.PI * 2;

  for (let j = 0; j < res; j++) {
    const v = j / res;
    for (let i = 0; i < res; i++) {
      const u = i / res;
      let n = 0;
      n += 0.5 * periodicNoise(u, v, 4, 11);
      n += 0.26 * periodicNoise(u, v, 9, 27);
      n += 0.14 * periodicNoise(u, v, 18, 53);
      n += 0.1 * periodicNoise(u, v, 36, 91);
      // stretched bands keep the ripples reading as water rather than clouds
      n += 0.09 * Math.sin(v * TAU * 3 + n * 6.0);
      n += 0.05 * Math.sin(u * TAU * 2 - v * TAU * 5);
      const c = Math.max(0, Math.min(255, Math.round(n * 255)));
      const o = (j * res + i) * 4;
      data[o] = c;
      data[o + 1] = c;
      data[o + 2] = c;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/* light pool shader                                                           */
/* -------------------------------------------------------------------------- */

const GLOW_VERT = /* glsl */ `
  out vec2 vUv;
  out vec2 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const GLOW_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2  uCenter;
  uniform vec3  uColor;
  uniform float uGlow;
  uniform float uWaves;
  uniform float uSize;
  in vec2 vUv;
  in vec2 vWorld;
  out vec4 fragColor;

  float hash12(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = hash12(i),               b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0,1.0)), d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main(){
    vec2  d = vWorld - uCenter;
    float t = uTime;
    float R = max(uSize * 0.30, 0.001);

    // anisotropic radius: the spill stretches along z, the way a lit sign
    // smears toward whoever is looking at it
    vec2  e  = vec2(d.x / (R * 0.62), d.y / (R * 1.45));
    float rr = length(e);

    float pool = exp(-rr * 1.55);   // broad spill around the store
    float core = exp(-rr * 5.20);   // bright water directly underneath

    // ripple bands: four sines, different frequencies, phases and drift
    float x = d.x, z = d.y;
    float w = 0.0;
    w += 0.50 * sin(z * 1.70 + x * 0.11 - t * 0.85);
    w += 0.32 * sin(z * 3.30 - x * 0.19 + t * 0.61);
    w += 0.20 * sin(z * 6.90 + x * 0.07 - t * 1.45);
    w += 0.12 * sin(z * 13.0 - x * 0.27 + t * 2.10);
    // roughen so the bands never look like a test pattern
    w += 0.34 * (vnoise(vec2(x * 0.30, z * 0.85 - t * 0.22)) - 0.5);
    w *= 0.30 + 1.10 * uWaves;

    // near the store the pool stays solid, further out only the crests survive
    float band   = smoothstep(-0.30, 0.62, w);
    float broken = mix(1.0, band, smoothstep(0.18, 1.20, rr));

    // slow shimmer crawling along the streaks
    float shimmer = 0.72 + 0.28 * sin(x * 0.22 + z * 0.60 - t * 0.33 + w * 2.20);

    float I = uGlow * (core * 1.35 + pool * broken * shimmer * 1.15);

    // fade before the plane edge so the pool never clips to a hard border
    vec2 fade = smoothstep(vec2(0.0), vec2(0.12), vUv)
              * smoothstep(vec2(0.0), vec2(0.12), vec2(1.0) - vUv);
    I *= fade.x * fade.y;

    vec3 col = mix(uColor, vec3(1.0), clamp(core * 0.55, 0.0, 1.0));
    fragColor = vec4(col * I, clamp(I, 0.0, 1.0));
  }
`;

type GlowUniforms = {
  uTime: { value: number };
  uCenter: { value: THREE.Vector2 };
  uColor: { value: THREE.Color };
  uGlow: { value: number };
  uWaves: { value: number };
  uSize: { value: number };
};

/* -------------------------------------------------------------------------- */

/** how many times the distortion map tiles across the water plane */
const RIPPLE_TILES = 5;

/** uv of a single quad plane, pre tiled; the scroll offset is added on top */
const BASE_UV = [0, 1, 1, 1, 0, 0, 1, 0].map((v) => v * RIPPLE_TILES);

export function Water({
  size = 120,
  waves = 0.5,
  tint = "#04080f",
  center = [0, 0],
  glowColor = "#ffd2a0",
  glow = 1,
  quality = "high",
}: WaterProps): React.JSX.Element {
  const low = quality === "low";
  const [cx, cz] = center;

  // distortion map, generated once per quality tier
  const rippleMap = useMemo(() => makeRippleTexture(low ? 128 : 256), [low]);
  useEffect(() => {
    return () => {
      rippleMap?.dispose();
    };
  }, [rippleMap]);

  // The reflector samples its distortion map with the raw mesh uv, so a texture
  // offset alone would not shift anything. The offset stays authoritative and
  // is mirrored into the plane uvs, which is what actually gets sampled.
  const geoRef = useRef<THREE.PlaneGeometry>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const lastColor = useRef("");

  const uniforms = useMemo<GlowUniforms>(
    () => ({
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uColor: { value: new THREE.Color("#ffffff") },
      uGlow: { value: 1 },
      uWaves: { value: 0.5 },
      uSize: { value: 120 },
    }),
    // created once, live values pushed below
    []
  );

  // hold time still when the visitor asked for reduced motion
  const reduced = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const clock = useRef(0);

  useFrame((_state, delta) => {
    if (!reduced.current) clock.current += Math.min(delta, 0.05);
    const t = clock.current;

    const m = matRef.current;
    if (m) {
      const u = m.uniforms as unknown as GlowUniforms;
      u.uTime.value = t;
      u.uGlow.value = glow;
      u.uWaves.value = waves;
      u.uSize.value = size;
      u.uCenter.value.set(cx, cz);
      if (lastColor.current !== glowColor) {
        u.uColor.value.set(glowColor);
        lastColor.current = glowColor;
      }
    }

    const drift = 0.012 + 0.05 * waves;
    const ox = t * drift * 0.35;
    const oy = t * drift;

    if (rippleMap) rippleMap.offset.set(ox, oy);

    const geo = geoRef.current;
    if (geo) {
      const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute;
      const arr = uvAttr.array as Float32Array;
      for (let i = 0; i < arr.length && i < BASE_UV.length; i += 2) {
        arr[i] = BASE_UV[i] + ox;
        arr[i + 1] = BASE_UV[i + 1] + oy;
      }
      uvAttr.needsUpdate = true;
    }
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry ref={geoRef} args={[size, size, 1, 1]} />
        <MeshReflectorMaterial
          color={tint}
          resolution={low ? 512 : 1024}
          mixBlur={low ? 0 : 1.1}
          blur={low ? [0, 0] : [420, 110]}
          mirror={0.82}
          mixStrength={low ? 3.2 : 4.6}
          mixContrast={1.35}
          depthScale={1.4}
          minDepthThreshold={0.2}
          maxDepthThreshold={1.35}
          depthToBlurRatioBias={0.22}
          distortion={rippleMap ? 0.1 + 0.7 * waves : 0}
          distortionMap={rippleMap}
          metalness={0.86}
          roughness={low ? 0.5 : 0.38}
          reflectorOffset={0.01}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[size, size, 1, 1]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={GLOW_VERT}
          fragmentShader={GLOW_FRAG}
          glslVersion={THREE.GLSL3}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export default Water;
