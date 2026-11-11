import * as THREE from "three";
import { BACKDROP, TILE } from "../config";
import { motionUniforms, sunDirection } from "../lighting/sun";

// Stage 5 optics, patched into MeshPhysicalMaterial.
//
// three's volume transmission samples the scene straight under the exit
// point, which cannot show what makes pressed glass read: a facet tilted one
// way bends the view toward bright sky, the other toward dark ground. This
// replaces it with a slab model:
//   1. refract into the glass at the front facet (Snell)
//   2. absorb along the real path, thickness / cos(internal angle)
//   3. refract out through the flat back face, or total internal reflection
//   4. travel to the backdrop behind the glass and sample it there; where the
//      exit is grazing, blend toward the environment along that direction
// Fresnel stays three's (EnvironmentBRDF). No dispersion, no bloom.
//
// It also uses the true orthographic view direction; three's
// cameraPosition - position tilts it by up to ~20 deg at the tile edges.
// And it reads the per-pixel absorption colour (the needle) from a map.

const PARS = /* glsl */ `
uniform sampler2D uAbsorptionMap;
uniform float uBackdropDistance;
uniform float uGrazeStart;
uniform sampler2D uReliefHeight;
uniform vec3 uSunDir;
uniform float uRelief, uAmbient, uTilePx;

// Per-element light and shadow. Each point is lit by how its own facet faces
// the sun, then the sun is traced back through the relief: where a nearby
// ridge, petal or stud stands in the way, the point falls into its shadow.
// Normalised so flat glass is unchanged (1.0); only the relief gains contrast.
float reliefShade( const in vec2 uv, const in vec3 n ) {
  if ( uRelief <= 0.0 ) return 1.0;
  vec3 s = normalize( uSunDir );
  float flatLit = max( s.z, 0.15 );
  float lit = max( dot( n, s ), 0.0 ) / flatLit;
  float h0 = texture2D( uReliefHeight, uv ).r;
  vec2 dir = normalize( s.xy + 1e-5 ) / uTilePx;
  float rise = s.z / max( length( s.xy ), 1e-3 );
  float occ = 0.0;
  for ( int i = 1; i <= 22; i ++ ) {
    float d = float( i ) * 1.5;
    float hh = texture2D( uReliefHeight, uv + dir * d ).r;
    occ = max( occ, clamp( ( hh - h0 - d * rise ) / 1.2, 0.0, 1.0 ) );
  }
  float light = lit * ( 1.0 - 0.85 * occ );
  float shaded = mix( uAmbient, 1.0, clamp( light, 0.0, 1.0 ) ) + 0.6 * max( light - 1.0, 0.0 );
  return mix( 1.0, shaded, uRelief );
}

vec3 slabEnv( const in vec3 dir, const in float roughness ) {
  #ifdef USE_ENVMAP
    return textureCubeUV( envMap, envMapRotation * dir, roughness ).rgb * envMapIntensity;
  #else
    return vec3( 0.0 );
  #endif
}

vec4 getSlabRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
    const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 viewM,
    const in mat4 projM, const in float ior, const in float thickness, const in vec3 attenuationColor,
    const in float attenuationDistance ) {

  vec3 ti = refract( -v, n, 1.0 / ior );
  float cosT = max( -ti.z, 0.12 );
  float pathLen = thickness / cosT;
  vec3 exitPos = position + ti * pathLen;
  vec3 to = refract( ti, vec3( 0.0, 0.0, 1.0 ), ior );

  vec3 seen;
  if ( dot( to, to ) < 1e-6 ) {
    // trapped by total internal reflection: bounces back up and leaves
    // toward the viewer's side, seeing the sky dimmed
    vec3 up = reflect( ti, vec3( 0.0, 0.0, 1.0 ) );
    seen = slabEnv( normalize( vec3( up.xy, abs( up.z ) ) ), roughness ) * 0.6;
  } else {
    float down = max( -to.z, 1e-3 );
    vec3 hit = exitPos + to * ( ( exitPos.z + uBackdropDistance ) / down );
    vec4 ndc = projM * viewM * vec4( hit, 1.0 );
    vec2 uv = ndc.xy / ndc.w * 0.5 + 0.5;
    vec3 back = getTransmissionSample( uv, roughness, ior ).rgb;
    float graze = 1.0 - smoothstep( 0.08, uGrazeStart, down );
    float off = step( uv.x, 0.0 ) + step( 1.0, uv.x ) + step( uv.y, 0.0 ) + step( 1.0, uv.y );
    graze = max( graze, min( off, 1.0 ) );
    seen = mix( back, slabEnv( to, roughness ), graze );
  }

  vec3 transmittance = diffuseColor * volumeAttenuation( pathLen, attenuationColor, attenuationDistance );
  vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
  return vec4( ( 1.0 - F ) * transmittance * seen, 1.0 );
}
`;

