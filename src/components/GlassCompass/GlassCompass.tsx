"use client";

import { useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import { BACKGROUND, GLASS, RESOLUTION, TILE, type GlassParams } from "./config";
import { buildTileMaps, type HeightLayer } from "./heightmap/compose";
import { rimLayer } from "./heightmap/rim";
import { imperfectionLayer } from "./heightmap/imperfections";
import { dialLayer } from "./heightmap/dial";
import { ornamentLayer } from "./heightmap/ornament";
import { buildAbsorptionMap } from "./materials/absorption";
import Hands from "./Hands";
import { buildRoughnessMap } from "./materials/roughness";
import { bubbleLayer } from "./heightmap/bubbles";
import Backdrop, { heightTexture } from "./lighting/Backdrop";
import { createTileGeometry } from "./geometry/tileGeometry";
import GlassMaterial from "./materials/GlassMaterial";
import SunRig from "./lighting/SunRig";

type Variant = "full" | "embed";

type GlassCompassProps = {
  variant?: Variant;
  glass?: GlassParams;
  animate?: boolean; // slow sun drift; always off under prefers-reduced-motion
  active?: boolean; // hovered: the hands turn and the light moves; unwinds when false
  onFrame?: (canvas: HTMLCanvasElement) => void; // called after every rendered frame
  className?: string;
};

// Relief stack, bottom to top. Stage 1: outer rim bevel and pressing flaws.
// Stage 2: compass dial (border band and recessed pills).
// Stage 3: pressed lattice ornament (quatrefoils, rosettes, studs, stipple).
// Stage 5: micro-bubbles and fine ripple (normal and thickness maps only).
// The needle is not baked in: it is drawn as two turning hands (Hands.tsx)
// over the full relief, which reads through their glass.
const LAYERS: HeightLayer[] = [rimLayer, dialLayer, ornamentLayer, imperfectionLayer, bubbleLayer];

// No per-pixel colour left in the tile itself (the hands carry the ruby and
// silver), so the absorption map is a tiny empty one.
const noColour = (_x: number, _y: number, out: [number, number, number, number]) => {
  out[0] = out[1] = out[2] = out[3] = 0;
};

function Tile({ variant, glass }: { variant: Variant; glass: GlassParams }) {
  const res = RESOLUTION[variant];

  const { geometry, maps, absorption, roughness, relief } = useMemo(() => {
    const maps = buildTileMaps(LAYERS, res.heightMap);
    return {
      geometry: createTileGeometry(maps.coarseField, res.segments),
      maps,
      absorption: buildAbsorptionMap(noColour, 2),
      roughness: buildRoughnessMap(maps.height, maps.res),
      relief: heightTexture(maps.height, maps.res), // caustics and cast shadows
    };
  }, [res.heightMap, res.segments]);

  useEffect(
    () => () => {
      geometry.dispose();
      maps.normalMap.dispose();
      maps.thicknessMap.dispose();
      maps.pigmentMap.dispose();
      absorption.dispose();
      roughness.dispose();
      relief.dispose();
    },
    [geometry, maps, absorption, roughness, relief],
  );

  return (
    <>
    <Backdrop heightTex={relief} />
    <mesh geometry={geometry}>
      <GlassMaterial
        params={glass}
        normalMap={maps.normalMap}
        thicknessMap={maps.thicknessMap}
        pigmentMap={maps.pigmentMap}
        absorptionMap={absorption}
        roughnessMap={roughness}
        reliefHeight={relief}
        maxThickness={maps.maxThickness}
      />
    </mesh>
    </>
  );
}

// The page colour, visible only to the refraction pass: the canvas itself is
// transparent outside the glass (so a CSS shadow and reflection can follow
// the tile's shape), but the rim still needs a surface to bend.
// Drawn into the transmission target only, never to the screen.
function transmissionOnly(this: THREE.Mesh, renderer: THREE.WebGLRenderer) {
  (this.material as THREE.Material).colorWrite = renderer.getRenderTarget() !== null;
}

function RefractionSurround() {
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: BACKGROUND, depthWrite: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh position={[0, 0, -200]} material={material} onBeforeRender={transmissionOnly}>
      <planeGeometry args={[TILE.size + 160, TILE.size + 160]} />
    </mesh>
  );
}

// Takes over rendering (priority 1) so every finished frame can be handed on,
// e.g. to draw the floor reflection.
function FrameTap({ onFrame }: { onFrame: (canvas: HTMLCanvasElement) => void }) {
  useFrame((state) => {
    state.gl.render(state.scene, state.camera);
    onFrame(state.gl.domElement);
  }, 1);
  return null;
}

export default function GlassCompass({
  variant = "full",
  glass = GLASS,
  animate = true,
  active = false,
  onFrame,
  className,
}: GlassCompassProps) {
  return (
    <Canvas
      className={className}
      flat
      frameloop="demand"
      dpr={RESOLUTION[variant].dpr}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <RefractionSurround />
      {onFrame && <FrameTap onFrame={onFrame} />}
      {/* Orthographic, front-facing, fixed frustum: the tile fills the square
          canvas at any size, 1 world unit = 1 reference pixel. */}
      <OrthographicCamera
        makeDefault
        manual
        left={-TILE.size / 2}
        right={TILE.size / 2}
        top={TILE.size / 2}
        bottom={-TILE.size / 2}
        near={1}
        far={4000}
        position={[0, 0, 1000]}
      />
      <SunRig animate={animate} active={active} />
      <Tile variant={variant} glass={glass} />
      <Hands />
    </Canvas>
  );
}
