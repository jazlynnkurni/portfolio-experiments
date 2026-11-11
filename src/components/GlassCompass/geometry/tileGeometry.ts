import * as THREE from "three";
import { TILE } from "../config";
import { boundaryRadius } from "../heightmap/silhouette";

// Front surface of the tile as a displaced grid whose outer ring of vertices
// lies exactly on the outline, so the silhouette is real geometry (smooth,
// antialiased by MSAA) rather than an alpha cut-out.
//
// A square grid point g is pushed along its ray from the centre so that the
// square's edge lands on the superellipse outline. Heights come from the
// relief grid the maps already computed (bilinear), not a second evaluation
// of every relief layer, which made this the slowest step of startup.
export function createTileGeometry(height: Float32Array, res: number, segments: number): THREE.BufferGeometry {
  const half = TILE.size / 2;
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);

  const sample = (u: number, v: number) => {
    const fx = Math.min(res - 1, Math.max(0, u * res - 0.5));
    const fy = Math.min(res - 1, Math.max(0, v * res - 0.5));
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const i1 = Math.min(res - 1, i0 + 1);
    const j1 = Math.min(res - 1, j0 + 1);
    const tx = fx - i0;
    const ty = fy - j0;
    const a = height[j0 * res + i0] + (height[j0 * res + i1] - height[j0 * res + i0]) * tx;
    const b = height[j1 * res + i0] + (height[j1 * res + i1] - height[j1 * res + i0]) * tx;
    return a + (b - a) * ty;
  };
  const e = 1 / res; // one relief texel, in uv
  const texelPx = TILE.size / res;

  for (let j = 0; j < n; j++) {
    const qy = (j / segments) * 2 - 1;
    for (let i = 0; i < n; i++) {
      const qx = (i / segments) * 2 - 1;
      let x = qx * half;
      let y = qy * half;
      const m = Math.max(Math.abs(qx), Math.abs(qy));
      if (m > 0) {
        // the square's edge along this ray sits at half * |q| / m; 18 steps of
        // bisection place the outline to about 0.01 px
        const s = boundaryRadius(qx, qy, undefined, 18) / ((Math.hypot(qx, qy) / m) * half);
        x *= s;
        y *= s;
      }
      const u = x / TILE.size + 0.5;
      const v = y / TILE.size + 0.5;
      const dx = (sample(u + e, v) - sample(u - e, v)) / (2 * texelPx);
      const dy = (sample(u, v + e) - sample(u, v - e)) / (2 * texelPx);
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const k = j * n + i;
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = sample(u, v);
      normals[k * 3] = -dx / len;
      normals[k * 3 + 1] = -dy / len;
      normals[k * 3 + 2] = 1 / len;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = v;
    }
  }

  const index = new Uint32Array(segments * segments * 6);
  let w = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index[w++] = a;
      index[w++] = b;
      index[w++] = d;
      index[w++] = a;
      index[w++] = d;
      index[w++] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}
