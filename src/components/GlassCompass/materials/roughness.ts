import * as THREE from "three";
import { SURFACE, TILE } from "../config";
import { fbm } from "../heightmap/noise";

// Separable box blur of a res x res field, radius r texels (running sums).
export function boxBlur(src: Float32Array, res: number, r: number): Float32Array {
  const tmp = new Float32Array(res * res);
  const out = new Float32Array(res * res);
  const w = 2 * r + 1;
  for (let j = 0; j < res; j++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[j * res + Math.min(res - 1, Math.max(0, i))];
    for (let i = 0; i < res; i++) {
      tmp[j * res + i] = acc / w;
      acc += src[j * res + Math.min(res - 1, i + r + 1)] - src[j * res + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < res; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(res - 1, Math.max(0, j)) * res + i];
    for (let j = 0; j < res; j++) {
      out[j * res + i] = acc / w;
      acc += tmp[Math.min(res - 1, j + r + 1) * res + i] - tmp[Math.max(0, j - r) * res + i];
    }
  }
  return out;
}

// Roughness factor map (G channel, factor / max) from the relief: recesses
// hazier, crests polished, a little noise so reflections are never perfect.
export function buildRoughnessMap(height: Float32Array, res: number): THREE.DataTexture {
  const R = SURFACE.roughness;
  const texel = TILE.size / res;
  const blurred = boxBlur(height, res, Math.max(1, Math.round(R.blurPx / texel)));
  const smoothed = boxBlur(height, res, Math.max(1, Math.round(R.fineBlurPx / texel)));
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const y = ((j + 0.5) / res - 0.5) * TILE.size;
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * TILE.size;
      const k = j * res + i;
      const rel = height[k] - blurred[k];
      const recess = Math.min(1, Math.max(0, -rel / R.span));
      const crest = Math.min(1, Math.max(0, rel / R.span));
      const fine = Math.min(1, Math.abs(height[k] - smoothed[k]) / R.fineSpan);
      const noise = fbm(x / R.noiseScale, y / R.noiseScale, 2, R.seed);
      const f = Math.min(
        R.max,
        Math.max(0.3, 1 + R.recessBoost * recess - R.crestCut * crest * (1 - fine) + R.fineBoost * fine + R.noise * noise),
      );
      const v = Math.round((f / R.max) * 255);
      const o = k * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