const MAIN = /* glsl */ `
#ifdef USE_TRANSMISSION
  material.transmission = transmission;
  material.transmissionAlpha = 1.0;
  material.thickness = thickness;
  material.attenuationDistance = attenuationDistance;
  vec4 absorb = texture2D( uAbsorptionMap, vMapUv );
  material.attenuationColor = mix( attenuationColor, absorb.rgb, absorb.a );
  #ifdef USE_THICKNESSMAP
    material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
  #endif
  vec3 pos = vWorldPosition;
  vec3 v = isOrthographic
    ? normalize( vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] ) )
    : normalize( cameraPosition - pos );
  vec3 n = inverseTransformDirection( normal, viewMatrix );
  vec4 transmitted = getSlabRefraction( n, v, material.roughness, material.diffuseContribution,
    material.specularColorBlended, material.specularF90, pos, viewMatrix, projectionMatrix,
    material.ior, material.thickness, material.attenuationColor, material.attenuationDistance );
  transmitted.rgb *= reliefShade( vMapUv, n );
  material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
  totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif
`;

// Soft highlight shoulder, glass only: below the knee nothing changes; above
// it values roll off smoothly toward white instead of hard-clipping, like the
// shoulder of photographic film. The only tone mapping in the piece.
const SHOULDER = /* glsl */ `
#include <opaque_fragment>
{
  vec3 c = gl_FragColor.rgb;
  vec3 over = max( c - uKnee, 0.0 );
  vec3 room = vec3( 1.0 - uKnee );
  gl_FragColor.rgb = min( c, uKnee ) + room * ( 1.0 - exp( -over / room ) );
}
`;

export const OPTICS = {
  grazeStart: 0.45, // exit cosine where the view starts bending past the backdrop to sky or ground
  knee: 0.72, // linear value where the highlight shoulder begins
  shadowAmbient: 0.35, // light left in a full shadow (sky fill)
};

export function glassShaderPatch(absorptionMap: THREE.Texture, reliefHeight: THREE.Texture) {
  return (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uAbsorptionMap = { value: absorptionMap };
    shader.uniforms.uReliefHeight = { value: reliefHeight };
    shader.uniforms.uSunDir = { value: sunDirection };
    shader.uniforms.uRelief = motionUniforms.relief;
    shader.uniforms.uAmbient = { value: OPTICS.shadowAmbient };
    shader.uniforms.uTilePx = { value: TILE.size };
    shader.uniforms.uBackdropDistance = { value: BACKDROP.distance };
    shader.uniforms.uGrazeStart = { value: OPTICS.grazeStart };
    shader.uniforms.uKnee = { value: OPTICS.knee };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <transmission_pars_fragment>", "#include <transmission_pars_fragment>\n" + PARS + "\nuniform float uKnee;")
      .replace("#include <transmission_fragment>", MAIN)
      .replace("#include <opaque_fragment>", SHOULDER);
  };
}
