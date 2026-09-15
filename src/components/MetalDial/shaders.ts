// A brushed aluminium dial.
//
// Brushing cuts fine parallel grooves, and each groove behaves like a tiny
// cylinder. A cylinder reflects a light as a line running along its own axis,
// so thousands of them smear every highlight into a streak that follows the
// grain. Brush a disc in circles, the way a watch bezel is finished, and that
// streak closes into a bowtie of light lying across the face, which sweeps
// round as the disc turns. That sweep is the entire point of the piece, and it
// is why the shading is an anisotropic BRDF rather than a gradient with noise
// laid over it.

export const VS_DIAL = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;      // model space, disc lies in xy, z is thickness
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aPart;    // 0 face, 1 chamfer, 2 side wall

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;

out vec3 vWorld;
out vec3 vNormal;
out vec3 vModel;
out float vPart;

void main(){
  vec4 p = uModel * vec4(aPos, 1.0);
  vWorld = p.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vModel = aPos;
  vPart = aPart;
  gl_Position = uViewProj * p;
}`;

export const FS_DIAL = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec3 vModel;
in float vPart;

uniform vec3  uCam;
uniform float uRadius;
uniform float uSpin;        // how far the disc has turned, radians
uniform float uAlongRough;  // roughness along a groove, low
uniform float uAcrossRough; // roughness across the grooves, high
uniform float uGrain;       // depth of the groove perturbation
uniform float uDish;        // how much the face is hollowed
uniform vec3  uTint;
uniform float uAnodise;
uniform float uExposure;
uniform float uLightSpin;   // lets the room turn instead of the disc

out vec4 fragColor;

const float PI = 3.14159265359;

float hash21(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), u.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), u.x), u.y);
}

// The room. Long strips, because a streak needs something long to be a streak
// of: a point light on brushed metal reads as a smudge.
vec3 env(vec3 d){
  float c = cos(uLightSpin), s = sin(uLightSpin);
  d = vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);

  float up = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(vec3(0.016, 0.018, 0.022), vec3(0.20, 0.22, 0.27),
                 smoothstep(-0.6, 0.92, up));

  for (int i = 0; i < 3; i++){
    float z = -0.62 + float(i) * 0.62;
    float band = exp(-pow((d.z - z) * 6.0, 2.0)) * smoothstep(0.05, 0.8, up);
    col += vec3(2.9, 2.85, 2.75) * band;
  }
  col += vec3(0.26, 0.38, 0.58) * pow(max(-d.x, 0.0), 3.0) * 0.55;
  col += vec3(0.55, 0.40, 0.26) * pow(max(d.x, 0.0), 4.0) * 0.30;
  col = mix(col, vec3(0.040, 0.037, 0.034), smoothstep(-0.2, -0.95, up));
  return col;
}

float ggxAniso(vec3 H, vec3 N, vec3 T, vec3 B, float ax, float ay){
  float ht = dot(H, T) / ax;
  float hb = dot(H, B) / ay;
  float hn = dot(H, N);
  float d = ht * ht + hb * hb + hn * hn;
  return 1.0 / (PI * ax * ay * d * d);
}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);

  // Where this pixel sits on the disc, in the metal's own frame, so the grain
  // turns with the object rather than swimming across it.
  float ang = atan(vModel.y, vModel.x);
  float rad = length(vModel.xy) / max(uRadius, 1e-4);

  // The face is dished very slightly, which bends the bowtie into a curve
  // instead of a straight bar.
  if (vPart < 0.5) {
    float slope = uDish * rad;
    vec3 outward = normalize(vec3(vModel.xy, 0.0) + vec3(1e-6));
    N = normalize(N + outward * slope);
  }

  // Grooves run tangentially, so the tangent frame is radial.
  vec3 radialW = normalize(vec3(cos(ang), sin(ang), 0.0));
  vec3 tangentW = normalize(cross(N, radialW));
  vec3 bitan = normalize(cross(N, tangentW));

  // The grooves themselves: very fine around the circumference, slowly
  // varying along the radius, plus a wander so it never tiles.
  float turns = ang + uSpin;
  // Circular brushing cuts concentric rings, so the groove pattern has to vary
  // fast with radius and slowly with angle. Running it the other way round
  // gives radial spokes, which is a turned sunburst, a different finish
  // entirely. Frequencies chosen against the drawn size: the finest ring is
  // about three pixels apart on a disc this big, any tighter and it aliases
  // into flat grey.
  float fine = vnoise(vec2(turns * 4.0, rad * 46.0)) - 0.5;
  float mid  = vnoise(vec2(turns * 2.0, rad * 17.0)) - 0.5;
  float wander = vnoise(vec2(turns * 1.5, rad * 6.0)) - 0.5;
  float groove = fine * 0.6 + mid * 0.3 + wander * 0.3;
  float grainAmt = uGrain * (vPart < 0.5 ? 1.0 : 0.55);
  N = normalize(N + bitan * groove * grainAmt);

  vec3 R = reflect(-V, N);

  vec3 F0 = mix(vec3(0.91, 0.92, 0.94), uTint, uAnodise);
  float ndv = max(dot(N, V), 1e-4);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);

  float ax = max(uAlongRough, 0.004);
  float ay = max(uAcrossRough, 0.004);

  // Spread the reflection across the grooves. This is the cheap stand in for
  // integrating the BRDF against the room, and it is what turns a mirror
  // reflection into a brushed one.
  vec3 spec = vec3(0.0);
  float wsum = 0.0;
  for (int i = -7; i <= 7; i++){
    float t = float(i) / 7.0;
    float w = exp(-t * t * 2.2);
    vec3 Rs = normalize(R + bitan * t * ay * 3.0 + tangentW * t * ax * 0.6);
    spec += env(Rs) * w;
    wsum += w;
  }
  spec /= wsum;

  // One hard strip on top so there is a hot edge of light, not only a wash.
  vec3 L = normalize(vec3(-0.30, 0.90, 0.32));
  vec3 H = normalize(L + V);
  float D = ggxAniso(H, N, tangentW, bitan, ax, ay);
  float ndl = max(dot(N, L), 0.0);
  vec3 direct = vec3(1.5, 1.47, 1.42) * D * ndl / (4.0 * ndv + 1e-4);

  vec3 col = (spec + direct) * F;

  // The turned face carries faint concentric tool marks from the lathe.
  if (vPart < 0.5) {
    col *= 1.0 + sin(rad * 210.0) * 0.012 * smoothstep(0.08, 0.5, rad);
    // and the machined centre reads darker, it is a different finish
    col = mix(col * 0.82, col, smoothstep(0.10, 0.16, rad));
  }

  // The side wall sits in its own shade, which is what gives the disc mass.
  if (vPart > 1.5) col *= 0.62;

  col *= uExposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  fragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

export const VS_SHADOW = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform mat4 uViewProj;
uniform float uSpread;
out vec2 vUv;
void main(){
  vUv = aCorner;
  vec3 p = vec3(aCorner * uSpread, -0.001);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const FS_SHADOW = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uDark;
out vec4 fragColor;
void main(){
  // contact shadow, tight under the disc and falling away fast
  float d = length(vUv);
  float a = exp(-d * d * 3.2) * uDark;
  fragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 1.0));
}`;
