"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { useMemo, useRef, type PointerEvent } from "react";
import * as THREE from "three";

/**
 * PoolPostcard - a top-down calm swimming pool rendered as a live water shader,
 * framed like a postcard you can tilt in 3D by hovering.
 *
 * The water is physically motivated (see the research baked into the shader):
 *  - surface = sum-of-sines height field with per-wave speed from the deep-water
 *    gravity-capillary dispersion relation, so ripples of different sizes churn
 *    against each other instead of sliding as one sheet;
 *  - caustics = analytic 1/|det(I + c*Hessian(h))| (the true fold locus of light
 *    refracted onto the floor), with chromatic dispersion and an fwidth() pole
 *    clamp for anti-aliasing;
 *  - refraction = floor image displaced by (1 - 1/n)*depth*grad(h);
 *  - colour = Beer-Lambert per-channel absorption (subtle cyan, not ocean-blue);
 *  - reflection = Schlick Fresnel with F0 = 0.02 (near-normal, so mostly floor);
 *  - glitter = high-exponent specular on a fast detail normal, twinkle-gated.
 */

type PoolPostcardProps = {
  frost?: number;
  variant?: "full" | "embed";
  /** water depth in metres - drives caustic focus, refraction and tint */
  depth?: number;
  /** surface agitation, ~0.5 glassy .. ~1.6 breezy */
  chop?: number;
  /** water absorption / tint strength, 0 clear .. ~1.5 deep cyan */
  tint?: number;
  /** sun azimuth in radians (direction the glints lean) */
  sun?: number;
  className?: string;
};

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec2  uRes;
  uniform float uTime;
  uniform float uDepth;
  uniform float uChop;
  uniform float uTint;
  uniform float uSun;
  uniform vec2  uMouse;   // -1..1, parallax of the view ray (from hover)
  uniform float uHover;   // 0..1
  uniform float uFrost;   // 0 crisp .. ~1.5 heavily frosted
  uniform int   uQuality; // 1 = full, 0 = embed
  in vec2 vUv;
  out vec4 fragColor;

  const float PI = 3.14159265;
  const float IOR = 1.333;

  // ---- noise (Hoskins sine-less hash; portable) ----
  float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
    float a=hash12(i),                 b=hash12(i+vec2(1.0,0.0));
    float c=hash12(i+vec2(0.0,1.0)),   d=hash12(i+vec2(1.0,1.0));
    return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
  }
  float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }

  float sdRoundBox(vec2 p, vec2 b, float r){
    vec2 q=abs(p)-b+r; return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r;
  }

  // pale plaster floor with a soft, faint tile grid (kept low-contrast so the
  // frosted blur below reads as etched glass, not sharp lines)
  vec3 floorTex(vec2 q){
    vec3 pl=vec3(0.66,0.90,0.90);
    vec2 g=abs(fract(q/1.6)-0.5);
    float gr=smoothstep(0.07,0.0,min(g.x,g.y));
    return pl*(1.0-0.035*gr);
  }

  // ---- water surface: sum of sines, speed from dispersion ----
  // fills height gradient (for normals + refraction) and the Hessian (for caustics)
  void water(vec2 p, float t, float chop,
             out vec2 grad, out float hxx, out float hyy, out float hxy){
    grad=vec2(0.0); hxx=0.0; hyy=0.0; hxy=0.0;
    const float g=9.81, sig=7.28e-5;
    // wavelength(m), amplitude(m), direction(rad) - calm pool: long, flat waves
    float Ls[6]=float[6](2.10, 1.25, 0.66, 0.38, 0.23, 0.145);
    float As[6]=float[6](0.011,0.0085,0.0052,0.0032,0.0016,0.0009);
    float Ang[6]=float[6](0.35, 1.95, -0.65, 2.55, 1.15, -2.25);
    for(int i=0;i<6;i++){
      float L=Ls[i];
      float k=6.2831853/L;
      vec2  dir=vec2(cos(Ang[i]),sin(Ang[i]));
      vec2  K=dir*k;
      float w=sqrt(g*k + sig*k*k*k);          // deep-water gravity-capillary
      float th=dot(K,p) - w*t + float(i)*1.7;
      float s=sin(th), c=cos(th);
      float A=As[i]*chop;
      grad += A*K*c;
      hxx  -= A*K.x*K.x*s;
      hyy  -= A*K.y*K.y*s;
      hxy  -= A*K.x*K.y*s;
    }
  }

  void main(){
    float aspect = uRes.x/uRes.y;
    vec2  ap = vec2(aspect,1.0);
    vec2  P  = (vUv-0.5)*ap;            // aspect-correct card space
    float px = 1.5/uRes.y;             // ~1px in P units

    // ---- pool / deck layout ----
    vec2  halfPool = 0.5*ap - vec2(0.085, 0.072);
    float dPool = sdRoundBox(P, halfPool, 0.03);   // <0 inside water
    vec2  poolMin = -halfPool, poolMax = halfPool;

    // world (metres): map pool interior to a ~13m x 9m basin
    float worldScale = 9.0;
    vec2  mp = P * worldScale;
    float t  = uTime;

    // surface field
    vec2  grad; float hxx,hyy,hxy;
    water(mp, t, uChop, grad, hxx, hyy, hxy);
    vec3  N = normalize(vec3(-grad, 1.0));

    // ---- pool floor: steps in the bottom-right corner ----
    vec2 corner = vec2(poolMax.x, poolMin.y);       // right + bottom
    float rr = length(P - corner);
    float onSteps = smoothstep(0.34, 0.30, rr) * step(0.0, corner.x - P.x) * step(0.0, P.y - corner.y);
    float stepBand = rr / 0.34;
    float depthFactor = mix(0.16, 1.0, clamp(stepBand,0.0,1.0));   // shallow at the top step
    depthFactor = mix(1.0, depthFactor, onSteps);
    float stepEdge = smoothstep(0.012, 0.0, abs(fract(rr/0.085)-0.5)/ (1.0/0.085) ) ; // faint step nosings
    float localDepth = uDepth * depthFactor;

    // ---- caustics: 1/|det(I + c*H)| with chromatic dispersion ----
    float c0  = (1.0 - 1.0/IOR) * localDepth;
    vec3  cch = c0 * mix(vec3(1.0), vec3(0.99549,1.0,1.00899), 2.4);   // exaggerate chroma ~2.4x
    float dR=(1.0+cch.r*hxx)*(1.0+cch.r*hyy)-cch.r*cch.r*hxy*hxy;
    float dG=(1.0+cch.g*hxx)*(1.0+cch.g*hyy)-cch.g*cch.g*hxy*hxy;
    float dB=(1.0+cch.b*hxx)*(1.0+cch.b*hyy)-cch.b*cch.b*hxy*hxy;
    float aaC = 0.9*fwidth(dG) + 0.02 + 0.06*uFrost;   // wider epsilon -> softer, frosted net
    vec3  caus = vec3(1.0/(abs(dR)+aaC), 1.0/(abs(dG)+aaC), 1.0/(abs(dB)+aaC));
    caus = max(caus-1.0, 0.0);                          // baseline ~1 -> keep only the net
    caus = caus/(caus+2.5);                             // soft knee -> low-contrast, diffuse

    // ---- frosted refracted floor image ----
    // refract the view ray by the surface slope, then treat the surface like
    // etched/frosted glass: average several jittered taps so the floor is softly
    // diffused, blurring MORE where the surface is steeper (that slope-driven
    // scatter is what reads as textured "frosted" water rather than a mirror).
    vec2  rp = mp + grad * (c0 * 1.6);                  // (1-1/n)*depth*grad
    float blur = (0.012 + length(grad)*0.85) * (0.45 + 1.1*uFrost);
    vec3  floorAlb  = floorTex(rp) * 0.36;
    floorAlb += floorTex(rp + vec2( blur,  blur*0.6)) * 0.16;
    floorAlb += floorTex(rp + vec2(-blur, -blur*0.6)) * 0.16;
    floorAlb += floorTex(rp + vec2( blur*0.6, -blur)) * 0.16;
    floorAlb += floorTex(rp + vec2(-blur*0.6,  blur)) * 0.16;
    floorAlb = mix(floorAlb, vec3(0.93,0.97,0.97), onSteps*0.8);   // white steps
    floorAlb *= 1.0 - stepEdge*onSteps*0.15;

    vec3  water = floorAlb;
    water += caus * (0.35 + 0.6*floorAlb);             // caustic light on the floor

    // Beer-Lambert absorption over the 2*depth round trip (subtle cyan)
    vec3  absorb = vec3(0.276,0.047,0.0098) * (0.9*uTint);
    water *= exp(-absorb * 2.0 * localDepth);
    // colour the shadows toward pool turquoise with depth
    vec3  deepCol = vec3(0.10, 0.55, 0.62);
    water = mix(water, deepCol, clamp(uTint*0.30*depthFactor,0.0,0.6));

    // ---- reflection (Schlick, F0=0.02) + sky sheen ----
    vec3  V = normalize(vec3(uMouse*0.28, 1.0));
    float cosT = clamp(dot(N,V),0.0,1.0);
    float F = 0.02 + 0.98*pow(1.0-cosT,5.0);
    vec3  sky = mix(vec3(0.78,0.90,0.98), vec3(0.55,0.76,0.95), vUv.y);
    water = mix(water, sky, F*0.6);

    // ---- sun glitter: fast detail normal, high exponent, twinkle-gated ----
    vec3  Ldir = normalize(vec3(cos(uSun),sin(uSun),0.85));
    vec3  H = normalize(Ldir+V);
    vec2  dN = vec2(0.0);
    if(uQuality==1){
      float e=0.02;
      float n0=fbm(mp*4.0 + t*0.25);
      float nx=fbm((mp+vec2(e,0.0))*4.0 + t*0.25);
      float ny=fbm((mp+vec2(0.0,e))*4.0 + t*0.25);
      dN = (vec2(nx,ny)-n0)/e * 0.03;
    }
    vec3  Ng = normalize(N + vec3(dN,0.0));
    float spec = pow(max(dot(Ng,H),0.0), 380.0);       // broader, softer highlight
    float twinkle = smoothstep(0.45,0.98, fbm(mp*2.2 - t*0.35));
    water += spec * twinkle * vec3(1.0,0.99,0.94) * 1.1;

    // frosted wash: a faint milky, low-frequency veil like looking through
    // rippled/etched glass - softens the whole surface without hiding the pattern
    float haze = fbm(mp*1.7 + t*0.04);
    water = mix(water, vec3(0.86,0.95,0.96), clamp((haze-0.4)*0.5,0.0,1.0)*0.16*uFrost);

    // ---- floating pineapple ring ----
    vec2  fc = vec2(-0.06, 0.10);
    fc.y += 0.012*sin(t*0.7);
    fc.x += 0.010*cos(t*0.5);
    float fr = length(P - fc);
    float ringR=0.072, ringW=0.030;
    // soft shadow cast on the water floor (offset with the sun)
    float shd = smoothstep(ringR+0.05, ringR-0.02, length(P-(fc-vec2(0.02,0.03))));
    water *= 1.0 - 0.22*shd*(1.0-smoothstep(ringW,ringW+0.02,abs(fr-ringR)))*0.0 - 0.16*shd;
    // bright refracted caustic halo hugging the ring
    water += vec3(0.9,1.0,1.0) * smoothstep(0.02,0.0,abs(fr-ringR-0.02)) * 0.25;

    float ringM = smoothstep(ringW+px, ringW-px, abs(fr-ringR));
    vec3  ringCol = mix(vec3(1.0,0.82,0.12), vec3(1.0,0.93,0.5),
                        0.5+0.5*dot(normalize(P-fc+1e-4), vec2(-0.5,0.7)));
    ringCol *= 0.85 + 0.3*smoothstep(ringW,0.0,abs(fr-ringR)); // rounded tube shading
    // leaves at the top (pineapple crown)
    vec2 lp = P - (fc+vec2(0.0,ringR+0.006));
    float leaves = smoothstep(0.030, 0.0, length(lp*vec2(1.3,0.7))) *
                   step(0.0, lp.y);
    vec3 outWater = mix(water, ringCol, ringM);
    outWater = mix(outWater, vec3(0.30,0.72,0.30), leaves*(1.0-ringM));

    // waterline tile band just inside the pool edge (glossy teal)
    float tile = smoothstep(0.0, -0.018, dPool) * smoothstep(-0.034,-0.018,dPool);
    outWater = mix(outWater, vec3(0.16,0.52,0.58)*(0.9+0.3*caus.g), tile*0.85);

    // ---- deck (travertine) + coping ----
    float m1=fbm(vUv*13.0), m2=fbm(vUv*45.0+7.0);
    vec3  deck = mix(vec3(0.87,0.81,0.72), vec3(0.79,0.71,0.61), m1);
    deck = mix(deck, vec3(0.72,0.64,0.55), smoothstep(0.6,0.85,m2)*0.5);
    vec2  pav = abs(fract(vUv*vec2(6.0,4.0))-0.5);
    float paver = smoothstep(0.03,0.0,min(pav.x,pav.y));
    deck *= 1.0 - 0.10*paver;
    vec3  coping = vec3(0.91,0.87,0.80);

    // sun loungers along the top deck
    vec3 deckCol = deck;
    {
      float topDeck = smoothstep(halfPool.y, halfPool.y+0.005, P.y);
      for(int i=0;i<3;i++){
        float cx = -0.30 + float(i)*0.30;
        vec2 lq = (P-vec2(cx, halfPool.y+0.045));
        float body = step(abs(lq.x),0.085)*step(abs(lq.y),0.028);
        float stripe = step(0.5, fract(lq.x*22.0));
        vec3 lc = mix(vec3(0.12,0.13,0.16), vec3(0.95,0.95,0.95), stripe);
        deckCol = mix(deckCol, lc, body*topDeck);
      }
    }

    // ---- composite deck -> coping -> water ----
    vec3 col = deckCol;
    col = mix(col, coping, smoothstep(0.012, -0.002, dPool));
    col = mix(col, outWater, smoothstep(px, -px, dPool));

    // subtle grade + vignette
    col *= 1.0 - 0.18*pow(length((vUv-0.5)*vec2(1.0,1.15)),2.5);
    col = pow(col, vec3(0.95));

    fragColor = vec4(col, 1.0);
  }
