"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BACKDROP, GLASS, SUN, TILE } from "../config";
import { fbm } from "../heightmap/noise";
import { boundaryRadius } from "../heightmap/silhouette";
import { boxBlur } from "../materials/roughness";
import { motionUniforms, sunDirection } from "./sun";

const srgb = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

// Soft neutral sunlit surface: broad light and shade plus a gentle
// out-of-focus grain. Low in colour; the glass supplies the green.
function backdropTexture(): THREE.DataTexture {
  const B = BACKDROP;
  const res = B.res;
  const base = srgb(B.base);
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const y = ((j + 0.5) / res - 0.5) * TILE.size;
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * TILE.size;
      const light =
        1 +
        B.dapple.amount * fbm(x / B.dapple.scale, y / B.dapple.scale, 3, B.dapple.seed) +
        B.grain.amount * fbm(x / B.grain.scale, y / B.grain.scale, 2, B.grain.seed);
      const o = (j * res + i) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round(base[c] * light)));
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Half-float copy of the relief (px), halved and softly blurred, for the
// caustic trace and the cast shadows.
export function heightTexture(height: Float32Array, res: number): THREE.DataTexture {
  const half = res >> 1;
  const small = new Float32Array(half * half);
  for (let j = 0; j < half; j++) {
    for (let i = 0; i < half; i++) {
      const a = 2 * j * res + 2 * i;
      small[j * half + i] = 0.25 * (height[a] + height[a + 1] + height[a + res] + height[a + res + 1]);
    }
  }
  const r = Math.max(1, Math.round(SUN.caustics.blurPx / (TILE.size / half)));
  const blurred = boxBlur(small, half, r);
  const data = new Uint16Array(half * half);
  for (let k = 0; k < half * half; k++) data[k] = THREE.DataUtils.toHalfFloat(blurred[k]);
  const tex = new THREE.DataTexture(data, half, half, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// The tile's own outline, so nothing shows around the glass and the rim
// refracts the off-white page just beyond the edge.
function outlineGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const steps = 720;
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const r = boundaryRadius(Math.cos(a), Math.sin(a)) - 0.5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let k = 0; k < pos.count; k++) {
    uv[k * 2] = pos.getX(k) / TILE.size + 0.5;
    uv[k * 2 + 1] = pos.getY(k) / TILE.size + 0.5;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Sunlit surface seen through the glass, with the light the relief gathers.
// For each point it finds where that light entered the glass, traces the sun
// through the relief there (Snell at the facet, out through the flat back)
// and measures how the bent rays bunch up or spread: convex ridges focus
// light into soft bright patterns, hollows thin it. Restrained and blurred;
// recomputed every frame, so it travels with the sun.
const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uHeight;
uniform vec3 uSun;
uniform float uGain, uIor, uDepth, uStrength, uMax, uEps, uWindow, uTile;
uniform float uBoost; // hover: light gathers harder
varying vec2 vUv;

vec2 slopeAt( vec2 uv ) {
  float e = uEps / uTile;
  float hx = texture2D( uHeight, uv + vec2( e, 0.0 ) ).r - texture2D( uHeight, uv - vec2( e, 0.0 ) ).r;
  float hy = texture2D( uHeight, uv + vec2( 0.0, e ) ).r - texture2D( uHeight, uv - vec2( 0.0, e ) ).r;
  return vec2( hx, hy ) / ( 2.0 * uEps );
}

vec2 landing( vec2 uv ) {
  vec3 n = normalize( vec3( -slopeAt( uv ), 1.0 ) );
  vec3 t1 = refract( -uSun, n, 1.0 / uIor );
  vec3 t2 = refract( t1, vec3( 0.0, 0.0, 1.0 ), uIor );
  if ( dot( t2, t2 ) < 1e-6 ) t2 = t1;
  return uv + ( t2.xy / max( -t2.z, 0.25 ) ) * uDepth / uTile;
}

void main() {
  vec2 flatShift = ( -uSun.xy / max( uSun.z, 0.25 ) ) * uDepth / uTile;
  vec2 src = vUv - flatShift;
  float e = uEps / uTile;
  vec2 ju = ( landing( src + vec2( e, 0.0 ) ) - landing( src - vec2( e, 0.0 ) ) ) / ( 2.0 * e );
  vec2 jv = ( landing( src + vec2( 0.0, e ) ) - landing( src - vec2( 0.0, e ) ) ) / ( 2.0 * e );
  float area = abs( ju.x * jv.y - ju.y * jv.x );
  float caustic = mix( 1.0, clamp( 1.0 / max( area, 1e-3 ), 0.0, uMax ), uStrength + uBoost );
  vec2 toward = normalize( uSun.xy );
  float windowLight = 1.0 + uWindow * dot( toward, ( vUv - 0.5 ) * 2.0 );
  vec3 col = texture2D( uMap, vUv ).rgb * uGain * caustic * windowLight;
  gl_FragColor = vec4( col, 1.0 );
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

type BackdropProps = { heightTex: THREE.Texture };

export default function Backdrop({ heightTex }: BackdropProps) {
  const { geometry, texture, material } = useMemo(() => {
    const texture = backdropTexture();
    const C = SUN.caustics;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      toneMapped: false,
      uniforms: {
        uMap: { value: texture },
        uHeight: { value: heightTex },
        uSun: { value: sunDirection },
        uGain: { value: BACKDROP.gain },
        uIor: { value: GLASS.ior },
        uDepth: { value: C.depth },
        uStrength: { value: C.strength },
        uMax: { value: C.max },
        uEps: { value: C.eps },
        uWindow: { value: SUN.window.strength },
        uTile: { value: TILE.size },
        uBoost: motionUniforms.causticBoost,
      },
    });
    return { geometry: outlineGeometry(), texture, material };
  }, [heightTex]);

  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
      material.dispose();
    },
    [geometry, texture, material],
  );

  if (!BACKDROP.enabled) return null;
  return <mesh geometry={geometry} material={material} position={[0, 0, -BACKDROP.distance]} />;
}
