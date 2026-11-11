"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { SURFACE, type GlassParams } from "../config";
import { glassShaderPatch } from "./glassShader";

type GlassMaterialProps = {
  params: GlassParams;
  normalMap: THREE.Texture; // object-space normals
  thicknessMap: THREE.Texture;
  pigmentMap: THREE.Texture;
  absorptionMap: THREE.Texture; // per-pixel absorption colour (the needle)
  roughnessMap: THREE.Texture; // G = roughness factor / SURFACE.roughness.max
  reliefHeight: THREE.Texture; // blurred relief, px, for cast shadows
  maxThickness: number;
};

const OBJECT_SPACE = THREE.ObjectSpaceNormalMap;
const cacheKey = () => "glass-compass-slab-optics-relief";

// Base pressed-glass material, fully physical. Colour comes from Beer-Lambert
// absorption over the local thickness (thick glass deep moss, thin glass pale
// mint), multiplied by a near-white pigment drift between olive and mint.
// The absorption map swaps in other glass colours per pixel (ruby and silver
// for the needle) inside the same piece of glass.
// Stage 5: a roughness map from the relief (hazier recesses, polished
// crests, faint noise). Refraction comes from three's volume transmission
// bending the backdrop behind the glass; no dispersion, no bloom.
// Every optical parameter is a prop, so it can be tuned live.
export default function GlassMaterial({
  params,
  normalMap,
  thicknessMap,
  pigmentMap,
  absorptionMap,
  roughnessMap,
  reliefHeight,
  maxThickness,
}: GlassMaterialProps) {
  const onBeforeCompile = useMemo(() => glassShaderPatch(absorptionMap, reliefHeight), [absorptionMap, reliefHeight]);
  return (
    <meshPhysicalMaterial
      onBeforeCompile={onBeforeCompile}
      customProgramCacheKey={cacheKey}
      color="#ffffff"
      map={pigmentMap}
      metalness={0}
      transmission={params.transmission}
      ior={params.ior}
      roughness={params.roughness * SURFACE.roughness.max}
      roughnessMap={roughnessMap}
      thickness={maxThickness * params.thicknessScale}
      thicknessMap={thicknessMap}
      attenuationColor={params.attenuationColor}
      attenuationDistance={params.attenuationDistance}
      normalMap={normalMap}
      normalMapType={OBJECT_SPACE}
      envMapIntensity={params.envMapIntensity}
      specularIntensity={params.specularIntensity}
    />
  );
}
