"use client";

import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls, RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import styles from "./KoiScales.module.css";

type KoiScalesProps = {
  variant?: "full" | "embed";
};

// shared light direction so every self-lit material agrees
const LIGHT: [number, number, number] = [0.4, 0.95, 0.55];

// world-space vertex shader shared by all sushi materials
const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
    vec2 u=f*f*(3.0-2.0*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
  float fbm(vec2 p){ float v=0.0,a=0.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){v+=a*noise(p);p=m*p;a*=0.5;} return v; }
`;

// pressed sushi rice: packed individual grains via anisotropic 3D Voronoi.
// each grain is an elongated, randomly-oriented bump; crevices fall into shadow.
const RICE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  uniform vec3 uLight; uniform float uDensity; uniform float uAspect; uniform float uBump;
  ${NOISE}
  vec3 hash3(vec3 p){
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }
  void main(){
    vec3 L = normalize(uLight);
    vec3 V = normalize(cameraPosition - vW);

    vec3 gp = vW * uDensity;
    vec3 ip = floor(gp);
    vec3 fp = fract(gp);
    float bd = 1e9; vec3 bcell = vec3(0.0); vec3 bvec = vec3(0.0);
    for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
    for (int z = -1; z <= 1; z++) {
      vec3 o = vec3(float(x), float(y), float(z));
      vec3 cell = ip + o;
      vec3 pos = o + hash3(cell) - fp;        // vector to the grain centre
      vec3 ax = normalize(hash3(cell + 7.0) - 0.5); // random grain long axis
      float al = dot(pos, ax);
      vec3 st = pos + ax * al * (1.0 / uAspect - 1.0); // stretch -> elongated grain
      float d = length(st);
      if (d < bd) { bd = d; bcell = cell; bvec = pos; }
    }

    float t = smoothstep(0.0, 0.62, bd);        // 0 grain top .. 1 crevice
    vec3 dir = normalize(-bvec + 1e-5);
    vec3 gn = normalize(vN + uBump * dir * smoothstep(0.0, 1.0, t)); // rounded grain normal
    float ao = mix(1.0, 0.9, t);                // very gentle crevice occlusion
    float ch = hash(bcell.xy + vec2(bcell.z * 1.7)); // per-grain tint

    vec3 base = vec3(0.995, 0.992, 0.985) * (0.96 + 0.05 * ch);
    float lam = clamp(dot(gn, L), 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(gn, H), 0.0), 26.0) * 0.5; // wet sticky-rice sheen
    // keep it bright white, with only a hint of shadow in the deepest crevices
    vec3 col = base * (0.86 + 0.2 * lam) * ao + spec * vec3(1.0, 0.99, 0.97);
    col *= mix(0.9, 1.0, smoothstep(0.99, 0.6, t));
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// salmon sashimi: warm coral with marbled white fat lines, wet sheen
const SALMON_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  uniform vec3 uLight; uniform vec3 uSalmon;
  ${NOISE}
  void main(){
    vec3 L = normalize(uLight);
    vec3 V = normalize(cameraPosition - vW);
    float f = fbm(vW.xz * 2.3);
    float stripe = sin(vW.x * 3.4 + f * 4.0) * 0.5 + 0.5;
    float vein = smoothstep(0.78, 0.99, stripe);
    vec3 base = mix(uSalmon, vec3(0.99, 0.93, 0.9), vein * 0.85);
    base = mix(base, base * 1.06, fbm(vW.xz * 6.0) * 0.35);
    float lam = clamp(dot(vN, L), 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(vN, H), 0.0), 44.0) * 0.55;
    vec3 col = base * (0.5 + 0.62 * lam) + spec * vec3(1.0, 0.96, 0.92);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// tobiko: packed glossy iridescent roe beads (the "good" texture, now lit in 3D)
const TOBIKO_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  uniform vec3 uLight; uniform vec3 uTobiko; uniform float uBeads;
  ${NOISE}
  void main(){
    vec3 L = normalize(uLight);
    vec3 V = normalize(cameraPosition - vW);
    // bead grid in top-down world space, brick-offset rows
    vec2 g = vW.xz * uBeads;
    float rowH = 0.62, radius = 0.64;
    float baseRow = floor(g.y / rowH);
    float bestTopY = 1e9, nearD = 1e9; vec2 ownC = vec2(0.0), ownId = vec2(0.0), nearC = vec2(0.0), nearId = vec2(0.0);
    bool hasTop = false;
    for(int ry=-1; ry<=1; ry++){
      float rf = baseRow + float(ry);
      float off = mod(rf,2.0) > 0.5 ? 0.5 : 0.0;
      float yc = (rf+0.5)*rowH;
      for(int cx=-1; cx<=1; cx++){
        float ci = floor(g.x - off + 0.5) + float(cx);
        vec2 c = vec2(ci+off, yc);
        float d = distance(g, c);
        if(d<nearD){nearD=d; nearC=c; nearId=vec2(ci,rf);}
        if(d<radius && c.y<bestTopY){bestTopY=c.y; ownC=c; ownId=vec2(ci,rf); hasTop=true;}
      }
    }
    if(!hasTop){ownC=nearC; ownId=nearId;}
    vec2 lp = g - ownC;
    float rr = length(lp)/radius;
    float h = hash(ownId + 1.7);
    // per-bead bulge tilts the surface normal outward -> bead shading
    vec3 N = normalize(vN + 1.0 * vec3(lp.x, 0.0, lp.y));
    float lam = clamp(dot(N, L), 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 30.0) * 0.9;
    vec3 bead = uTobiko * (0.85 + 0.32 * h);
    float grout = smoothstep(0.78, 1.0, rr);
    vec3 albedo = mix(bead, uTobiko * 0.32, grout);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0,0.33,0.67) + fres*1.2 + h*0.45));
    albedo = mix(albedo, albedo * (0.7 + 0.6 * irid), 0.5 * fres);
    vec3 col = albedo * (0.45 + 0.65 * lam) + spec * vec3(1.0, 0.95, 0.85);
    col += smoothstep(0.45, 0.0, rr) * pow(max(dot(N, H), 0.0), 64.0) * 0.45; // bead glint
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Sushi() {
  const riceUniforms = useMemo(
    () => ({
      uLight: { value: new THREE.Vector3(...LIGHT) },
      uDensity: { value: 10.5 },
      uAspect: { value: 2.2 },
      uBump: { value: 0.6 },
    }),
    []
  );
  const salmonUniforms = useMemo(
    () => ({ uLight: { value: new THREE.Vector3(...LIGHT) }, uSalmon: { value: new THREE.Color("#f2705a") } }),
    []
  );
  const tobikoUniforms = useMemo(
    () => ({
      uLight: { value: new THREE.Vector3(...LIGHT) },
      uTobiko: { value: new THREE.Color("#f2640f") },
      uBeads: { value: 6.0 },
    }),
    []
  );

  return (
    <group position={[0, 0.1, 0]}>
      {/* pressed rice base */}
      <RoundedBox args={[2.5, 0.95, 1.55]} radius={0.42} smoothness={5} position={[0, -0.25, 0]}>
        <shaderMaterial vertexShader={VERT} fragmentShader={RICE_FRAG} uniforms={riceUniforms} />
      </RoundedBox>

      {/* salmon sashimi slab, draped on top with a slight tilt */}
      <RoundedBox
        args={[2.55, 0.26, 1.62]}
        radius={0.1}
        smoothness={4}
        position={[0, 0.32, 0]}
        rotation={[0.05, 0, -0.04]}
      >
        <shaderMaterial vertexShader={VERT} fragmentShader={SALMON_FRAG} uniforms={salmonUniforms} />
      </RoundedBox>

      {/* tobiko quenelle: a small mound of glossy roe on top */}
      <mesh position={[0, 0.55, 0]} scale={[1.05, 0.42, 0.72]}>
        <sphereGeometry args={[0.7, 64, 48]} />
        <shaderMaterial vertexShader={VERT} fragmentShader={TOBIKO_FRAG} uniforms={tobikoUniforms} />
      </mesh>
    </group>
  );
}

export default function KoiScales({ variant = "full" }: KoiScalesProps) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className={`${styles.frame} ${variant === "embed" ? styles.embed : styles.full}`}>
      <Canvas
        className={styles.canvas}
        dpr={[1, 2]}
        camera={{ position: [3.0, 2.4, 4.2], fov: 42 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#ffffff"]} />
        <Sushi />
        <ContactShadows position={[0, -0.78, 0]} opacity={0.32} scale={6} blur={2.4} far={2.5} color="#7a5a3a" />
        <OrbitControls
          enablePan={false}
          minDistance={3}
          maxDistance={9}
          enableDamping
          dampingFactor={0.08}
          autoRotate={!reduced}
          autoRotateSpeed={0.7}
          target={[0, 0.15, 0]}
        />
      </Canvas>
    </div>
  );
}
