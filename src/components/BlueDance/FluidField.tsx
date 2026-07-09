"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

// Cursor-reactive dye field: a persistent ping-pong sim advects a scalar
// density along a curl-noise flow (plus mouse drag), diffuses + decays so
// colours seep into one another, then a display pass maps density through a
// warm->cool ramp and a per-channel Bayer dither for the riso speckle.

type Mouse = {
  tx: number; // raw pointer target
  ty: number;
  x: number; // smoothed position
  y: number;
  px: number; // smoothed position last frame
  py: number;
  vx: number;
  vy: number;
  active: boolean;
};

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SIM_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uDt;
  uniform vec2 uMouse;
  uniform vec2 uMousePrev;
  uniform vec2 uVel;
  uniform float uActive;
  in vec2 vUv;
  out vec4 fragColor;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.0; a *= 0.5; }
    return s;
  }
  // divergence-free flow from the curl of a scalar noise potential
  vec2 curl(vec2 p) {
    float e = 0.01;
    float n1 = fbm(p + vec2(0.0, e)), n2 = fbm(p - vec2(0.0, e));
    float n3 = fbm(p + vec2(e, 0.0)), n4 = fbm(p - vec2(e, 0.0));
    return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
  }

  void main() {
    vec2 uv = vUv;
    float ar = uRes.x / uRes.y;

    // distance from this texel to the cursor's path this frame, so fast moves
    // lay a continuous streak instead of gapped splats
    vec2 P = vec2(uv.x * ar, uv.y);
    vec2 A = vec2(uMousePrev.x * ar, uMousePrev.y);
    vec2 B = vec2(uMouse.x * ar, uMouse.y);
    vec2 AB = B - A;
    float segt = clamp(dot(P - A, AB) / max(dot(AB, AB), 1e-6), 0.0, 1.0);
    float ds = distance(P, A + AB * segt);

    // background swirl + a drag pulse spread along the cursor path
    vec2 flow = curl(vec2(uv.x * ar, uv.y) * 2.5 + uTime * 0.03) * 0.9;
    float near = exp(-ds * ds / 0.02);
    flow += uVel * near * 7.0;

    // advect the density backward along the flow (units back to uv space)
    vec2 src = uv - (flow / vec2(ar, 1.0)) * uDt;
    float d = texture(uPrev, src).r;

    // diffuse toward the local average so bands bleed together
    vec2 px = 1.0 / uRes;
    float nb =
      texture(uPrev, src + vec2(px.x, 0.0)).r +
      texture(uPrev, src - vec2(px.x, 0.0)).r +
      texture(uPrev, src + vec2(0.0, px.y)).r +
      texture(uPrev, src - vec2(0.0, px.y)).r;
    d = mix(d, nb * 0.25, 0.12);

    // decay
    d *= 0.988;

    // inject dye along the cursor path, stronger while moving fast
    float splat = exp(-ds * ds / 0.0009) * uActive;
    d += splat * (0.55 + length(uVel) * 5.0);

    d = clamp(d, 0.0, 1.5);
    fragColor = vec4(d, 0.0, 0.0, 1.0);
  }
