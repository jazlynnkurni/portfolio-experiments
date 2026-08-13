"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * A small convenience store built entirely from three.js primitives, sitting on
 * a low wooden raft. Renders as scene contents only, so it must be mounted
 * inside an existing Canvas. Nothing here animates: the parent owns the
 * floating bob and sway by transforming this group.
 *
 * Layout conventions:
 * - the deck top sits at y = 0, so y = 0 is the waterline,
 * - the storefront faces +z, so a camera in front of the origin sees the glass,
 * - the building occupies x in [-3, 3], z in [-2, 2], and is 3 units tall.
 */

export type StoreProps = {
  glow?: number; // 0..1 interior and sign light, default 1
  accent?: string; // sign band colour, default "#ff5a1f"
  accent2?: string; // secondary accent, default "#38bdf8"
  quality?: "high" | "low"; // "low" drops small props and shadow casting
};

// Design tokens.
const CREAM = "#FFF5EF";
const BURNT = "#C97836";
const ORANGE_DARK = "#9A4C19";

// Interior light colour: warm fluorescent white.
const INTERIOR = "#fff2d8";

// Product block palette, kept saturated so the shelves read through the glass.
const PRODUCT_COLOURS = [
  "#ff7a3d",
  "#4fd1c5",
  "#f6d365",
  "#ef476f",
  "#8bd450",
  "#7aa2ff",
  "#f3f0e7",
];

// Deterministic hash so the shelf stock is stable across renders.
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

type Product = {
  key: string;
  position: [number, number, number];
  size: [number, number, number];
  colour: number;
};

// Two shelving units behind the glass, three levels each.
const SHELF_ROWS: number[] = [-1.25, -0.35];
const SHELF_LEVELS: number[] = [0.5, 1.05, 1.6];

function buildProducts(): Product[] {
  const out: Product[] = [];
  let seed = 0;
  SHELF_ROWS.forEach((z, r) => {
    SHELF_LEVELS.forEach((y, l) => {
      for (let i = 0; i < 11; i += 1) {
        seed += 1;
        const a = hash(seed);
        const b = hash(seed + 91.3);
        const h = 0.16 + a * 0.16;
        const w = 0.2 + b * 0.14;
        out.push({
          key: `p-${r}-${l}-${i}`,
          position: [-2.2 + i * 0.44 + (a - 0.5) * 0.06, y + 0.03 + h / 2, z],
          size: [w, h, 0.22 + b * 0.1],
          colour: Math.floor(a * 997 + l * 3 + i) % PRODUCT_COLOURS.length,
        });
      }
    });
  });
  return out;
}

