"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

export type BlueDanceMode =
  | "dither"
  | "chromatic"
  | "ripple"
  | "duotone"
  | "duoripple";

const MODE_ID: Record<BlueDanceMode, number> = {
  dither: 0,
  chromatic: 1,
  ripple: 2,
  duotone: 3,
  duoripple: 4,
};

type BlueDanceProps = {
  variant?: "full" | "embed";
  /** which fragment effect to run over the spinning art */
  mode?: BlueDanceMode;
  /** asset to spin; transparent-background art works best */
  src?: string;
  /** spin speed in radians per second (negative = counter-clockwise) */
  speed?: number;
  /** dither dot size in device pixels; higher = chunkier */
  pixel?: number;
  /** quantization steps per channel; lower = more banding */
  levels?: number;
  /** on-screen size of the badge, 0..1 of the shorter axis */
  scale?: number;
  className?: string;
};

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fullscreen effect pass. uMode selects the look:
//   0 dither    - 4x4 ordered (Bayer) 1-bit halftone (original)
//   1 chromatic - radial RGB split, stronger toward the rim (club glitch)
//   2 ripple    - concentric wave distortion throbbing to a beat
//   3 duotone   - remap luminance onto blue->pastel-yellow, white bg kept
// In every mode the art is spun about centre and pure white stays white.
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uPixel;
  uniform float uLevels;
  uniform float uFit;
  uniform int uMode;
  in vec2 vUv;
  out vec4 fragColor;

  const float bayer[16] = float[](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );

  // screen uv (0..1) -> centred, aspect-corrected, zoomed, spun coordinate
  vec2 spun(vec2 uv) {
    vec2 p = uv - 0.5;
    p.x *= uRes.x / uRes.y;
    p *= uFit;
    float a = uTime * uSpeed;
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c) * p;
  }

  // sample the art at a centred coord (+0.5); raw texel, 0 outside the frame
  vec4 art(vec2 p) {
    vec2 tuv = p + 0.5;
    if (tuv.x >= 0.0 && tuv.x <= 1.0 && tuv.y >= 0.0 && tuv.y <= 1.0) {
      return texture(uTex, tuv);
    }
    return vec4(0.0);
  }

  vec3 onWhite(vec4 c) { return mix(vec3(1.0), c.rgb, c.a); }

  void main() {
    vec3 outc;

    if (uMode == 1) {
      // chromatic aberration: offset each channel radially
      vec2 p = spun(vUv);
      vec2 off = p * 0.045;
      outc.r = onWhite(art(p + off)).r;
      outc.g = onWhite(art(p)).g;
      outc.b = onWhite(art(p - off)).b;

    } else if (uMode == 2) {
      // concentric ripple, amplitude pulsing to a ~1.8 Hz beat
      vec2 p = spun(vUv);
      float rad = length(p);
      float beat = pow(max(sin(uTime * 6.2832 * 1.8), 0.0), 3.0);
      float amp = 0.006 + 0.012 * beat;
      float wave = sin(rad * 34.0 - uTime * 5.0) * amp;
      vec2 dir = rad > 1e-4 ? p / rad : vec2(0.0);
      outc = onWhite(art(p + dir * wave));

    } else if (uMode == 3 || uMode == 4) {
      // duotone remap; mode 4 first adds the beat-pulsed ripple displacement
      vec2 p = spun(vUv);
      if (uMode == 4) {
        float rad = length(p);
        float beat = pow(max(sin(uTime * 6.2832 * 1.8), 0.0), 3.0);
        float amp = 0.006 + 0.012 * beat;
        float wave = sin(rad * 34.0 - uTime * 5.0) * amp;
        vec2 dir = rad > 1e-4 ? p / rad : vec2(0.0);
        p += dir * wave;
      }
      vec4 c = art(p);
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 blue = vec3(0.039, 0.184, 0.718);
      vec3 yellow = vec3(0.976, 0.906, 0.624);
      outc = mix(vec3(1.0), mix(blue, yellow, lum), c.a);

    } else {
      // ordered Bayer dither (default)
      vec2 cellId = floor(gl_FragCoord.xy / uPixel);
      vec2 uv = (cellId + 0.5) * uPixel / uRes;
      vec3 base = onWhite(art(spun(uv)));
      int bx = int(mod(cellId.x, 4.0));
      int by = int(mod(cellId.y, 4.0));
      float thr = (bayer[by * 4 + bx] + 0.5) / 16.0 - 0.5;
      float steps = max(uLevels - 1.0, 1.0);
      outc = clamp(floor(base * steps + thr + 0.5) / steps, 0.0, 1.0);
    }

    fragColor = vec4(outc, 1.0);
  }
`;

function DitherQuad({
  src,
  mode,
  speed,
  pixel,
  levels,
  scale,
}: Required<Omit<BlueDanceProps, "variant" | "className">>) {
  const tex = useTexture(src, (t) => {
    const map = t as THREE.Texture;
    map.colorSpace = THREE.SRGBColorSpace;
    map.minFilter = THREE.LinearFilter;
    map.magFilter = THREE.LinearFilter;
  });
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();

  const uniforms = useMemo(
    () => ({
      uTex: { value: tex },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uMode: { value: MODE_ID[mode] },
      uSpeed: { value: speed },
      uPixel: { value: pixel },
      uLevels: { value: levels },
      uFit: { value: 1 / Math.max(scale, 0.05) },
    }),
    // uniforms object is created once; live values are pushed in useFrame
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useFrame((_, dt) => {
    const m = matRef.current;
    if (!m) return;
    const size = new THREE.Vector2();
    gl.getDrawingBufferSize(size);
    m.uniforms.uRes.value.copy(size);
    m.uniforms.uTime.value += dt;
    m.uniforms.uMode.value = MODE_ID[mode];
    m.uniforms.uSpeed.value = speed;
    m.uniforms.uPixel.value = pixel;
    m.uniforms.uLevels.value = levels;
    m.uniforms.uFit.value = 1 / Math.max(scale, 0.05);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        glslVersion={THREE.GLSL3}
        uniforms={uniforms}
      />
    </mesh>
  );
}

export default function BlueDance({
  variant = "full",
  mode = "dither",
  src = "/bluedance/bluedance.svg",
  speed = 1.05,
  pixel = 3,
  levels = 2,
  scale = 0.88,
  className = "",
}: BlueDanceProps) {
  return (
    <div
      className={className}
      style={{
        width: "100%",
        height: variant === "full" ? "100dvh" : "100%",
        background: "#ffffff",
      }}
    >
      <Canvas
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: false }}
        camera={{ left: -1, right: 1, top: 1, bottom: -1, near: 0, far: 2, position: [0, 0, 1] }}
      >
        <Suspense fallback={null}>
          <DitherQuad
            src={src}
            mode={mode}
            speed={speed}
            pixel={pixel}
            levels={levels}
            scale={scale}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
