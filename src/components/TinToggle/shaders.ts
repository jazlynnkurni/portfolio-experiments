// A switch: a coin of pressed tin riding in a channel of liquid glass.
//
// Two materials doing opposite things. The glass is transmissive, so it bends
// and brightens whatever is behind it and goes bright at its edges where total
// internal reflection kicks in. The tin is the reverse, opaque and mirror
// like, showing you the room rather than the page. Putting them together is
// what makes the thumb read as a solid object sitting in something soft.
//
// The thumb does not slide, it flows: while it travels it stays fused to where
// it came from by a smooth minimum, the same trick that makes two drops of
// water reach for each other before they merge.
//
// And the sun follows the thumb. Left thumb, left sun, shadow thrown right,
// reversing as it crosses. On an engraved face that is not a shadow sliding
// across, it is every shoulder in the ornament lighting from the other flank,
// so the relief inverts as the switch travels.

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
uniform float uT;         // where the thumb is, 0 left to 1 right
uniform float uFlow;      // how much it is stretching right now
uniform float uPress;     // depth of the stamping
uniform float uHammer;
uniform float uRough;
uniform float uTarnish;
uniform float uGlass;     // how strongly the channel bends the page
uniform float uExposure;
uniform float uSunHeight;
uniform float uShadow;
uniform vec3  uPage;      // the colour behind the control
uniform float uDebug;

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
float sdCapsule(vec2 p, float halfLen, float r){
  p.x -= clamp(p.x, -halfLen, halfLen);
  return length(p) - r;
}
// the smooth minimum: what makes two blobs reach for each other
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Sheet metal will not take a crease: every stroke rises on a rounded shoulder
// with a flat crown, and that shoulder is what catches a light as a hard line.
float ridge(float d, float w){
  float t = clamp(1.0 - max(d, 0.0) / w, 0.0, 1.0);
  return sqrt(max(t * (2.0 - t), 0.0));
}

// The die for the coin, struck far denser than before: a beaded border, four
// corner fans, acanthus scrolls sweeping in, and a rosette on a boss at the
// centre. Laid out in a folded quadrant, the way the reference tile is.
float coinHeight(vec2 v, float R){
  vec2 n = v / R;                 // -1..1 across the coin
  float r = length(n);
  float h = 0.0;

  // the sheet itself, planished
  h += (fbm(n * 6.0) - 0.5) * 0.17 * uHammer;
  h += (fbm(n * 17.0) - 0.5) * 0.05 * uHammer;

  // raised rim and an inner rule
  h = max(h, ridge(abs(r - 0.95) * R, 0.05 * R) * 0.92);
  h = max(h, ridge(abs(r - 0.80) * R, 0.020 * R) * 0.60);

  // bead course between them
  float beads = 1e9;
  for (int i = 0; i < 18; i++){
    float t = (float(i) + 0.5) / 18.0 * PI * 2.0;
    beads = min(beads, length(n - vec2(cos(t), sin(t)) * 0.875) - 0.036);
  }
  h = max(h, ridge(beads * R, 0.036 * R) * 0.80);

  // fold into a quadrant and mirror on the diagonal, so one piece of ornament
  // serves all eight positions
  vec2 q = abs(n);
  if (q.x < q.y) q = q.yx;

  // acanthus scroll sweeping from the corner toward the middle
  float sc = 1e9;
  for (int i = 0; i <= 12; i++){
    float t = float(i) / 12.0;
    float th = 2.55 - t * 2.2;
    float rr = 0.62 * exp(-0.55 * t);
    vec2 a = vec2(cos(th), sin(th)) * rr + vec2(0.30, 0.30);
    if (i > 0){
      float tp = float(i - 1) / 12.0;
      float thp = 2.55 - tp * 2.2;
      float rrp = 0.62 * exp(-0.55 * tp);
      vec2 b = vec2(cos(thp), sin(thp)) * rrp + vec2(0.30, 0.30);
      sc = min(sc, sdSeg(q, b, a));
    }
  }
  h = max(h, ridge((sc - 0.035) * R, 0.055 * R) * 0.95);

  // leaves hanging off the scroll
  for (int i = 0; i < 3; i++){
    float f = float(i) / 2.0;
    vec2 root = mix(vec2(0.74, 0.30), vec2(0.34, 0.52), f);
    vec2 tip = root + vec2(-0.10 - 0.07 * f, 0.20 + 0.06 * f);
    h = max(h, ridge((sdSeg(q, root, tip) - 0.022) * R, 0.040 * R) * 0.80);
  }

  // corner fan
  float fan = 1e9;
  for (int i = 0; i < 4; i++){
    float a = 0.60 + float(i) * 0.20;
    fan = min(fan, sdSeg(q, vec2(0.66, 0.66), vec2(0.66, 0.66) + vec2(cos(a), sin(a)) * 0.20));
  }
  h = max(h, ridge((fan - 0.018) * R, 0.036 * R) * 0.85);

  // the rosette, petals and a boss
  float pet = r - 0.20 - 0.115 * abs(cos(4.0 * atan(n.y, n.x)));
  h = max(h, ridge(pet * R, 0.085 * R) * 1.0);
  h = max(h, ridge((r - 0.085) * R, 0.085 * R) * 0.95);

  return h;
}