export function Store({
  glow = 1,
  accent = "#ff5a1f",
  accent2 = "#38bdf8",
  quality = "high",
}: StoreProps): React.JSX.Element {
  const g = Math.max(0, glow);
  const high = quality === "high";

  const mats = useMemo(() => {
    const wall = new THREE.MeshStandardMaterial({
      color: CREAM,
      roughness: 0.92,
      metalness: 0.02,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: "#d8cec4",
      roughness: 0.7,
      metalness: 0.1,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: "#8d949c",
      roughness: 0.45,
      metalness: 0.75,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: "#2b2f36",
      roughness: 0.6,
      metalness: 0.3,
    });
    const wood = new THREE.MeshStandardMaterial({
      color: "#6b4b31",
      roughness: 0.95,
      metalness: 0.02,
    });
    const woodDark = new THREE.MeshStandardMaterial({
      color: "#4a3320",
      roughness: 0.95,
      metalness: 0.02,
    });
    const drum = new THREE.MeshStandardMaterial({
      color: ORANGE_DARK,
      roughness: 0.55,
      metalness: 0.35,
    });
    // Storefront glazing: dark and reflective, but see-through enough that the
    // lit interior is what the eye lands on.
    const glass = new THREE.MeshStandardMaterial({
      color: "#0d1a21",
      roughness: 0.06,
      metalness: 0.35,
      transparent: true,
      opacity: 0.26,
      emissive: new THREE.Color(INTERIOR),
      emissiveIntensity: 0.55 * g,
      side: THREE.DoubleSide,
    });
    const interior = new THREE.MeshStandardMaterial({
      color: "#fdf3e2",
      roughness: 1,
      emissive: new THREE.Color(INTERIOR),
      emissiveIntensity: 1.7 * g,
    });
    const tube = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      emissive: new THREE.Color("#fff8e6"),
      emissiveIntensity: 4.2 * g,
    });
    const floorIn = new THREE.MeshStandardMaterial({
      color: "#efe4d6",
      roughness: 0.35,
      metalness: 0.05,
      emissive: new THREE.Color(INTERIOR),
      emissiveIntensity: 0.4 * g,
    });
    const sign = new THREE.MeshStandardMaterial({
      color: accent,
      roughness: 0.35,
      emissive: new THREE.Color(accent),
      emissiveIntensity: 2.8 * g,
    });
    const stripe = new THREE.MeshStandardMaterial({
      color: accent2,
      roughness: 0.35,
      emissive: new THREE.Color(accent2),
      emissiveIntensity: 2.4 * g,
    });
    const door = new THREE.MeshStandardMaterial({
      color: "#fff4dd",
      roughness: 0.5,
      emissive: new THREE.Color("#ffe6bb"),
      emissiveIntensity: 2.2 * g,
    });
    const bulb = new THREE.MeshStandardMaterial({
      color: "#fff6e2",
      roughness: 1,
      emissive: new THREE.Color("#ffdca8"),
      emissiveIntensity: 3.4 * g,
    });
    const counter = new THREE.MeshStandardMaterial({
      color: BURNT,
      roughness: 0.6,
      metalness: 0.08,
    });
    return {
      wall,
      trim,
      metal,
      dark,
      wood,
      woodDark,
      drum,
      glass,
      interior,
      tube,
      floorIn,
      sign,
      stripe,
      door,
      bulb,
      counter,
    };
  }, [g, accent, accent2]);

  // Shelf stock shares a small pool of materials rather than one per block.
  const productMats = useMemo(
    () =>
      PRODUCT_COLOURS.map(
        (c) =>
          new THREE.MeshStandardMaterial({
            color: c,
            roughness: 0.75,
            emissive: new THREE.Color(c),
            emissiveIntensity: 0.35 * g,
          }),
      ),
    [g],
  );

  const products = useMemo(() => buildProducts(), []);

  useEffect(() => {
    const owned = Object.values(mats);
    return () => {
      owned.forEach((m) => m.dispose());
    };
  }, [mats]);

  useEffect(() => {
    const owned = productMats;
    return () => {
      owned.forEach((m) => m.dispose());
    };
  }, [productMats]);

  return (
    <group>
      {/* ---------------------------------------------------------------- */}
      {/* Raft: deck top at y = 0, floats kept shallow so they stay near the */}
      {/* waterline rather than sinking out of sight.                       */}
      {/* ---------------------------------------------------------------- */}
      <mesh
        position={[0, -0.15, 0]}
        material={mats.wood}
        receiveShadow={high}
        castShadow={high}
      >
        <boxGeometry args={[7.6, 0.3, 5.6]} />
      </mesh>

      {/* Plank seams. */}
      {high &&
        [-2.1, -1.05, 0, 1.05, 2.1].map((z) => (
          <mesh key={`seam-${z}`} position={[0, 0.005, z]} material={mats.woodDark}>
            <boxGeometry args={[7.5, 0.02, 0.05]} />
          </mesh>
        ))}

      {/* Cross beams and float drums. */}
      {[-2.0, 2.0].map((z) => (
        <mesh key={`beam-${z}`} position={[0, -0.38, z]} material={mats.woodDark}>
          <boxGeometry args={[7.3, 0.18, 0.22]} />
        </mesh>
      ))}
      {[-2.6, 0, 2.6].map((x) => (
        <group key={`drum-${x}`} position={[x, -0.44, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.drum}>
            <cylinderGeometry args={[0.32, 0.32, 5.2, 18]} />
          </mesh>
          {high &&
            [-1.6, 1.6].map((z) => (
              <mesh
                key={`band-${z}`}
                position={[0, 0, z]}
                rotation={[0, 0, Math.PI / 2]}
                material={mats.metal}
              >
                <torusGeometry args={[0.33, 0.025, 6, 20]} />
              </mesh>
            ))}
        </group>
      ))}

      {/* ---------------------------------------------------------------- */}
      {/* Shell: back and side walls, roof slab, parapet.                    */}
      {/* ---------------------------------------------------------------- */}
      <mesh position={[0, 1.5, -1.9]} material={mats.wall} castShadow={high}>
        <boxGeometry args={[6, 3, 0.2]} />
      </mesh>
      {[-2.9, 2.9].map((x) => (
        <mesh key={`side-${x}`} position={[x, 1.5, 0]} material={mats.wall} castShadow={high}>
          <boxGeometry args={[0.2, 3, 3.8]} />
        </mesh>
      ))}
      <mesh position={[0, 3.1, 0]} material={mats.trim} castShadow={high}>
        <boxGeometry args={[6.3, 0.2, 4.3]} />
      </mesh>
      {/* Parapet on all four roof edges. */}
      <mesh position={[0, 3.375, 2.07]} material={mats.trim}>
        <boxGeometry args={[6.3, 0.35, 0.16]} />
      </mesh>
      <mesh position={[0, 3.375, -2.07]} material={mats.trim}>
        <boxGeometry args={[6.3, 0.35, 0.16]} />
      </mesh>
      {[-3.07, 3.07].map((x) => (
        <mesh key={`par-${x}`} position={[x, 3.375, 0]} material={mats.trim}>
          <boxGeometry args={[0.16, 0.35, 4.3]} />
        </mesh>
      ))}

      {/* ---------------------------------------------------------------- */}
      {/* Interior: the brightest thing in the scene.                        */}
      {/* ---------------------------------------------------------------- */}
      <mesh position={[0, 1.5, -1.75]} material={mats.interior}>
        <boxGeometry args={[5.6, 2.85, 0.06]} />
      </mesh>
      <mesh position={[0, 0.03, 0]} material={mats.floorIn}>
        <boxGeometry args={[5.6, 0.06, 3.7]} />
      </mesh>
      {/* Ceiling strip lights. */}
      {[-0.5, 0.8].map((z) => (
        <mesh key={`tube-${z}`} position={[0, 2.78, z]} material={mats.tube}>
          <boxGeometry args={[4.6, 0.08, 0.22]} />
        </mesh>
      ))}

      {/* Shelving units and stock. */}
      {SHELF_ROWS.map((z) => (
        <group key={`unit-${z}`} position={[0, 0, z]}>
          <mesh position={[0, 0.95, -0.16]} material={mats.trim}>
            <boxGeometry args={[4.9, 1.9, 0.08]} />
          </mesh>
          {SHELF_LEVELS.map((y) => (
            <mesh key={`shelf-${y}`} position={[0, y, 0]} material={mats.trim}>
              <boxGeometry args={[4.9, 0.06, 0.42]} />
            </mesh>
          ))}
        </group>
      ))}
      {products.map((p) => (
        <mesh key={p.key} position={p.position} material={productMats[p.colour]}>
          <boxGeometry args={p.size} />
        </mesh>
      ))}

      {/* Counter by the door, with a register block. */}
      <mesh position={[1.55, 0.48, 0.95]} material={mats.counter}>
        <boxGeometry args={[1.7, 0.9, 0.6]} />
      </mesh>
      <mesh position={[1.55, 1.03, 0.95]} material={mats.trim}>
        <boxGeometry args={[1.8, 0.1, 0.7]} />
      </mesh>
      {high && (
        <mesh position={[1.9, 1.22, 0.95]} material={mats.dark}>
          <boxGeometry args={[0.34, 0.3, 0.26]} />
        </mesh>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Storefront: glass bay from x = -2.9 to 1.3, recessed door to the    */}
      {/* right of it, signage band across the full width above.             */}
      {/* ---------------------------------------------------------------- */}
      <mesh position={[-2.93, 1.5, 1.9]} material={mats.wall} castShadow={high}>
        <boxGeometry args={[0.14, 3, 0.25]} />
      </mesh>
      <mesh position={[1.4, 1.5, 1.9]} material={mats.wall} castShadow={high}>
        <boxGeometry args={[0.2, 3, 0.25]} />
      </mesh>
      <mesh position={[2.85, 1.5, 1.9]} material={mats.wall} castShadow={high}>
        <boxGeometry args={[0.3, 3, 0.25]} />
      </mesh>
      {/* Header wall carrying the signage. */}
      <mesh position={[0, 2.575, 1.9]} material={mats.wall} castShadow={high}>
        <boxGeometry args={[6, 0.85, 0.25]} />
      </mesh>
      {/* Kick plate under the glass. */}
      <mesh position={[-0.8, 0.17, 1.9]} material={mats.trim}>
        <boxGeometry args={[4.2, 0.34, 0.26]} />
      </mesh>

      {/* Glazing, plus its frame. */}
      <mesh position={[-0.8, 1.25, 1.95]} material={mats.glass}>
        <boxGeometry args={[4.2, 1.8, 0.05]} />
      </mesh>
      <mesh position={[-0.8, 2.17, 1.95]} material={mats.trim}>
        <boxGeometry args={[4.24, 0.06, 0.1]} />
      </mesh>
      {high && (
        <>
          {[-1.85, -0.8, 0.25].map((x) => (
            <mesh key={`mull-${x}`} position={[x, 1.25, 1.97]} material={mats.trim}>
              <boxGeometry args={[0.05, 1.8, 0.08]} />
            </mesh>
          ))}
          <mesh position={[-0.8, 1.72, 1.97]} material={mats.trim}>
            <boxGeometry args={[4.2, 0.04, 0.08]} />
          </mesh>
        </>
      )}

      {/* Signage band and secondary stripe. */}
      <mesh position={[0, 2.62, 2.04]} material={mats.sign}>
        <boxGeometry args={[6.2, 0.5, 0.14]} />
      </mesh>
      <mesh position={[0, 2.3, 2.05]} material={mats.stripe}>
        <boxGeometry args={[6.2, 0.1, 0.16]} />
      </mesh>

      {/* Recessed entrance: jambs, soffit, glowing door leaf. */}
      {[1.55, 2.65].map((x) => (
        <mesh key={`jamb-${x}`} position={[x, 1.08, 1.78]} material={mats.wall}>
          <boxGeometry args={[0.1, 2.15, 0.36]} />
        </mesh>
      ))}
      <mesh position={[2.1, 2.1, 1.78]} material={mats.wall}>
        <boxGeometry args={[1.2, 0.1, 0.36]} />
      </mesh>
      <mesh position={[2.1, 1.02, 1.6]} material={mats.door}>
        <boxGeometry args={[1.1, 2.05, 0.06]} />
      </mesh>
      <mesh position={[2.1, 1.02, 1.64]} material={mats.trim}>
        <boxGeometry args={[0.06, 2.05, 0.04]} />
      </mesh>
      {high && (
        <mesh position={[1.78, 1.05, 1.66]} rotation={[Math.PI / 2, 0, 0]} material={mats.metal}>
          <cylinderGeometry args={[0.025, 0.025, 0.5, 8]} />
        </mesh>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Roof kit: air conditioning unit and vent pipe.                     */}
      {/* ---------------------------------------------------------------- */}
      <group position={[-1.3, 0, -0.7]}>
        <mesh position={[0, 3.48, 0]} material={mats.metal} castShadow={high}>
          <boxGeometry args={[1.3, 0.55, 1.0]} />
        </mesh>
        <mesh position={[0, 3.77, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.dark}>
          <torusGeometry args={[0.3, 0.04, 8, 22]} />
        </mesh>
        {high &&
          [-0.16, 0, 0.16].map((y) => (
            <mesh key={`slat-${y}`} position={[0.66, 3.48 + y, 0]} material={mats.dark}>
              <boxGeometry args={[0.03, 0.06, 0.8]} />
            </mesh>
          ))}
      </group>
      <mesh position={[1.5, 3.6, -1.0]} material={mats.metal}>
        <cylinderGeometry args={[0.11, 0.11, 0.8, 12]} />
      </mesh>
      <mesh position={[1.5, 4.04, -1.0]} material={mats.dark}>
        <cylinderGeometry args={[0.17, 0.17, 0.1, 12]} />
      </mesh>

      {/* ---------------------------------------------------------------- */}
      {/* Pole sign at the front left corner of the deck, facing +z.         */}
      {/* ---------------------------------------------------------------- */}
      <group position={[-3.35, 0, 1.65]}>
        <mesh position={[0, 2.3, 0]} material={mats.metal} castShadow={high}>
          <cylinderGeometry args={[0.09, 0.11, 4.6, 12]} />
        </mesh>
        <mesh position={[0, 4.55, 0.04]} material={mats.sign} castShadow={high}>
          <boxGeometry args={[1.15, 1.35, 0.14]} />
        </mesh>
        <mesh position={[0, 4.15, 0.14]} material={mats.stripe}>
          <boxGeometry args={[0.85, 0.16, 0.05]} />
        </mesh>
        <mesh position={[0, 4.78, 0.14]} material={mats.stripe}>
          <boxGeometry args={[0.85, 0.1, 0.05]} />
        </mesh>
        <mesh position={[0, 3.86, 0]} material={mats.dark}>
          <boxGeometry args={[0.3, 0.12, 0.3]} />
        </mesh>
      </group>

      {/* ---------------------------------------------------------------- */}
      {/* Deck props, high quality only.                                     */}
      {/* ---------------------------------------------------------------- */}
      {high && (
        <>
          {/* Crate. */}
          <mesh position={[-3.15, 0.25, 2.25]} material={mats.wood}>
            <boxGeometry args={[0.7, 0.5, 0.6]} />
          </mesh>
          <mesh position={[-3.15, 0.36, 2.25]} material={mats.woodDark}>
            <boxGeometry args={[0.74, 0.05, 0.64]} />
          </mesh>

          {/* Bench. */}
          <mesh position={[-1.1, 0.46, 2.4]} material={mats.wood}>
            <boxGeometry args={[1.5, 0.09, 0.42]} />
          </mesh>
          {[-0.6, 0.6].map((dx) => (
            <mesh key={`leg-${dx}`} position={[-1.1 + dx, 0.21, 2.4]} material={mats.woodDark}>
              <boxGeometry args={[0.09, 0.42, 0.38]} />
            </mesh>
          ))}

          {/* Mooring post with a rope ring. */}
          <mesh position={[3.35, 0.37, 2.4]} material={mats.woodDark}>
            <cylinderGeometry args={[0.12, 0.14, 0.75, 10]} />
          </mesh>
          <mesh position={[3.35, 0.6, 2.4]} rotation={[Math.PI / 2, 0, 0]} material={mats.wood}>
            <torusGeometry args={[0.16, 0.035, 6, 18]} />
          </mesh>

          {/* Bulb hanging by the entrance. */}
          <mesh position={[2.1, 2.26, 2.2]} material={mats.dark}>
            <boxGeometry args={[0.12, 0.08, 0.12]} />
          </mesh>
          <mesh position={[2.1, 2.02, 2.2]} material={mats.dark}>
            <cylinderGeometry args={[0.012, 0.012, 0.42, 6]} />
          </mesh>
          <mesh position={[2.1, 1.74, 2.2]} material={mats.bulb}>
            <sphereGeometry args={[0.09, 12, 10]} />
          </mesh>
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Spill light: a few point lights just outside the storefront so the  */}
      {/* store throws warmth onto the deck and the water around it.         */}
      {/* ---------------------------------------------------------------- */}
      <pointLight
        position={[-1.4, 1.5, 3.1]}
        color="#ffc48a"
        intensity={7 * g}
        distance={14}
        decay={2}
      />
      <pointLight
        position={[2.1, 1.3, 2.9]}
        color="#ffdcb0"
        intensity={5 * g}
        distance={11}
        decay={2}
      />
      <pointLight
        position={[-3.35, 4.2, 2.3]}
        color={accent}
        intensity={4 * g}
        distance={10}
        decay={2}
      />
    </group>
  );
}

export default Store;
