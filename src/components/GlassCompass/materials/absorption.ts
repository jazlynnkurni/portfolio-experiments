import * as THREE from "three";
import { TILE } from "../config";

export type ColourField = (x: number, y: number, out: [number, number, number, number]) => void;

// Per-pixel absorption colour for the glass: RGB is the colour light is left
// with after one attenuation distance (sRGB), A is how much it replaces the
// tile's own green. Lets coloured glass (the needle) sit inside the same
// piece instead of floating on top of it.
export function buildAbsorptionMap(field: ColourField, res: number): THREE.DataTexture {
  const data = new Uint8Array(res * res * 4);
  const px: [number, number, number, number] = [0, 0, 0, 0];
  for (let j = 0; j < res; j++) {
    const y = ((j + 0.5) / res - 0.5) * TILE.size;
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * TILE.size;
      field(x, y, px);
      const o = (j * res + i) * 4;
      data[o] = px[0];
      data[o + 1] = px[1];
      data[o + 2] = px[2];
      data[o + 3] = px[3];
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; // sampled as linear, like attenuationColor
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// The map is read by the glass shader (glassShader.ts), where its colour
// replaces the attenuation colour wherever its alpha is set.
