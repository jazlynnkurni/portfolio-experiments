// A switch whose thumb is a coin of pressed tin.
//
// The rule the piece runs on: the sun sits on whichever side the thumb has
// travelled to, so with the thumb left the light comes from the left and the
// shadow is thrown right, and the whole thing reverses as it crosses. Because
// the thumb is engraved rather than smooth, that reversal is not just a shadow
// sliding across. Every shoulder in the ornament was catching light on one
// flank and is suddenly catching it on the other, so the relief inverts as the
// switch travels, and it reads the way a real coin does when you turn it to
// the window.

export const VS_QUAD = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FS_TOGGLE = `#version 300 es
precision highp float;

in vec2 vUv;

uniform vec2  uRes;
uniform float uT;        // thumb travel, 0 left to 1 right
uniform float uPress;    // how hard the ornament is stamped
uniform float uHammer;
uniform float uRough;
uniform float uTarnish;
uniform float uExposure;
uniform float uSunHeight;
uniform float uShadow;
uniform float uTime;

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
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// capsule, for the track
float sdCapsule(vec2 p, float halfLen, float r){
  p.x -= clamp(p.x, -halfLen, halfLen);
  return length(p) - r;
}

// Sheet metal cannot take a crease: a stroke comes up with a rounded shoulder
// and a flat crown.
float ridge(float d, float w){
  float t = clamp(1.0 - max(d, 0.0) / w, 0.0, 1.0);
  return sqrt(max(t * (2.0 - t), 0.0));
}

// The die for the thumb. Polar, because a struck coin is laid out from its
// centre: a rim, a bead course, a rosette and a little fleuron ring.
float coinHeight(vec2 q, float R){
  float r = length(q) / R;
  float a = atan(q.y, q.x);
  float h = 0.0;

  // planished ground
  h += (fbm(q / R * 7.0) - 0.5) * 0.16 * uHammer;
  h += (fbm(q / R * 19.0) - 0.5) * 0.05 * uHammer;

  // raised rim, then a step down inside it
  h = max(h, ridge(abs(r - 0.93) * R, 0.055 * R) * 0.95);
  h = max(h, ridge(abs(r - 0.79) * R, 0.022 * R) * 0.62);

  // bead course following the rim
  float beads = 1e9;
  for (int i = 0; i < 15; i++){
    float t = (float(i) + 0.5) / 15.0 * PI * 2.0;
    beads = min(beads, length(q - vec2(cos(t), sin(t)) * 0.845 * R) - 0.044 * R);
  }
  h = max(h, ridge(beads, 0.044 * R) * 0.80);

  // eight petal rosette in the middle
  float petal = length(q) / R - 0.21 - 0.15 * abs(cos(4.0 * a));
  h = max(h, ridge(petal * R, 0.10 * R) * 1.0);

  // a small boss at dead centre
  h = max(h, ridge(length(q) - 0.072 * R, 0.072 * R) * 0.88);

  return h;
}

// The room. Contrasty on purpose: metal has no colour of its own, it shows you
// the room, so an evenly lit one comes back as flat pale nothing.
vec3 env(vec3 d, vec3 sun){
  float up = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(vec3(0.030, 0.032, 0.040), vec3(0.34, 0.36, 0.42),
                 smoothstep(-0.7, 0.95, up));
  // the sun itself, a broad window rather than a point
  float s = max(dot(d, sun), 0.0);
  col += vec3(3.6, 3.5, 3.3) * pow(s, 22.0);
  col += vec3(1.05, 1.06, 1.12) * pow(s, 3.0) * 0.5;
  // the room behind the viewer, which is what a face on coin actually shows
  col += vec3(0.80, 0.82, 0.88) * smoothstep(0.15, 1.0, d.z) * 0.85;
  // a cool bounce opposite the sun, so the dark side is not dead
  col += vec3(0.16, 0.20, 0.30) * pow(max(dot(d, -sun), 0.0), 2.0) * 0.5;
  col = mix(col, vec3(0.020, 0.019, 0.018), smoothstep(-0.3, -0.95, up));
  return col;
}

void main(){
  vec2 px = (vUv * uRes - uRes * 0.5) / min(uRes.x, uRes.y);
  vec2 p = px * 2.4;                   // working units, roughly -1.2..1.2

  // ------------------------------------------------ layout
  float trackHalf = 0.46;
  float trackR = 0.40;
  float knobR = 0.355;
  float travel = trackHalf;
  float knobX = mix(-travel, travel, uT);

  // The sun follows the thumb. Left thumb, left sun, shadow thrown right.
  vec3 sun = normalize(vec3(mix(-0.72, 0.72, uT), uSunHeight, 0.42));

  vec3 col = vec3(0.0);

  // ------------------------------------------------ the track
  float dTrack = sdCapsule(p, trackHalf, trackR);
  float inTrack = smoothstep(0.004, -0.004, dTrack);

  // a recess: dark where the wall faces away from the sun, catching a line of
  // light on the far side, which is what a groove does
  vec2 wallDir = normalize(vec2(dFdx(dTrack), dFdy(dTrack)) + 1e-6);
  float wallLit = dot(wallDir, normalize(sun.xy));
  float wallBand = smoothstep(0.10, 0.0, abs(dTrack)) ;
  vec3 trackCol = mix(vec3(0.20, 0.205, 0.225), vec3(0.36, 0.375, 0.41),
                      smoothstep(-trackR, 0.0, dTrack));
  trackCol *= 1.0 + wallLit * wallBand * 0.9;
  // the lit half of the track warms slightly when the switch is on
  trackCol = mix(trackCol, trackCol * vec3(1.18, 1.05, 0.86), uT * 0.55);
  col = mix(col, trackCol, inTrack);

  // ------------------------------------------------ the thumb's shadow
  // cast away from the sun, and softening as it goes
  vec2 shadowOff = -normalize(sun.xy) * (0.085 + 0.055 * (1.0 - uSunHeight));
  float dShadow = length(p - vec2(knobX, 0.0) - shadowOff) - knobR;
  float shade = exp(-max(dShadow, 0.0) * 9.0) * uShadow;
  col *= 1.0 - shade * 0.82 * inTrack;

  // ------------------------------------------------ the thumb
  vec2 q = p - vec2(knobX, 0.0);
  float dKnob = length(q) - knobR;
  float inKnob = smoothstep(0.004, -0.004, dKnob);

  if (inKnob > 0.001) {
    // dome the coin very slightly, then stamp it
    float rr = clamp(length(q) / knobR, 0.0, 1.0);
    float domeZ = sqrt(max(1.0 - rr * rr * 0.55, 0.0));
    vec3 N = normalize(vec3(q / knobR * 0.55, domeZ));

    float e = 1.4 / min(uRes.x, uRes.y) * 2.4;
    float h = coinHeight(q, knobR);
    float hx = coinHeight(q + vec2(e, 0.0), knobR) - coinHeight(q - vec2(e, 0.0), knobR);
    float hy = coinHeight(q + vec2(0.0, e), knobR) - coinHeight(q - vec2(0.0, e), knobR);
    // press depth as a fraction of the coin's width, which is the only way the
    // slope lands in the same units as the surface it belongs to
    vec2 slope = vec2(hx, hy) / (2.0 * e) * uPress * knobR;
    N = normalize(vec3(N.xy - slope, N.z));

    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 R = reflect(-V, N);
    float ndv = max(dot(N, V), 1e-4);

    vec3 F0 = vec3(0.80, 0.825, 0.865);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);

    vec3 spec = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 7; i++){
      float fi = float(i);
      float a = fi * 2.399963;
      float rad = sqrt(fi / 7.0) * uRough * 1.4;
      spec += env(normalize(R + vec3(cos(a), sin(a), 0.0) * rad), sun);
      wsum += 1.0;
    }
    spec /= wsum;

    vec3 Hv = normalize(sun + V);
    float a2 = max(uRough, 0.05); a2 *= a2;
    float ndh = max(dot(N, Hv), 0.0);
    float dd = a2 / (PI * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0) + 1e-7);
    vec3 direct = vec3(2.4, 2.38, 2.34) * dd * max(dot(N, sun), 0.0) / (4.0 * ndv + 1e-4);

    float occ = mix(0.58, 1.0, smoothstep(0.0, 0.70, h));
    vec3 knob = (spec * occ + direct) * F * 1.22;
    knob *= mix(1.0 - uTarnish, 1.0, smoothstep(0.0, 0.5, h));

    // the coin's own edge, dark on the away side and hot on the sun side
    float rimLit = dot(normalize(q + 1e-6), normalize(sun.xy));
    float rimBand = smoothstep(0.0, -0.05, dKnob) * smoothstep(-0.10, -0.02, dKnob);
    knob *= 1.0 + rimLit * rimBand * 1.1;

    col = mix(col, knob, inKnob);
  }

  col *= uExposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  float alpha = max(inTrack, inKnob);
  // keep the cast shadow visible where it falls outside the track
  alpha = max(alpha, shade * 0.5);
  fragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), alpha);
}`;
