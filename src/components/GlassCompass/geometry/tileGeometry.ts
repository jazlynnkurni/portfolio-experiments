import * as THREE from "three";
import { TILE } from "../config";
import { boundaryRadius } from "../heightmap/silhouette";
import { normalAt, type HeightField } from "../heightmap/compose";

// Front surface of the tile as a displaced grid whose outer ring of vertices
// lies exactly on the outline, so the silhouette is real geometry (smooth,
// antialiased by MSAA) rather than an alpha cut-out.
//
// A square grid point g is pushed along its ray from the centre so that the
// square's edge lands on the superellipse outline.
export function createTileGeometry(heightField: HeightField, segments: number): THREE.BufferGeometry {
  const half = TILE.size / 2;
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);

  for (let j = 0; j < n; j++) {
    const qy = (j / segments) * 2 - 1;
    for (let i = 0; i < n; i++) {
      const qx = (i / segments) * 2 - 1;
      let x = qx * half;
      let y = qy * half;
      const m = Math.max(Math.abs(qx), Math.abs(qy));
      if (m > 0) {
        // the square's edge along this ray sits at half * |q| / m
        const s = boundaryRadius(qx, qy) / ((Math.hypot(qx, qy) / m) * half);
        x *= s;
        y *= s;
      }
      const h = heightField(x, y);
      const [nx, ny, nz] = normalAt(heightField, x, y);
      const k = j * n + i;
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = h;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;
      uvs[k * 2] = x / TILE.size + 0.5;
      uvs[k * 2 + 1] = y / TILE.size + 0.5;
    }
  }

  const index: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}
