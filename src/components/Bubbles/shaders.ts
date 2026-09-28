// Shader sources for the bubble experience.
// Everything here works in linear light. Gamma happens once, in the composite pass.

// ---------------------------------------------------------------------------
// Fullscreen triangle. No attributes, positions come from gl_VertexID.
// ---------------------------------------------------------------------------
export const VS_FULL = `#version 300 es
precision highp float;
out vec2 v_uv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------
// Shared GLSL: noise, the environment the bubbles reflect, thin film optics.
// ---------------------------------------------------------------------------
const COMMON = `
#define PI 3.14159265359

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

float hash13(vec3 p3){
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}

float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// The room a bubble sees when it reflects. A big warm softbox above and in
// front, a cool kicker from the lower right, a dark floor. Values run well
// past 1.0 so the specular has something to bloom with.
vec3 envRefl(vec3 R){
  float up = clamp(R.y, -1.0, 1.0);
  // A bright studio, not a dark room. The film only ever reflects a few percent,
  // so against a white sweep the surroundings have to carry real light or the
  // interference colours come back as mud.
  vec3 c = mix(vec3(0.045, 0.050, 0.060), vec3(0.26, 0.28, 0.34), smoothstep(-0.30, 0.95, up));
  vec3 key = normalize(vec3(-0.46, 0.72, 0.52));
  float kd = max(dot(R, key), 0.0);
  c += vec3(11.0, 9.4, 7.6) * pow(kd, 90.0);         // the hot core of the softbox
  c += vec3(2.2, 2.0, 1.75) * pow(kd, 9.0) * 0.5;    // its soft falloff
  vec3 kick = normalize(vec3(0.74, -0.22, 0.58));
  c += vec3(0.55, 0.95, 1.45) * pow(max(dot(R, kick), 0.0), 14.0) * 0.8;
  // the dark below the sweep, which is what draws the line around the bottom
  // of every bubble in a real photograph
  c = mix(c, vec3(0.020, 0.024, 0.030), smoothstep(-0.10, -0.75, up));
  return c;
}

