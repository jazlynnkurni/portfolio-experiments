"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import styles from "./ScrollGallery.module.css";

type ScrollGalleryProps = {
  variant?: "full" | "embed";
};

type Panel = { w: number; h: number; a: string; b: string; label: string };

// Placeholder art pieces (no real gallery assets exist). Mixed portrait / wide.
const PANELS: Panel[] = [
  { w: 300, h: 420, a: "#ff5e7e", b: "#7a2bff", label: "01" },
  { w: 560, h: 360, a: "#23d5ab", b: "#23a6d5", label: "02" },
  { w: 320, h: 460, a: "#f7b733", b: "#fc4a1a", label: "03" },
  { w: 360, h: 400, a: "#00c6ff", b: "#0072ff", label: "04" },
  { w: 600, h: 340, a: "#a18cd1", b: "#fbc2eb", label: "05" },
  { w: 320, h: 470, a: "#16a085", b: "#f4d03f", label: "06" },
  { w: 340, h: 420, a: "#ee0979", b: "#ff6a00", label: "07" },
];

const GAP = 64;
const PAD = 0.12; // track side padding as a fraction of viewport width
const LERP = 0.09;

const trackWidth = (vw: number) =>
  2 * PAD * vw + PANELS.reduce((s, p) => s + p.w, 0) + (PANELS.length - 1) * GAP;

// panel centre in track-local px (0 = track left edge)
function panelCentres(vw: number) {
  const out: number[] = [];
  let cum = PAD * vw;
  for (const p of PANELS) {
    out.push(cum + p.w / 2);
    cum += p.w + GAP;
  }
  return out;
}

const gradVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const gradFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uA;
  uniform vec3 uB;
  void main() {
    float t = clamp((vUv.x + (1.0 - vUv.y)) * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(uA, uB, t), 1.0);
  }
`;

// fullscreen quad straight to clip space
const postVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// edge-localized vertical liquid strands + prismatic split + alpha fade
const postFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform float uVel;   // px/frame, signed
  uniform vec2 uRes;

  float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    // edge weight: zero in the centre, ramps up sharply only near the far sides
    float d = abs(uv.x - 0.5) * 2.0;        // 0 centre, 1 at edges
    float w = smoothstep(0.6, 1.0, d);
    float vel = clamp(abs(uVel) / 26.0, 0.0, 1.0);
    float s = w * (0.30 + 0.70 * vel);       // intensity: edge AND velocity
    float dir = sign(uv.x - 0.5);            // +1 right side, -1 left side
    float trail = -sign(uVel + 0.0001);      // strands trail behind scroll

    // thin vertical strands: a per-column random id
    float colN = hash(floor(uv.x * uRes.x / 2.5));
    // horizontal pull toward the edge, wobbling per strand
    float pullX = s * (0.04 + 0.045 * colN) * dir;
    // vertical stretch so content elongates into downward filaments, trailing
    float stretchY = s * (0.035 + 0.12 * colN);
    vec2 sUv = vec2(uv.x + pullX, uv.y + trail * stretchY);

    // prismatic RGB split: separation widens toward edge and with velocity
    float chroma = s * (0.005 + 0.016 * vel) * (0.6 + 0.4 * colN);
    float r = texture2D(uScene, vec2(sUv.x + chroma, sUv.y)).r;
    vec4 gc = texture2D(uScene, sUv);
    float b = texture2D(uScene, vec2(sUv.x - chroma, sUv.y)).b;
    float a = gc.a;

    // fade the strands to transparent toward their tips
    float fade = 1.0 - s * 0.9 * smoothstep(0.0, 1.0, stretchY * 1.7 + (1.0 - colN) * 0.25);
    fade = clamp(fade, 0.0, 1.0);

    gl_FragColor = vec4(r, gc.g, b, a * fade);
  }
`;

function GalleryFX({ scroll }: { scroll: React.MutableRefObject<{ target: number }> }) {
  const { gl, size } = useThree();
  const vw = size.width;
  const vh = size.height;

  const galleryScene = useMemo(() => new THREE.Scene(), []);
  const galleryCam = useMemo(() => {
    const c = new THREE.OrthographicCamera(-vw / 2, vw / 2, vh / 2, -vh / 2, -100, 100);
    c.position.z = 10;
    return c;
  }, [vw, vh]);

  const fbo = useFBO(Math.max(2, Math.floor(vw)), Math.max(2, Math.floor(vh)));
  const groupRef = useRef<THREE.Group>(null);
  const postRef = useRef<THREE.ShaderMaterial>(null);
  const cur = useRef(0);
  const prev = useRef(0);

  const centres = useMemo(() => panelCentres(vw), [vw]);
  const postUniforms = useMemo(
    () => ({
      uScene: { value: null as THREE.Texture | null },
      uVel: { value: 0 },
      uRes: { value: new THREE.Vector2(vw, vh) },
    }),
    [vw, vh]
  );

  useFrame(() => {
    cur.current += (scroll.current.target - cur.current) * LERP;
    const vel = cur.current - prev.current;
    prev.current = cur.current;
    if (groupRef.current) groupRef.current.position.x = cur.current;

    // render the gallery to the FBO (transparent background)
    const prevTarget = gl.getRenderTarget();
    gl.setRenderTarget(fbo);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(galleryScene, galleryCam);
    gl.setRenderTarget(prevTarget);

    if (postRef.current) {
      postRef.current.uniforms.uScene.value = fbo.texture;
      postRef.current.uniforms.uVel.value = vel;
    }
  });

  return (
    <>
      {createPortal(
        <group ref={groupRef}>
          {PANELS.map((p, i) => (
            <mesh key={i} position={[centres[i] - vw / 2, 0, 0]}>
              <planeGeometry args={[p.w, p.h]} />
              <shaderMaterial
                vertexShader={gradVert}
                fragmentShader={gradFrag}
                uniforms={{
                  uA: { value: new THREE.Color(p.a) },
                  uB: { value: new THREE.Color(p.b) },
                }}
              />
            </mesh>
          ))}
        </group>,
        galleryScene
      )}

      <mesh>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial
          ref={postRef}
          vertexShader={postVert}
          fragmentShader={postFrag}
          uniforms={postUniforms}
          transparent
        />
      </mesh>
    </>
  );
}

export default function ScrollGallery({ variant = "full" }: ScrollGalleryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const scroll = useRef({ target: 0 });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reduced || variant === "embed") return;
    const pin = pinRef.current;
    if (!pin) return;
    gsap.registerPlugin(ScrollTrigger);
    const distanceOf = () => Math.max(0, trackWidth(pin.clientWidth) - pin.clientWidth);

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: rootRef.current,
        start: "top top",
        end: () => "+=" + distanceOf(),
        pin: pin,
        scrub: true,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          scroll.current.target = -self.progress * distanceOf();
        },
      });
    }, rootRef);

    return () => ctx.revert();
  }, [reduced, variant]);

  if (reduced || variant === "embed") {
    return (
      <div className={`${styles.root} ${styles.fallbackRoot}`}>
        <div className={styles.fallbackRow}>
          {PANELS.map((p, i) => (
            <div
              key={i}
              className={styles.panel}
              style={{
                width: p.w,
                height: p.h,
                background: `linear-gradient(135deg, ${p.a}, ${p.b})`,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <div ref={pinRef} className={styles.viewport}>
        <Canvas
          className={styles.canvas}
          orthographic
          gl={{ alpha: true, antialias: true }}
          dpr={[1, 2]}
        >
          <GalleryFX scroll={scroll} />
        </Canvas>
        <p className={styles.hint}>scroll down</p>
      </div>
    </div>
  );
}
