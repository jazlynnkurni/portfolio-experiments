import { ORNAMENT } from "../../config";

// Lattice placement. Measurements are image px (y down); the tile is centred
// px with y up, so an image index i maps to i - 367.5 (x) and 367.5 - i (y).
const toTileX = (ix: number) => ix - 367.5;
const toTileY = (iy: number) => 367.5 - iy;

const L = ORNAMENT.lattice;
const OX = toTileX(L.origin[0]);
const OY = toTileY(L.origin[1]);
// basis columns in tile space (y flips)
const EIX = L.ei[0];
const EIY = -L.ei[1];
const EJX = L.ej[0];
const EJY = -L.ej[1];
const DET = EIX * EJY - EJX * EIY;

// px per unit cell, for turning unit distances into px
export const UNIT_PX = Math.sqrt(Math.abs(DET));

// Lattice coordinates (a, b) of a tile point: quatrefoils at integers,
// rosettes at half-integers.
export function latticeCoords(x: number, y: number): [number, number] {
  const dx = x - OX;
  const dy = y - OY;
  return [(EJY * dx - EJX * dy) / DET, (-EIY * dx + EIX * dy) / DET];
}

const key = (a: number, b: number) => `${a},${b}`;
const MEASURED = new Map(
  ORNAMENT.measured.map((m) => [key(m.at[0], m.at[1]), [toTileX(m.centre[0]), toTileY(m.centre[1])] as const]),
);

// Centre of the motif at lattice point (a, b): measured where it converged,
// otherwise on the fitted lattice.
export function centreOf(a: number, b: number): readonly [number, number] {
  return MEASURED.get(key(a, b)) ?? [OX + EIX * a + EJX * b, OY + EIY * a + EJY * b];
}

export type Instance = {
  scale: number;
  cos: number;
  sin: number;
  height: number;
  seed: number;
};

function hash(a: number, b: number, s: number): number {
  let h = Math.imul(Math.round(a * 2) + 1013, 374761393) ^ Math.imul(Math.round(b * 2) + 7919, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const instances = new Map<string, Instance>();

// Per-motif hand-made irregularity: tiny scale, rotation and depth changes.
export function instanceOf(a: number, b: number): Instance {
  const k = key(a, b);
  let inst = instances.get(k);
  if (!inst) {
    const j = ORNAMENT.irregularity;
    const s = (n: number) => hash(a, b, j.seed + n) * 2 - 1;
    const rot = (s(1) * j.rotationDeg * Math.PI) / 180;
    inst = { scale: 1 + s(2) * j.scale, cos: Math.cos(rot), sin: Math.sin(rot), height: 1 + s(3) * j.height, seed: Math.floor(hash(a, b, j.seed + 4) * 997) };
    instances.set(k, inst);
  }
  return inst;
}

// Unit-cell coordinates of a tile point relative to a motif centre, with the
// motif's own rotation and scale removed. v runs down the lattice.
export function toUnit(x: number, y: number, c: readonly [number, number], k: Instance): [number, number] {
  const dx = x - c[0];
  const dy = y - c[1];
  const u0 = (EJY * dx - EJX * dy) / DET;
  const v0 = (-EIY * dx + EIX * dy) / DET;
  return [(k.cos * u0 + k.sin * v0) / k.scale, (-k.sin * u0 + k.cos * v0) / k.scale];
}
