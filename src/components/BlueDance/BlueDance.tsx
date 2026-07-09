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
  | "duoripple"
  | "flat";

const MODE_ID: Record<BlueDanceMode, number> = {
  dither: 0,
  chromatic: 1,
  ripple: 2,
  duotone: 3,
  duoripple: 4,
  flat: 5,
};

// drag-to-spin physics, shared between the DOM handlers and the frame loop
type DragState = {
  active: boolean;
  prev: number; // pointer angle last sample
  cur: number; // pointer angle now
  angle: number; // integrated wheel angle
  omega: number; // angular velocity (rad/s) for release momentum
};

type BlueDanceProps = {
  variant?: "full" | "embed";
  /** which fragment effect to run over the spinning art */
  mode?: BlueDanceMode;
  /** transparent background (output coverage) so whatever is behind shows */
  transparent?: boolean;
  /** drag the wheel to spin it, with fling momentum, instead of auto-spin */
  interactive?: boolean;
  /** asset to spin; transparent-background art works best */
  src?: string;
  /** spin speed in radians per second (auto-spin only) */
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

// Fullscreen effect pass. uMode selects the look (dither / chromatic / ripple /
// duotone / duoripple). The art is spun by uAngle (driven either by auto-spin
// or by drag momentum). uAlpha=1 outputs coverage so the background shows.
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uAngle;
  uniform float uPixel;
  uniform float uLevels;
  uniform float uFit;
  uniform int uMode;
  uniform float uAlpha;
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
    float s = sin(uAngle);
    float c = cos(uAngle);
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
    float cov;

    if (uMode == 1) {
      // chromatic aberration: offset each channel radially
      vec2 p = spun(vUv);
      vec2 off = p * 0.045;
      vec4 cc = art(p);
      outc.r = onWhite(art(p + off)).r;
      outc.g = onWhite(cc).g;
      outc.b = onWhite(art(p - off)).b;
      cov = cc.a;

    } else if (uMode == 2) {
      // concentric ripple, amplitude pulsing to a ~1.8 Hz beat
      vec2 p = spun(vUv);
      float rad = length(p);
      float beat = pow(max(sin(uTime * 6.2832 * 1.8), 0.0), 3.0);
      float amp = 0.006 + 0.012 * beat;
      float wave = sin(rad * 34.0 - uTime * 5.0) * amp;
      vec2 dir = rad > 1e-4 ? p / rad : vec2(0.0);
      vec4 cc = art(p + dir * wave);
      outc = onWhite(cc);
      cov = cc.a;

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
      vec4 cc = art(p);
      float lum = dot(cc.rgb, vec3(0.299, 0.587, 0.114));
      vec3 blue = vec3(0.039, 0.184, 0.718);
      vec3 yellow = vec3(0.976, 0.906, 0.624);
      vec3 duo = mix(blue, yellow, lum);
      outc = uAlpha > 0.5 ? duo : mix(vec3(1.0), duo, cc.a);
      cov = cc.a;

    } else if (uMode == 5) {
      // flat: crisp art, no dither/quantize (reads as a clean object)
      vec2 p = spun(vUv);
      vec4 cc = art(p);
      outc = uAlpha > 0.5 ? cc.rgb : mix(vec3(1.0), cc.rgb, cc.a);
      cov = cc.a;

    } else {
      // ordered Bayer dither (default)
      vec2 cellId = floor(gl_FragCoord.xy / uPixel);
      vec2 uv = (cellId + 0.5) * uPixel / uRes;
      vec4 cc = art(spun(uv));
      vec3 base = onWhite(cc);
      int bx = int(mod(cellId.x, 4.0));
      int by = int(mod(cellId.y, 4.0));
      float thr = (bayer[by * 4 + bx] + 0.5) / 16.0 - 0.5;
      float steps = max(uLevels - 1.0, 1.0);
      outc = clamp(floor(base * steps + thr + 0.5) / steps, 0.0, 1.0);
      cov = cc.a;
    }

    float a = uAlpha > 0.5 ? cov : 1.0;
    fragColor = vec4(outc, a);
  }
`;

type QuadProps = {
  src: string;
  mode: BlueDanceMode;
  transparent: boolean;
  interactive: boolean;
  speed: number;
  pixel: number;
  levels: number;
  scale: number;
  dragRef: React.MutableRefObject<DragState>;
};

function DitherQuad({
  src,
  mode,
  transparent,
  interactive,
  speed,
  pixel,
  levels,
  scale,
  dragRef,
}: QuadProps) {
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
      uAngle: { value: 0 },
      uMode: { value: MODE_ID[mode] },
      uAlpha: { value: transparent ? 1 : 0 },
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
    const d = dragRef.current;

    if (interactive) {
      if (d.active) {
        // while grabbed the wheel tracks the pointer angularly
        let delta = d.cur - d.prev;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        else if (delta < -Math.PI) delta += 2 * Math.PI;
        d.angle += delta;
        d.omega = delta / Math.max(dt, 1e-3);
        d.prev = d.cur;
      } else {
        // released: carry momentum (scales with how hard it was flung),
        // bleed it off with friction, keep a gentle idle drift
        d.angle += (d.omega + 0.12) * dt;
        d.omega *= Math.exp(-dt * 2.0);
      }
    } else {
      d.angle += speed * dt;
    }

    const size = new THREE.Vector2();
    gl.getDrawingBufferSize(size);
    m.uniforms.uRes.value.copy(size);
    m.uniforms.uTime.value += dt;
    m.uniforms.uAngle.value = d.angle;
    m.uniforms.uMode.value = MODE_ID[mode];
    m.uniforms.uAlpha.value = transparent ? 1 : 0;
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
        transparent={transparent}
      />
    </mesh>
  );
}

export default function BlueDance({
  variant = "full",
  mode = "dither",
  transparent = false,
  interactive = false,
  src = "/bluedance/bluedance.svg",
  speed = 1.05,
  pixel = 3,
  levels = 2,
  scale = 0.88,
  className = "",
}: BlueDanceProps) {
  const drag = useRef<DragState>({
    active: false,
    prev: 0,
    cur: 0,
    angle: 0,
    omega: 0,
  });

  const angleAt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.atan2(
      e.clientY - (r.top + r.height / 2),
      e.clientX - (r.left + r.width / 2)
    );
  };

  const handlers = interactive
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          const d = drag.current;
          d.active = true;
          d.prev = d.cur = angleAt(e);
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (drag.current.active) drag.current.cur = angleAt(e);
        },
        onPointerUp: () => {
          drag.current.active = false;
        },
        onPointerCancel: () => {
          drag.current.active = false;
        },
      }
    : {};

  return (
    <div
      className={className}
      style={{
        width: "100%",
        height: variant === "full" ? "100dvh" : "100%",
        background: transparent ? "transparent" : "#ffffff",
        touchAction: interactive ? "none" : undefined,
      }}
      {...handlers}
    >
      <Canvas
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: true, premultipliedAlpha: false }}
        camera={{ left: -1, right: 1, top: 1, bottom: -1, near: 0, far: 2, position: [0, 0, 1] }}
      >
        <Suspense fallback={null}>
          <DitherQuad
            src={src}
            mode={mode}
            transparent={transparent}
            interactive={interactive}
            speed={speed}
            pixel={pixel}
            levels={levels}
            scale={scale}
            dragRef={drag}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
