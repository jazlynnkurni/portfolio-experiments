import * as THREE from "three";
import { TILE } from "../config";
import { organicThickness, pigmentAt, thicknessAt } from "../materials/fields";
import { edgeDistance } from "./silhouette";

// A relief layer adds height (px, above the flat field) at a tile point.
// x, y are centred reference pixels (y up); d is the distance in from the
// outline. Later stages append layers (dial ring, ornaments) to the stack.
// `fine` asks for sub-pixel detail too (stipple and the like): the normal and
// thickness maps want it, the displaced mesh does not (it would alias).
export type HeightLayer = {
  name: string;
  height: (x: number, y: number, d: number, fine: boolean) => number;
};

export type HeightField = (x: number, y: number) => number;

export function composeHeight(layers: HeightLayer[], fine = true): HeightField {
  return (x, y) => {
    const d = edgeDistance(x, y);
    let h = 0;
    for (const layer of layers) h += layer.height(x, y, d, fine);
    return h;
  };
}

// Analytic surface normal from central differences of the height field.
export function normalAt(h: HeightField, x: number, y: number, eps = 0.35): [number, number, number] {
  const dx = (h(x + eps, y) - h(x - eps, y)) / (2 * eps);
  const dy = (h(x, y + eps) - h(x, y - eps)) / (2 * eps);
  const len = Math.hypot(dx, dy, 1);
  return [-dx / len, -dy / len, 1 / len];
}

export type TileMaps = {
  heightField: HeightField; // with fine detail
  coarseField: HeightField; // without it, for the displaced mesh
  height: Float32Array; // res x res, row 0 = bottom (uv v = 0)
  normalMap: THREE.DataTexture; // object-space normals
  thicknessMap: THREE.DataTexture; // G channel, 0..1 of maxThickness
  pigmentMap: THREE.DataTexture; // sRGB colourant drift
  maxThickness: number;
  res: number;
};

function dataTexture(data: Uint8Array, res: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildTileMaps(layers: HeightLayer[], res: number): TileMaps {
  const heightField = composeHeight(layers);
  const size = TILE.size;
  const height = new Float32Array(res * res);
  const thickness = new Float32Array(res * res);
  const normals = new Uint8Array(res * res * 4);
  const thick = new Uint8Array(res * res * 4);

  // Low-frequency fields (organic thickness, pigment) on a coarse grid.
  const coarse = Math.max(32, res >> 2);
  const organic = new Float32Array(coarse * coarse);
  const pigment = new Uint8Array(coarse * coarse * 4);
  const rgb: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < coarse; j++) {
    const y = ((j + 0.5) / coarse - 0.5) * size;
    for (let i = 0; i < coarse; i++) {
      const x = ((i + 0.5) / coarse - 0.5) * size;
      const k = j * coarse + i;
      organic[k] = organicThickness(x, y);
      pigmentAt(x, y, rgb);
      pigment[k * 4] = rgb[0];
      pigment[k * 4 + 1] = rgb[1];
      pigment[k * 4 + 2] = rgb[2];
      pigment[k * 4 + 3] = 255;
    }
  }
  const organicAt = (u: number, v: number) => {
    const fx = Math.min(coarse - 1, Math.max(0, u * coarse - 0.5));
    const fy = Math.min(coarse - 1, Math.max(0, v * coarse - 0.5));
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const i1 = Math.min(coarse - 1, i0 + 1);
    const j1 = Math.min(coarse - 1, j0 + 1);
    const tx = fx - i0;
    const ty = fy - j0;
    const a = organic[j0 * coarse + i0] + (organic[j0 * coarse + i1] - organic[j0 * coarse + i0]) * tx;
    const b = organic[j1 * coarse + i0] + (organic[j1 * coarse + i1] - organic[j1 * coarse + i0]) * tx;
    return a + (b - a) * ty;
  };

  let maxThickness = 1;
  for (let j = 0; j < res; j++) {
    const v = (j + 0.5) / res;
    const y = (v - 0.5) * size;
    for (let i = 0; i < res; i++) {
      const u = (i + 0.5) / res;
      const x = (u - 0.5) * size;
      const k = j * res + i;
      const h = heightField(x, y);
      height[k] = h;
      const t = thicknessAt(organicAt(u, v), h, edgeDistance(x, y));
      thickness[k] = t;
      if (t > maxThickness) maxThickness = t;
    }
  }

  // Normals from central differences of the height array (one texel apart).
  const texel = size / res;
  const at = (i: number, j: number) =>
    height[Math.min(res - 1, Math.max(0, j)) * res + Math.min(res - 1, Math.max(0, i))];
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * texel);
      const dy = (at(i, j + 1) - at(i, j - 1)) / (2 * texel);
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const k = j * res + i;
      const o = k * 4;
      normals[o] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      normals[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      normals[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      normals[o + 3] = 255;
      // The longer path through sloped walls (t / cos theta_t) is computed
      // per pixel in the glass shader, so the map holds the plain thickness.
    }
  }

  maxThickness = 1;
  for (let k = 0; k < res * res; k++) if (thickness[k] > maxThickness) maxThickness = thickness[k];

  for (let k = 0; k < res * res; k++) {
    const v = Math.round((thickness[k] / maxThickness) * 255);
    const o = k * 4;
    thick[o] = v;
    thick[o + 1] = v;
    thick[o + 2] = v;
    thick[o + 3] = 255;
  }

  return {
    heightField,
    coarseField: composeHeight(layers, false),
    height,
    normalMap: dataTexture(normals, res, THREE.NoColorSpace),
    thicknessMap: dataTexture(thick, res, THREE.NoColorSpace),
    pigmentMap: dataTexture(pigment, coarse, THREE.SRGBColorSpace),
    maxThickness,
    res,
  };
}