// The room. Contrasty by design: metal has no colour of its own, it shows you
// the room, and an evenly lit one comes back as flat pale nothing.
vec3 env(vec3 d, vec3 sun){
  float up = clamp(d.y, -1.0, 1.0);
  vec3 c = mix(vec3(0.030, 0.032, 0.040), vec3(0.34, 0.36, 0.42),
               smoothstep(-0.7, 0.95, up));
  float s = max(dot(d, sun), 0.0);
  c += vec3(3.6, 3.5, 3.3) * pow(s, 22.0);
  c += vec3(1.05, 1.06, 1.12) * pow(s, 3.0) * 0.5;
  // the wall behind the viewer, which is most of what a face on coin reflects
  c += vec3(0.80, 0.82, 0.88) * smoothstep(0.15, 1.0, d.z) * 0.85;
  c += vec3(0.16, 0.20, 0.30) * pow(max(dot(d, -sun), 0.0), 2.0) * 0.5;
  c = mix(c, vec3(0.020, 0.019, 0.018), smoothstep(-0.3, -0.95, up));
  return c;
}

void main(){
  vec2 px = (vUv * uRes - uRes * 0.5) / min(uRes.x, uRes.y);
  vec2 p = px * 2.4;

  float trackHalf = 0.44;
  float trackR = 0.40;
  float knobR = 0.335;
  float knobX = mix(-trackHalf, trackHalf, uT);

  vec3 sun = normalize(vec3(mix(-0.72, 0.72, uT), uSunHeight, 0.45));
  vec3 page = uPage;
  vec3 col = page;
  float alpha = 0.0;

  // ---------------------------------------------------------------- glass
  float dTrack = sdCapsule(p, trackHalf, trackR);
  float inTrack = smoothstep(0.006, -0.006, dTrack);

  if (inTrack > 0.0){
    // A thick lens: the surface rolls over toward the rim, so the page behind
    // is pulled inward and the edge picks up a bright ring.
    float k = clamp(-dTrack / trackR, 0.0, 1.0);
    float bulge = sqrt(max(1.0 - (1.0 - k) * (1.0 - k), 0.0));
    vec2 gdir = normalize(vec2(p.x - clamp(p.x, -trackHalf, trackHalf), p.y) + 1e-5);
    vec2 refr = gdir * (1.0 - bulge) * uGlass;
    vec3 behind = page * (1.0 - 0.10 * length(refr) * 8.0);
    // a cool tint and a lift, the way a piece of glass sits over paper
    vec3 glass = behind * vec3(0.975, 0.985, 1.005) + vec3(0.035, 0.040, 0.050) * bulge;
    // the bright lip where the surface turns away
    float lip = smoothstep(0.16, 0.0, abs(dTrack)) * (1.0 - bulge);
    glass += vec3(0.30, 0.33, 0.38) * lip * 0.85;
    // the channel darkens on the side away from the sun
    float wall = dot(normalize(vec2(p.x - clamp(p.x, -trackHalf, trackHalf), p.y) + 1e-5), normalize(sun.xy));
    glass *= 1.0 + wall * (1.0 - bulge) * 0.35;
    col = mix(col, glass, inTrack);
    alpha = max(alpha, inTrack);
  }

  // ---------------------------------------------------------------- shadow
  vec2 shadowOff = -normalize(sun.xy) * (0.075 + 0.05 * (1.0 - uSunHeight));
  float dShadow = length(p - vec2(knobX, 0.0) - shadowOff) - knobR;
  float shade = exp(-max(dShadow, 0.0) * 10.0) * uShadow;
  col *= 1.0 - shade * 0.55;
  alpha = max(alpha, shade * 0.6);

  // ---------------------------------------------------------------- thumb
  // While it travels it stays fused to where it set off from, so it stretches
  // and snaps back rather than sliding.
  float trailX = mix(knobX, mix(-trackHalf, trackHalf, 1.0 - uT), clamp(uFlow, 0.0, 1.0) * 0.30);
  float dA = length(p - vec2(knobX, 0.0)) - knobR;
  float dB = length(p - vec2(trailX, 0.0)) - knobR * (0.72 - 0.25 * clamp(uFlow, 0.0, 1.0));
  float dKnob = smin(dA, dB, 0.26 * clamp(uFlow, 0.0, 1.0) + 0.02);
  float inKnob = smoothstep(0.006, -0.006, dKnob);

  if (uDebug > 1.5 && uDebug < 2.5){
    fragColor = vec4(inTrack, inKnob, 0.25, 1.0);
    return;
  }

  if (inKnob > 0.0){
    vec2 v = p - vec2(knobX, 0.0);
    float rr = clamp(length(v) / knobR, 0.0, 1.0);
    float domeZ = sqrt(max(1.0 - rr * rr * 0.5, 0.0));
    vec3 N = normalize(vec3(v / knobR * 0.5, domeZ));

    float e = 2.0 / min(uRes.x, uRes.y) * 2.4;
    float h = coinHeight(v, knobR);
    float hx = coinHeight(v + vec2(e, 0.0), knobR) - coinHeight(v - vec2(e, 0.0), knobR);
    float hy = coinHeight(v + vec2(0.0, e), knobR) - coinHeight(v - vec2(0.0, e), knobR);
    // press depth as a fraction of the coin's width, so the slope lands in the
    // same units as the surface it belongs to
    vec2 slope = vec2(hx, hy) / (2.0 * e) * uPress * knobR;
    N = normalize(vec3(N.xy - slope, N.z));

    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 R = reflect(-V, N);
    float ndv = max(dot(N, V), 1e-4);
    vec3 F0 = vec3(0.80, 0.825, 0.865);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);

    vec3 spec = vec3(0.0);
    for (int i = 0; i < 7; i++){
      float fi = float(i);
      float a = fi * 2.399963;
      float rad = sqrt(fi / 7.0) * uRough * 1.4;
      spec += env(normalize(R + vec3(cos(a), sin(a), 0.0) * rad), sun);
    }
    spec /= 7.0;

    vec3 Hv = normalize(sun + V);
    float a2 = max(uRough, 0.05); a2 *= a2;
    float ndh = max(dot(N, Hv), 0.0);
    float dd = a2 / (PI * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0) + 1e-7);
    vec3 direct = vec3(2.4, 2.38, 2.34) * dd * max(dot(N, sun), 0.0) / (4.0 * ndv + 1e-4);

    float occ = mix(0.58, 1.0, smoothstep(0.0, 0.70, h));
    vec3 knob = (spec * occ + direct) * F * 1.22;
    knob *= mix(1.0 - uTarnish, 1.0, smoothstep(0.0, 0.5, h));

    float rimLit = dot(normalize(v + 1e-6), normalize(sun.xy));
    float rimBand = smoothstep(0.0, -0.05, dKnob) * smoothstep(-0.10, -0.02, dKnob);
    knob *= 1.0 + rimLit * rimBand * 1.05;

    col = mix(col, knob, inKnob);
    alpha = max(alpha, inKnob);
  }

  col *= uExposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  if (uDebug > 2.5) alpha = 1.0;
  fragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), clamp(alpha, 0.0, 1.0));
}`;