// Thin film interference on a soap wall of thickness d nanometres.
// Two reflections, one from each face, with the half wave shift at the outer
// face. Their sum is 2R(1 - cos phi), which correctly goes black as the film
// drains to nothing. R stays around 0.08 at the peaks, like a real bubble.
vec3 thinFilm(float d, float cosI){
  float n = 1.34;
  float sinT = sqrt(max(0.0, 1.0 - cosI * cosI)) / n;
  float cosT = sqrt(max(0.0, 1.0 - sinT * sinT));
  float R0 = 0.0211;
  float Rs = R0 + (1.0 - R0) * pow(1.0 - cosI, 5.0);
  vec3 lambda = vec3(615.0, 545.0, 465.0);
  vec3 phi = (4.0 * PI * n * d * cosT) / lambda;
  return clamp(2.0 * Rs * (1.0 - cos(phi)), 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Background. A dim room with a slatted warm window and drifting bokeh, so the
// refraction through a bubble has real structure to bend.
// ---------------------------------------------------------------------------
export const FS_BG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;
${COMMON}

float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

void main(){
  vec2 ext = vec2(u_res.x / u_res.y, 1.0) * 0.5;
  vec2 p = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);

  // A white sweep, the way a bubble gets photographed. Bright and clean, but
  // never flat: a bubble on a perfectly even white has nothing to refract and
  // reads as a smudge, so the ground keeps a gentle gradient and a couple of
  // very soft shapes for the rim to bend.
  vec3 col = mix(vec3(1.00, 0.999, 0.997), vec3(0.955, 0.960, 0.968),
                 smoothstep(-0.70, 0.85, -p.y / ext.y));

  // a soft cool shadow pooling at the foot of the sweep
  float floorShade = smoothstep(0.55, -0.15, (p.y / ext.y + 0.55) * 1.6);
  col = mix(col, vec3(0.930, 0.937, 0.948), floorShade * 0.70);

  // two barely there gradations, enough for the refraction to have something
  // to compress at the rim
  float g1 = smoothstep(0.85, 0.0, length((p - vec2(-0.55, 0.42) * ext) / ext.y));
  col = mix(col, vec3(1.0, 0.999, 0.993), g1 * 0.5);
  float g2 = smoothstep(0.75, 0.0, length((p - vec2(0.62, -0.30) * ext) / ext.y));
  col = mix(col, vec3(0.962, 0.968, 0.978), g2 * 0.5);

  // the softbox itself, reflected later by the film, shows here as a faint bar
  float bar = smoothstep(0.30, 0.0, abs(p.x - (-0.30) * ext.x) - 0.06 * ext.x)
            * smoothstep(0.95, 0.30, abs(p.y / ext.y));
  col += vec3(0.012, 0.012, 0.014) * bar;

  col *= 1.0 - 0.045 * pow(length(p / ext.y * 0.5) * 1.05, 2.4);
  outColor = vec4(max(col, 0.0), 1.0);
}`;

export const VS_BUBBLE = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 i_a;   // x, y, radius, depth
layout(location = 2) in vec4 i_b;   // wobble amp1, phase1, amp2, phase2
layout(location = 3) in vec4 i_c;   // film nm, seed, hole angle (<0 intact), flow phase
layout(location = 4) in vec4 i_d;   // hole direction xyz, fade
uniform vec2 u_res;
out vec2 v_p;
out vec2 v_scr;
flat out vec4 f_a;
flat out vec4 f_b;
flat out vec4 f_c;
flat out vec4 f_d;
void main(){
  float pad = 1.34;
  v_p = vec2(a_corner.x, -a_corner.y) * pad;      // y up, screen space is y down
  vec2 px = i_a.xy + a_corner * (pad * i_a.z);
  vec2 ndc = (px / u_res) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  v_scr = ndc * 0.5 + 0.5;
  f_a = i_a; f_b = i_b; f_c = i_c; f_d = i_d;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const FS_BUBBLE = `#version 300 es
precision highp float;
in vec2 v_p;
in vec2 v_scr;
flat in vec4 f_a;
flat in vec4 f_b;
flat in vec4 f_c;
flat in vec4 f_d;
uniform sampler2D u_scene;
uniform vec2 u_res;
uniform float u_time;
uniform float u_refract;
uniform float u_gain;
uniform float u_focus;
uniform float u_dof;
out vec4 outColor;
${COMMON}

void main(){
  float R = f_a.z;

  // the wall is never a perfect circle, surface tension lets it ring
  float ang = atan(v_p.y, v_p.x);
  float wob = 1.0 + f_b.x * cos(2.0 * ang + f_b.y) + f_b.z * cos(3.0 * ang + f_b.w);
  float rr = length(v_p) / wob;

  float blur = clamp(abs(f_a.w - u_focus) * u_dof, 0.0, 1.0);
  float sw = 0.9 / R + blur * 0.30;
  if (rr > 1.0 + sw * 1.7) discard;
  float cov = 1.0 - smoothstep(1.0 - sw, 1.0 + sw, rr);
  if (cov <= 0.002) discard;

  float rc = min(rr, 1.0);
  vec3 N = normalize(vec3(v_p.x / wob, v_p.y / wob, sqrt(max(0.0, 1.0 - rc * rc))));
  vec3 V = normalize(vec3(-(v_scr - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 0.30, 1.0));
  float cosI = clamp(dot(N, V), 0.0, 1.0);

  // a puncture opens and its rim retracts across the sphere
  float hole = f_c.z;
  float inHole = 0.0, rim = 0.0;
  if (hole >= 0.0){
    float a = acos(clamp(dot(N, f_d.xyz), -1.0, 1.0));
    float ragged = (fbm(N * 24.0 + f_c.y * 13.0) - 0.5) * 0.075;
    float h = hole + ragged * smoothstep(0.0, 0.30, hole);
    inHole = smoothstep(h + 0.010, h - 0.010, a);
    rim = exp(-pow((a - h) / 0.035, 2.0)) * (1.0 - inHole);
  }

  // gravity drains the wall downward, so it is thinnest at the crown and the
  // crown goes black just before the thing gives out
  float drain = mix(1.28, 0.26, smoothstep(-0.92, 1.0, N.y));
  vec3 q = N * 2.6 + vec3(0.0, -u_time * 0.13 + f_c.w, f_c.y * 23.0);
  float n1 = fbm(q);
  float n2 = fbm(q * 2.9 + n1 * 2.0);
  float marble = mix(0.70 + 0.80 * n1 + 0.30 * n2, 1.0, blur * 0.75);
  float d = max(f_c.x * drain * marble * (1.0 + rim * 0.60), 4.0);

  vec3 Rf = thinFilm(d, cosI) * u_gain;

  vec3 refl = envRefl(reflect(-V, N));
  vec3 back = envRefl(reflect(-V, normalize(vec3(N.x, N.y, -N.z * 0.55))));
  vec3 mirror = mix(refl, refl * 0.72 + back * 0.52, 0.5);

  // a thin shell barely bends light through the middle and bends it hard at
  // grazing angles, which is where the compressed ring of the room shows up
  float g = pow(1.0 - cosI, 2.2);
  vec2 off = N.xy * g * u_refract * (R / u_res) * (1.0 - inHole * 0.92);
  vec3 bg;
  bg.r = texture(u_scene, v_scr + off * 1.07).r;
  bg.g = texture(u_scene, v_scr + off * 1.00).g;
  bg.b = texture(u_scene, v_scr + off * 0.93).b;

  // inside the hole the near wall is gone, only the far wall is left
  float filmMask = mix(1.0, 0.17 * (1.0 - clamp(hole / PI, 0.0, 1.0)), inHole);
  float graze = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  // At grazing incidence a soap film reflects almost everything, so the
  // silhouette mirrors the dark room and draws itself as a defined ring. It was
  // damped to a tenth of that, which a dark ground hid and a white one does not.
  vec3 Reff = clamp(Rf * filmMask + vec3(graze * 0.42 * filmMask * (1.0 - inHole)), 0.0, 1.0);

  vec3 col = bg * (1.0 - Reff) + mirror * Reff;
  col += vec3(1.0, 0.97, 0.92) * rim * 0.26;

  float a = cov * f_d.w;
  outColor = vec4(col * a, a);
}`;

// ---------------------------------------------------------------------------
// Debris from a burst. Three kinds share one pass: water beads, film shards
// that keep their interference colour, and the fine mist.
// ---------------------------------------------------------------------------
export const VS_DROP = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 i_a;   // x, y, radius, alpha
layout(location = 2) in vec4 i_b;   // seed, kind, film nm, spin
uniform vec2 u_res;
out vec2 v_p;
out vec2 v_scr;
flat out vec4 f_a;
flat out vec4 f_b;
void main(){
  float pad = i_b.y > 0.5 && i_b.y < 1.5 ? 2.6 : 1.4;   // mist needs room to glow
  v_p = vec2(a_corner.x, -a_corner.y) * pad;
  vec2 px = i_a.xy + a_corner * (pad * i_a.z);
  vec2 ndc = (px / u_res) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  v_scr = ndc * 0.5 + 0.5;
  f_a = i_a; f_b = i_b;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const FS_DROP = `#version 300 es
precision highp float;
in vec2 v_p;
in vec2 v_scr;
flat in vec4 f_a;
flat in vec4 f_b;
uniform sampler2D u_scene;
uniform vec2 u_res;
uniform float u_gain;
out vec4 outColor;
${COMMON}

void main(){
  float rr = length(v_p);
  float kind = f_b.y;

  // mist: no surface worth shading, just scattered light. Alpha zero with
  // premultiplied blending makes this purely additive.
  if (kind > 0.5 && kind < 1.5){
    float glow = exp(-rr * rr * 2.2);
    vec3 c = mix(vec3(0.62, 0.80, 1.0), vec3(1.0, 0.86, 0.68), hash11(f_b.x * 5.3));
    outColor = vec4(c * glow * f_a.w * 0.55, 0.0);
    return;
  }

  float sw = clamp(1.1 / max(f_a.z, 0.75), 0.05, 0.85);
  if (rr > 1.0 + sw) discard;
  float cov = 1.0 - smoothstep(1.0 - sw, 1.0 + sw, rr);
  if (cov <= 0.002) discard;

  float rc = min(rr, 1.0);
  vec3 N = normalize(vec3(v_p, sqrt(max(0.0, 1.0 - rc * rc))));
  float cosI = clamp(N.z, 0.0, 1.0);

  // a solid bead of water is a fat lens, it inverts what is behind it
  vec2 off = -N.xy * (0.55 + 0.95 * pow(1.0 - cosI, 1.5)) * (f_a.z * 3.0 / u_res);
  vec3 bg = texture(u_scene, v_scr + off).rgb * vec3(0.94, 0.97, 1.0);

  float fres = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  vec3 refl = envRefl(reflect(vec3(0.0, 0.0, -1.0), N));
  vec3 col = mix(bg, refl, fres * 0.92);

  // a torn piece of wall still carries its colour for a moment
  if (kind > 1.5) col += refl * thinFilm(f_b.z, cosI) * u_gain * 1.6;

  vec3 L = normalize(vec3(-0.46, 0.72, 0.52));
  col += vec3(1.8, 1.68, 1.5) * pow(max(dot(N, L), 0.0), 80.0);

  float a = cov * f_a.w;
  outColor = vec4(col * a, a);
}`;

// ---------------------------------------------------------------------------
// Bloom. Bright pass at quarter res, then separable blur.
// ---------------------------------------------------------------------------
export const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform float u_thresh;
out vec4 outColor;
void main(){
  vec3 c = texture(u_src, v_uv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - u_thresh, 0.0) / max(l, 1e-4);
  outColor = vec4(c * k, 1.0);
}`;

export const FS_BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_dir;      // texel step, already scaled
out vec4 outColor;
void main(){
  vec3 s = texture(u_src, v_uv).rgb * 0.2270270270;
  s += (texture(u_src, v_uv + u_dir * 1.3846153846).rgb +
        texture(u_src, v_uv - u_dir * 1.3846153846).rgb) * 0.3162162162;
  s += (texture(u_src, v_uv + u_dir * 3.2307692308).rgb +
        texture(u_src, v_uv - u_dir * 3.2307692308).rgb) * 0.0702702703;
  outColor = vec4(s, 1.0);
}`;

// ---------------------------------------------------------------------------
// Composite. Pressure ripples from fresh bursts, bloom, tonemap, grain.
// ---------------------------------------------------------------------------
export const FS_COMP = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_res;
uniform float u_time;
uniform float u_bloomAmt;
uniform vec4 u_rip[6];   // x, y (uv pixel space), age seconds, strength
out vec4 outColor;

vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  vec2 uv = v_uv;

  // the air a burst pushes out, a thin expanding shell
  for (int i = 0; i < 6; i++){
    vec4 r = u_rip[i];
    if (r.w <= 0.0) continue;
    vec2 d = uv * u_res - r.xy;
    float dist = length(d) + 1e-4;
    float rad = r.z * 620.0;
    float w = exp(-pow((dist - rad) / (22.0 + rad * 0.26), 2.0)) * r.w;
    uv += (d / dist) / u_res * w * 14.0;
  }

  vec3 c = texture(u_scene, uv).rgb;
  c += texture(u_bloom, uv).rgb * u_bloomAmt;
  c = aces(c * 1.06);

  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + u_time * 43.0) * 43758.5453);
  c += (g - 0.5) * (0.005 + 0.020 * dot(c, vec3(0.2126, 0.7152, 0.0722)));

  outColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;
