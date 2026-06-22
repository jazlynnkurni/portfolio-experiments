"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import styles from "./MonetRipple.module.css";

type MonetRippleProps = {
  variant?: "full" | "embed";
};

// Every tunable the painting exposes. Colours are linear-ish 0..1 triples so the
// shader can mix them freely; positions/sizes are in 0..1 UV space.
const DEFAULTS = {
  sun: [0.5, 0.66] as [number, number], // centre of the sun disc
  sunSize: 0.05, // disc radius in UV
  sunColor: [0.95, 0.47, 0.28] as [number, number, number], // warm coral-orange
  skyTop: [0.66, 0.71, 0.83] as [number, number, number], // soft blue overhead
  skyMid: [0.82, 0.73, 0.82] as [number, number, number], // hazy lilac
  skyHorizon: [0.97, 0.83, 0.71] as [number, number, number], // warm peach at dawn
  waterLight: [0.63, 0.68, 0.71] as [number, number, number], // sky-lit near horizon
  waterDeep: [0.31, 0.4, 0.47] as [number, number, number], // cool blue-grey close in
  horizon: 0.55, // UV y where water meets sky (top 45% sky)
  rippleAmp: 0.006, // peak ripple displacement
  rippleSpeed: 1.15, // ripple drift rate
  brush: 0.014, // brushstroke distortion strength
  reflect: 0.85, // sun-reflection intensity on the water
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uTime;
  uniform vec2  uSun;
  uniform float uSunSize;
  uniform vec3  uSunColor;
  uniform vec3  uSkyTop;
  uniform vec3  uSkyMid;
  uniform vec3  uSkyHorizon;
  uniform vec3  uWaterLight;
  uniform vec3  uWaterDeep;
  uniform float uHorizon;
  uniform float uRippleAmp;
  uniform float uRippleSpeed;
  uniform float uBrush;
  uniform float uReflect;

  // value noise + fbm, the painterly engine
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;

    // hand-painted wobble: shove every sample around with low-freq fbm so edges
    // and bands never read as clean vector gradients
    vec2 brush = vec2(fbm(uv * 6.0 + 11.3), fbm(uv * 6.0 + 31.7)) - 0.5;
    vec2 puv = uv + brush * uBrush;

    // ---- SKY -------------------------------------------------------------
    float st = clamp((puv.y - uHorizon) / (1.0 - uHorizon), 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.55, st));
    sky = mix(sky, uSkyTop, smoothstep(0.45, 1.0, st));
    // horizontal dawn banding, wobbled by noise so the bands are loose
    sky += 0.025 * sin(puv.y * 34.0 + fbm(puv * 3.0) * 3.0);
    // broken colour: scattered warm/cool dabs
    sky += (fbm(puv * 13.0) - 0.5) * 0.07;
    sky += (fbm(puv * 30.0 + 5.0) - 0.5) * 0.035;

    // sun disc + soft halo (square frame, so plain distance)
    float sunD = distance(uv, uSun);
    float disc = smoothstep(uSunSize, uSunSize * 0.45, sunD);
    float halo = smoothstep(uSunSize * 7.0, 0.0, sunD);
    sky = mix(sky, uSunColor, disc);
    sky += uSunColor * halo * 0.45;

    // ---- WATER -----------------------------------------------------------
    // perspective ocean: receding surface, so wavelengths foreshorten and calm
    // toward the horizon and swell toward the viewer. P is a log depth ramp -
    // its screen frequency compresses near the skyline like real perspective.
    float toH = max(uHorizon - uv.y, 0.0);            // 0 at horizon, grows downward
    float depth = clamp(toH / uHorizon, 0.0, 1.0);    // 0 horizon .. 1 near viewer
    float P = -log(toH + 0.06);                        // perspective phase ramp
    float amp = uRippleAmp * (0.04 + 1.5 * depth * depth); // glassy at horizon, swelling close in

    // open water = several crossing wave trains at different angles + speeds,
    // so crests interfere and scatter instead of marching in tidy rows
    float w = 0.0;
    w += sin(P * 13.0 + uv.x * 7.0  - uTime * uRippleSpeed);
    w += sin(P * 19.0 - uv.x * 11.0 - uTime * uRippleSpeed * 1.3) * 0.65;
    w += sin(P * 27.0 + uv.x * 17.0 - uTime * uRippleSpeed * 0.8) * 0.45;
    // drifting chop dissolves any leftover regularity (wind-scattered surface)
    w += (fbm(vec2(uv.x * 9.0, P * 4.0 - uTime * 0.45)) - 0.5) * 2.2;
    float rip = w * amp;
    float d01 = depth; // alias kept for the reflection column below

    vec2 wuv = vec2(puv.x + rip * 0.5, puv.y + rip);
    float wt = depth;
    vec3 water = mix(uWaterLight, uWaterDeep, smoothstep(0.0, 1.0, wt));
    // broken painterly dabs: stretched horizontal strokes (water reads sideways)
    // plus a finer cross-dab so flat patches break into oil-paint flecks
    water += (fbm(vec2(wuv.x * 9.0, wuv.y * 22.0)) - 0.5) * 0.085;
    water += (fbm(vec2(wuv.x * 26.0, wuv.y * 60.0) + 4.0) - 0.5) * 0.05;
    // cool/warm broken colour: nudge dabs toward lilac or steel at random
    float wtone = fbm(wuv * 7.0 + 9.0);
    water += mix(vec3(-0.02, 0.0, 0.03), vec3(0.04, 0.02, -0.02), wtone) * 0.6;
    // crest highlights: wave tops catch the dawn light, denser near the horizon
    water += 0.05 * smoothstep(0.25, 1.0, w * 0.5 + 0.5) * (0.25 + depth);

    // ---- SUN REFLECTION (the hero) --------------------------------------
    // a warm column straight below the sun that the ripples chop into dabs
    float rx = abs(uv.x - uSun.x);
    float colW = uSunSize * 1.7 + d01 * 0.16; // widens slightly toward viewer
    float column = smoothstep(colW, 0.0, rx);
    float fall = smoothstep(0.0, uHorizon, uv.y); // brightest just under the sun
    // shimmer: ripple-driven dashes, foreshortened so they break fine near the
    // sun and stretch into longer dabs as the water nears the viewer
    float dash = fbm(vec2(uv.x * 11.0, P * 5.0 - uTime * 0.9));
    float shimmer = sin(P * 22.0 - uTime * uRippleSpeed * 1.35 + dash * 6.2);
    shimmer = smoothstep(0.05, 0.95, shimmer * 0.5 + 0.5);
    float reflMask = column * fall * shimmer;
    water = mix(water, uSunColor, clamp(reflMask * uReflect, 0.0, 1.0));
    water += uSunColor * reflMask * uReflect * 0.27;

    // ---- SOFT HORIZON BLEND ---------------------------------------------
    float h = smoothstep(uHorizon - 0.035, uHorizon + 0.025, puv.y);
    vec3 col = mix(water, sky, h);

    // final atmospheric haze: lift and desaturate a touch toward the horizon
    float haze = exp(-abs(puv.y - uHorizon) * 5.0) * 0.06;
    col += vec3(0.98, 0.86, 0.78) * haze;

    // gentle paper-grain so flat patches still read as oil, not screen
    col += (hash(uv * 800.0) - 0.5) * 0.018;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function Painting({ reducedRef }: { reducedRef: React.RefObject<boolean> }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { viewport } = useThree();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector2(...DEFAULTS.sun) },
      uSunSize: { value: DEFAULTS.sunSize },
      uSunColor: { value: new THREE.Vector3(...DEFAULTS.sunColor) },
      uSkyTop: { value: new THREE.Vector3(...DEFAULTS.skyTop) },
      uSkyMid: { value: new THREE.Vector3(...DEFAULTS.skyMid) },
      uSkyHorizon: { value: new THREE.Vector3(...DEFAULTS.skyHorizon) },
      uWaterLight: { value: new THREE.Vector3(...DEFAULTS.waterLight) },
      uWaterDeep: { value: new THREE.Vector3(...DEFAULTS.waterDeep) },
      uHorizon: { value: DEFAULTS.horizon },
      uRippleAmp: { value: DEFAULTS.rippleAmp },
      uRippleSpeed: { value: DEFAULTS.rippleSpeed },
      uBrush: { value: DEFAULTS.brush },
      uReflect: { value: DEFAULTS.reflect },
    }),
    []
  );

  useFrame((state) => {
    if (!matRef.current) return;
    // prefers-reduced-motion: hold time at a fixed frame (static painting)
    if (reducedRef.current) {
      matRef.current.uniforms.uTime.value = 8.0;
      return;
    }
    matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
      />
    </mesh>
  );
}

export default function MonetRipple({ variant = "full" }: MonetRippleProps) {
  const reducedRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;
    const onChange = () => {
      reducedRef.current = mq.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className={`${styles.frame} ${styles[variant]}`}>
      <Canvas
        className={styles.canvas}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 0, 1], fov: 50 }}
      >
        <Painting reducedRef={reducedRef} />
      </Canvas>
    </div>
  );
}
