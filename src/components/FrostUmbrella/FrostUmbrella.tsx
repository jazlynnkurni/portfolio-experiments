"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

type FrostUmbrellaProps = {
  variant?: "full" | "embed";
  /** canopy colour as a #rrggbb hex */
  color?: string;
  /** frosted-glass amount, 0..1 */
  frost?: number;
  /** gradient strength across the canopy, 0..1 */
  gradient?: number;
  /** gradient direction in radians */
  angle?: number;
  /** how abstract/frosted the outlines are (noise warp of the silhouette), 0..1 */
  edge?: number;
  /** on-screen size of the umbrella (bigger = larger) */
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

// Procedural umbrella: canopy (scalloped dome) + pole + cane handle, drawn as
// SDF masks. The canopy is tinted by uColor, blended across a gradient, and
// finished with a frosted-glass pass (fbm haze + high-frequency sparkle).
const FRAG = /* glsl */ `
  precision highp float;
  uniform vec2 uRes;
  uniform vec3 uColor;
  uniform float uFrost;
  uniform float uGradient;
  uniform float uAngle;
  uniform float uEdge;
  uniform float uScale;
  in vec2 vUv;
  out vec4 fragColor;

  const float PI = 3.14159265;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
  }

  void main() {
    vec2 p = vUv - 0.5;
    p.x *= uRes.x / uRes.y;
    p /= uScale;

    float aa = 2.0 / (uRes.y * uScale);

    vec2 c = vec2(0.0, 0.12);
    float R = 0.5;
    float w = 2.0 * R / 8.0;   // 8 scallops
    float amp = 0.055;

    // frost the outlines: warp the coordinate used for the silhouette with
    // layered noise (low freq = wobble, high freq = crystalline creep)
    vec2 wp = p;
    if (uEdge > 0.001) {
      vec2 warp = vec2(fbm(p * 5.5 + 2.0), fbm(p * 5.5 + 9.0)) - 0.5;
      warp += (vec2(fbm(p * 17.0 + 4.0), fbm(p * 17.0 + 21.0)) - 0.5) * 0.55;
      wp = p + warp * uEdge * 0.13;
    }

    // canopy: inside the disc, above the scalloped rim
    float dC = length(wp - c);
    float yRim = c.y - amp * abs(cos(PI * wp.x / w));
    float inCircle = smoothstep(R + aa, R - aa, dC);
    float aboveRim = smoothstep(yRim - aa, yRim + aa, wp.y);
    float canopy = inCircle * aboveRim;

    // frame: pole, top ferrule, cane hook
    float poleTop = c.y - amp;
    float pole = smoothstep(0.014 + aa, 0.014 - aa, abs(wp.x)) *
                 step(-0.5, wp.y) * step(wp.y, poleTop);
    float tip = smoothstep(0.010 + aa, 0.010 - aa, abs(wp.x)) *
                step(c.y + R, wp.y) * step(wp.y, c.y + R + 0.07);
    vec2 h = vec2(-0.09, -0.5);
    float dring = abs(length(wp - h) - 0.09);
    float hook = smoothstep(0.016 + aa, 0.016 - aa, dring) * step(wp.y, h.y + 0.02);
    float frame = max(max(pole, tip), hook);

    // gradient across the canopy
    vec2 gdir = vec2(cos(uAngle), sin(uAngle));
    float g = clamp(dot((p - c) / R, gdir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 lightC = mix(uColor, vec3(1.0), 0.5);
    vec3 darkC = mix(uColor, vec3(0.0), 0.28);
    vec3 grad = mix(darkC, lightC, g);
    vec3 col = mix(uColor, grad, uGradient);

    // rib seams + soft form shading
    float rib = smoothstep(0.82, 1.0, abs(cos(PI * p.x / w)));
    col *= mix(1.0, 0.82, rib * 0.6);
    col *= 0.9 + 0.12 * dot(normalize(vec2(-0.4, 0.7)), normalize(p - c + 1e-4));

    // frosted glass: hazy fbm wash + sparkle
    float haze = fbm(p * 7.0 + 3.0);
    col = mix(col, vec3(0.92, 0.96, 1.0), haze * uFrost * 0.55);
    float spark = smoothstep(0.86, 0.98, fbm(p * 46.0)) * uFrost;
    col += spark * 0.5;

    // soft cool background gradient
    vec3 bg = mix(vec3(0.97, 0.98, 1.0), vec3(0.89, 0.91, 0.96), 1.0 - vUv.y);

    vec3 outc = bg;
    outc = mix(outc, vec3(0.16, 0.16, 0.18), frame);
    outc = mix(outc, col, canopy);

    fragColor = vec4(outc, 1.0);
  }
`;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function UmbrellaQuad({
  color,
  frost,
  gradient,
  angle,
  edge,
  scale,
}: Required<Omit<FrostUmbrellaProps, "variant" | "className">>) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();

  const uniforms = useMemo(() => {
    const [r, g, b] = hexToRgb(color);
    return {
      uRes: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Vector3(r, g, b) },
      uFrost: { value: frost },
      uGradient: { value: gradient },
      uAngle: { value: angle },
      uEdge: { value: edge },
      uScale: { value: scale },
    };
    // created once; live values pushed in useFrame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const m = matRef.current;
    if (!m) return;
    const size = new THREE.Vector2();
    gl.getDrawingBufferSize(size);
    m.uniforms.uRes.value.copy(size);
    const [r, g, b] = hexToRgb(color);
    m.uniforms.uColor.value.set(r, g, b);
    m.uniforms.uFrost.value = frost;
    m.uniforms.uGradient.value = gradient;
    m.uniforms.uAngle.value = angle;
    m.uniforms.uEdge.value = edge;
    m.uniforms.uScale.value = scale;
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

export default function FrostUmbrella({
  variant = "full",
  color = "#5a7cf0",
  frost = 0.4,
  gradient = 0.6,
  angle = 1.2,
  edge = 0,
  scale = 0.6,
  className = "",
}: FrostUmbrellaProps) {
  return (
    <div
      className={className}
      style={{ width: "100%", height: variant === "full" ? "100dvh" : "100%" }}
    >
      <Canvas
        flat
        linear
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ left: -1, right: 1, top: 1, bottom: -1, near: 0, far: 2, position: [0, 0, 1] }}
      >
        <UmbrellaQuad
          color={color}
          frost={frost}
          gradient={gradient}
          angle={angle}
          edge={edge}
          scale={scale}
        />
      </Canvas>
    </div>
  );
}