`;

const DISP_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uField;
  uniform vec2 uRes;
  uniform float uPixel;
  uniform vec2 uMouse;
  uniform float uActive;
  uniform float uPalette;
  in vec2 vUv;
  out vec4 fragColor;

  const float bayer[16] = float[](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );

  // uPalette 0 = cool (blue field + warm hot core, complements the wheel)
  // uPalette 1 = thermal (original full-spectrum rainbow)
  vec3 palette(float t) {
    t = clamp(t, 0.0, 1.0);
    if (uPalette < 0.5) {
      vec3 c0 = vec3(1.0, 1.0, 1.0);
      vec3 c1 = vec3(0.60, 0.66, 0.98);
      vec3 c2 = vec3(0.13, 0.23, 0.80);
      vec3 c3 = vec3(0.07, 0.12, 0.52);
      vec3 c4 = vec3(1.0, 0.55, 0.10);
      vec3 c5 = vec3(0.98, 0.88, 0.45);
      if (t < 0.14) return mix(c0, c1, t / 0.14);
      if (t < 0.40) return mix(c1, c2, (t - 0.14) / 0.26);
      if (t < 0.66) return mix(c2, c3, (t - 0.40) / 0.26);
      if (t < 0.85) return mix(c3, c4, (t - 0.66) / 0.19);
      return mix(c4, c5, (t - 0.85) / 0.15);
    } else {
      vec3 c0 = vec3(1.0, 1.0, 1.0);
      vec3 c1 = vec3(0.294, 0.388, 0.909);
      vec3 c2 = vec3(1.0, 0.176, 0.176);
      vec3 c3 = vec3(1.0, 0.541, 0.0);
      vec3 c4 = vec3(1.0, 0.824, 0.118);
      vec3 c5 = vec3(0.765, 0.933, 0.184);
      if (t < 0.10) return mix(c0, c1, t / 0.10);
      if (t < 0.30) return mix(c1, c2, (t - 0.10) / 0.20);
      if (t < 0.55) return mix(c2, c3, (t - 0.30) / 0.25);
      if (t < 0.78) return mix(c3, c4, (t - 0.55) / 0.23);
      return mix(c4, c5, (t - 0.78) / 0.22);
    }
  }

  void main() {
    vec2 cell = floor(gl_FragCoord.xy / uPixel);
    vec2 uv = (cell + 0.5) * uPixel / uRes;

    float d = texture(uField, uv).r;
    vec3 col = palette(d);

    int bx = int(mod(cell.x, 4.0));
    int by = int(mod(cell.y, 4.0));
    float thr = (bayer[by * 4 + bx] + 0.5) / 16.0 - 0.5;
    vec3 q = clamp(floor(col + thr + 0.5), 0.0, 1.0);

    // crisp cursor target on top
    float ar = uRes.x / uRes.y;
    vec2 fuv = gl_FragCoord.xy / uRes;
    float md = distance(vec2(fuv.x * ar, fuv.y), vec2(uMouse.x * ar, uMouse.y));
    float ring = smoothstep(0.011, 0.009, abs(md - 0.018)) * uActive;
    float core = smoothstep(0.007, 0.004, md) * uActive;
    q = mix(q, vec3(0.05), ring);
    q = mix(q, vec3(1.0, 0.85, 0.1), core);

    fragColor = vec4(q, 1.0);
  }
`;

type SimBundle = {
  scene: THREE.Scene;
  cam: THREE.OrthographicCamera;
  mat: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
};

