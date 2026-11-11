"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HANDS, NEEDLE, SUN } from "./config";
import { needleColour, needleHeight, needleSample } from "./heightmap/needle";
import { motion, sunDirection } from "./lighting/sun";

// The needle as two clock hands: the ruby half (minute hand) and the silver
// half (hour hand), each split at the measured junction and turning about it.
// Each hand is baked once at its rest pose from the same measured needle
// (outline, border, facets, uneven ruby), then drawn as glass over the tile:
// the tile shows through, the facets catch the sun and the sky.

const PX = NEEDLE.pivot[0] - 367.5;
const PY = 367.5 - NEEDLE.pivot[1];
const REST = (NEEDLE.angleDeg * Math.PI) / 180;
const HALF_W = 40;

type Bake = { colour: THREE.DataTexture; normal: THREE.DataTexture };

// Bakes one hand in its own frame: local x runs from the junction to its tip.
function bakeHand(rest: number, red: boolean): Bake {
  const B = HANDS.bake;
  const L = NEEDLE.length + B.pad;
  const x0 = -B.pad;
  const cos = Math.cos(rest);
  const sin = Math.sin(rest);
  const colour = new Uint8Array(B.along * B.across * 4);
  const normal = new Uint8Array(B.along * B.across * 4);
  const px: [number, number, number, number] = [0, 0, 0, 0];
  const e = 0.5;
  for (let j = 0; j < B.across; j++) {
    const ly = ((j + 0.5) / B.across - 0.5) * 2 * HALF_W;
    for (let i = 0; i < B.along; i++) {
      const lx = x0 + ((i + 0.5) / B.along) * (L - x0);
      const x = PX + lx * cos - ly * sin;
      const y = PY + lx * sin + ly * cos;
      const o = (j * B.along + i) * 4;
      const sample = needleSample(x, y);
      const share = red ? sample.red : 1 - sample.red;
      const cover = sample.mask * share;
      if (cover <= 0.002) continue;
      needleColour(x, y, px);
      colour[o] = px[0];
      colour[o + 1] = px[1];
      colour[o + 2] = px[2];
      colour[o + 3] = Math.round(cover * 255);
      const dx = (needleHeight(x + e, y) - needleHeight(x - e, y)) / (2 * e);
      const dy = (needleHeight(x, y + e) - needleHeight(x, y - e)) / (2 * e);
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const nx = -dx / len;
      const ny = -dy / len;
      // into the hand's own frame; the shader turns them back by the mesh's
      // current rotation, so they follow the hand
      normal[o] = Math.round(((nx * cos + ny * sin) * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round(((-nx * sin + ny * cos) * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
    }
  }
  const tex = (data: Uint8Array, cs: THREE.ColorSpace) => {
    const t = new THREE.DataTexture(data, B.along, B.across, THREE.RGBAFormat);
    t.colorSpace = cs;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return { colour: tex(colour, THREE.SRGBColorSpace), normal: tex(normal, THREE.NoColorSpace) };
}

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vRot; // the hand's current rotation (cos, sin), for its normals
void main() {
  vUv = uv;
  vRot = normalize( vec2( modelMatrix[ 0 ][ 0 ], modelMatrix[ 0 ][ 1 ] ) );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uColour;
uniform sampler2D uNormal;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform float uAlpha, uGain, uSpec, uSheen, uFacetBase, uFacetSlope;
varying vec2 vUv;
varying vec2 vRot;
void main() {
  vec4 c = texture2D( uColour, vUv );
  if ( c.a < 0.004 ) discard;
  vec3 ln = texture2D( uNormal, vUv ).xyz * 2.0 - 1.0;
  float cr = vRot.x, sr = vRot.y;
  vec3 n = normalize( vec3( ln.x * cr - ln.y * sr, ln.x * sr + ln.y * cr, max( ln.z, 0.05 ) ) );
  vec3 v = vec3( 0.0, 0.0, 1.0 );
  vec3 h = normalize( uSun + v );
  float lambert = uFacetBase + uFacetSlope * max( dot( n, uSun ), 0.0 );
  float fres = 0.04 + 0.96 * pow( 1.0 - n.z, 5.0 );
  vec3 r = reflect( -v, n );
  vec3 sky = mix( vec3( 0.8, 0.82, 0.82 ), vec3( 1.15, 1.18, 1.24 ), clamp( r.y * 0.5 + 0.5, 0.0, 1.0 ) );
  float spec = pow( max( dot( n, h ), 0.0 ), 140.0 );
  float a = c.a * uAlpha;
  vec3 col = c.rgb * uGain * lambert + ( fres * uSheen * sky + spec * uSpec * uSunCol ) / max( a, 0.3 );
  gl_FragColor = vec4( col, a );
  #include <colorspace_fragment>
}
`;

function Hand({ red }: { red: boolean }) {
  const rest = red ? REST : REST + Math.PI;
  const mesh = useRef<THREE.Mesh>(null);
  const { geometry, material, bake } = useMemo(() => {
    const B = HANDS.bake;
    const L = NEEDLE.length + B.pad;
    const bake = bakeHand(rest, red);
    const geometry = new THREE.PlaneGeometry(L + B.pad, 2 * HALF_W);
    geometry.translate((L - B.pad) / 2, 0, 0);
    const look = red ? HANDS.red : HANDS.silver;
    const sunCol = new THREE.Color(SUN.colour);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColour: { value: bake.colour },
        uNormal: { value: bake.normal },
        uSun: { value: sunDirection },
        uSunCol: { value: new THREE.Vector3(sunCol.r, sunCol.g, sunCol.b) },
        uAlpha: { value: look.alpha },
        uGain: { value: look.gain },
        uSpec: { value: HANDS.specular },
        uSheen: { value: HANDS.sheen },
        uFacetBase: { value: HANDS.facet.base },
        uFacetSlope: { value: HANDS.facet.slope },
      },
    });
    return { geometry, material, bake };
  }, [rest, red]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      bake.colour.dispose();
      bake.normal.dispose();
    },
    [geometry, material, bake],
  );

  useFrame(() => {
    const hand = mesh.current;
    if (hand) hand.rotation.z = rest + (red ? motion.minute : motion.hour);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} position={[PX, PY, HANDS.lift]} rotation={[0, 0, rest]} />;
}

export default function Hands() {
  return (
    <>
      <Hand red={false} />
      <Hand red />
    </>
  );
}