`;

type UniformShape = {
  uRes: { value: THREE.Vector2 };
  uTime: { value: number };
  uDepth: { value: number };
  uChop: { value: number };
  uTint: { value: number };
  uSun: { value: number };
  uMouse: { value: THREE.Vector2 };
  uHover: { value: number };
  uFrost: { value: number };
  uQuality: { value: number };
};

function PoolQuad({
  depth,
  chop,
  tint,
  sun,
  frost,
  quality,
  pointer,
}: {
  depth: number;
  chop: number;
  tint: number;
  sun: number;
  frost: number;
  quality: number;
  pointer: React.MutableRefObject<{ x: number; y: number; hover: number }>;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();

  const uniforms = useMemo<UniformShape>(
    () => ({
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDepth: { value: depth },
      uChop: { value: chop },
      uTint: { value: tint },
      uFrost: { value: frost },
      uSun: { value: sun },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uHover: { value: 0 },
      uQuality: { value: quality },
    }),
    // created once; live values pushed in useFrame
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useFrame((state) => {
    const m = matRef.current;
    if (!m) return;
    const size = new THREE.Vector2();
    gl.getDrawingBufferSize(size);
    m.uniforms.uRes.value.copy(size);
    m.uniforms.uTime.value = state.clock.elapsedTime;
    m.uniforms.uDepth.value = depth;
    m.uniforms.uChop.value = chop;
    m.uniforms.uTint.value = tint;
    m.uniforms.uSun.value = sun;
    m.uniforms.uQuality.value = quality;
    const p = pointer.current;
    const mv = m.uniforms.uMouse.value;
    mv.x += (p.x - mv.x) * 0.08;
    mv.y += (p.y - mv.y) * 0.08;
    m.uniforms.uHover.value += (p.hover - m.uniforms.uHover.value) * 0.08;
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

export default function PoolPostcard({
  variant = "full",
  depth = 1.5,
  chop = 1.0,
  tint = 1.0,
  sun = 0.9,
  frost = 0.6,
  className = "",
}: PoolPostcardProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0, hover: 0 });

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const active = useMotionValue(0);
  const spring = { stiffness: 200, damping: 24, mass: 0.6 };
  const rxS = useSpring(rx, spring);
  const ryS = useSpring(ry, spring);
  const activeS = useSpring(active, { stiffness: 170, damping: 22 });
  const maxTilt = variant === "embed" ? 8 : 13;
  const scaleV = useTransform(activeS, [0, 1], [1, 1.035]);
  const shadowV = useTransform(
    activeS,
    [0, 1],
    [
      "0 18px 40px -26px rgba(20,60,70,0.5)",
      "0 40px 70px -30px rgba(20,60,70,0.6)",
    ]
  );

  function handleMove(e: PointerEvent<HTMLDivElement>) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 2 * maxTilt);
    rx.set(-(py - 0.5) * 2 * maxTilt);
    active.set(1);
    pointer.current.x = (px - 0.5) * 2;
    pointer.current.y = -(py - 0.5) * 2;
    pointer.current.hover = 1;
  }
  function handleLeave() {
    rx.set(0);
    ry.set(0);
    active.set(0);
    pointer.current.x = 0;
    pointer.current.y = 0;
    pointer.current.hover = 0;
  }

  const quality = variant === "embed" ? 0 : 1;

  return (
    <div
      className={`flex items-center justify-center ${className}`}
      style={{
        width: "100%",
        height: variant === "full" ? "100dvh" : "100%",
        perspective: 1200,
      }}
    >
      <motion.div
        ref={wrapRef}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        style={{
          rotateX: rxS,
          rotateY: ryS,
          scale: scaleV,
          boxShadow: shadowV,
          transformStyle: "preserve-3d",
          width: "min(78vw, 78vh * 1.5, 900px)",
          aspectRatio: "1.5 / 1",
          borderRadius: 14,
          overflow: "hidden",
          cursor: "grab",
          background: "#dfeceb",
          border: "8px solid #fbf7f1",
        }}
      >
        <Canvas
          flat
          linear
          orthographic
          dpr={[1, 2]}
          gl={{ antialias: true }}
          camera={{
            left: -1,
            right: 1,
            top: 1,
            bottom: -1,
            near: 0,
            far: 2,
            position: [0, 0, 1],
          }}
        >
          <PoolQuad
            depth={depth}
            chop={chop}
            tint={tint}
            sun={sun}
            frost={frost}
            quality={quality}
            pointer={pointer}
          />
        </Canvas>
      </motion.div>
    </div>
  );
}