function Field({
  mouseRef,
  palette,
}: {
  mouseRef: React.MutableRefObject<Mouse>;
  palette: "cool" | "thermal";
}) {
  const { gl, size } = useThree();

  const simW = Math.max(2, Math.floor(size.width * 0.5));
  const simH = Math.max(2, Math.floor(size.height * 0.5));

  const [rtA, rtB] = useMemo(() => {
    const opt = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    return [
      new THREE.WebGLRenderTarget(simW, simH, opt),
      new THREE.WebGLRenderTarget(simW, simH, opt),
    ];
  }, [simW, simH]);
  useEffect(() => () => { rtA.dispose(); rtB.dispose(); }, [rtA, rtB]);

  // mutable three objects live in a ref so per-frame mutation is allowed
  const simRef = useRef<SimBundle | null>(null);
  if (simRef.current === null) {
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: SIM_FRAG,
      uniforms: {
        uPrev: { value: null as THREE.Texture | null },
        uRes: { value: new THREE.Vector2(simW, simH) },
        uTime: { value: 0 },
        uDt: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uMousePrev: { value: new THREE.Vector2(0.5, 0.5) },
        uVel: { value: new THREE.Vector2() },
        uActive: { value: 0 },
      },
    });
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    scene.add(mesh);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    simRef.current = { scene, cam, mat, mesh };
  }
  useEffect(() => {
    const s = simRef.current;
    return () => {
      s?.mesh.geometry.dispose();
      s?.mat.dispose();
    };
  }, []);

  const dispMat = useRef<THREE.ShaderMaterial>(null);
  const ping = useRef({ read: rtA, write: rtB });
  useEffect(() => {
    ping.current = { read: rtA, write: rtB };
  }, [rtA, rtB]);

  const dispUniforms = useMemo(
    () => ({
      uField: { value: null as THREE.Texture | null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uPixel: { value: 6 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uActive: { value: 0 },
      uPalette: { value: 0 },
    }),
    []
  );

  useFrame((_, dt) => {
    const sim = simRef.current;
    if (!sim) return;
    const m = mouseRef.current;

    // exponential smoothing toward the raw pointer target (frame-rate safe),
    // so both the injected position and the cursor ring glide instead of snap
    const k = 1 - Math.exp(-dt * 14);
    const nx = m.x + (m.tx - m.x) * k;
    const ny = m.y + (m.ty - m.y) * k;
    // smoothed per-frame velocity for a continuous drag
    m.vx += (nx - m.x - m.vx) * 0.35;
    m.vy += (ny - m.y - m.vy) * 0.35;
    m.px = m.x;
    m.py = m.y;
    m.x = nx;
    m.y = ny;

    const u = sim.mat.uniforms;
    u.uRes.value.set(simW, simH);
    u.uTime.value += dt;
    u.uDt.value = Math.min(dt, 0.033);
    u.uMouse.value.set(m.x, m.y);
    u.uMousePrev.value.set(m.px, m.py);
    u.uVel.value.set(m.vx, m.vy);
    u.uActive.value = m.active ? 1 : 0;
    u.uPrev.value = ping.current.read.texture;

    gl.setRenderTarget(ping.current.write);
    gl.render(sim.scene, sim.cam);
    gl.setRenderTarget(null);

    const t = ping.current.read;
    ping.current.read = ping.current.write;
    ping.current.write = t;

    if (dispMat.current) {
      // gl_FragCoord is in device pixels, so uRes must be too (CSS * dpr),
      // otherwise the cursor/field only map into a 1/dpr corner of the screen
      const dpr = gl.getPixelRatio();
      dispMat.current.uniforms.uField.value = ping.current.read.texture;
      dispMat.current.uniforms.uRes.value.set(size.width * dpr, size.height * dpr);
      dispMat.current.uniforms.uMouse.value.set(m.x, m.y);
      dispMat.current.uniforms.uActive.value = m.active ? 1 : 0;
      dispMat.current.uniforms.uPalette.value = palette === "thermal" ? 1 : 0;
    }
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={dispMat}
        glslVersion={THREE.GLSL3}
        vertexShader={VERT}
        fragmentShader={DISP_FRAG}
        uniforms={dispUniforms}
      />
    </mesh>
  );
}

export default function FluidField({
  palette = "cool",
}: {
  palette?: "cool" | "thermal";
}) {
  const mouse = useRef<Mouse>({
    tx: 0.5,
    ty: 0.5,
    x: 0.5,
    y: 0.5,
    px: 0.5,
    py: 0.5,
    vx: 0,
    vy: 0,
    active: false,
  });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mouse.current.tx = e.clientX / window.innerWidth;
      mouse.current.ty = 1 - e.clientY / window.innerHeight;
      mouse.current.active = true;
    };
    const onLeave = () => {
      mouse.current.active = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: false }}
        camera={{ left: -1, right: 1, top: 1, bottom: -1, near: 0, far: 2, position: [0, 0, 1] }}
      >
        <Field mouseRef={mouse} palette={palette} />
      </Canvas>
    </div>
  );
}
