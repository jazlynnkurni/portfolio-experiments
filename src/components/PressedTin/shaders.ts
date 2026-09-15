// Pressed tin: a sheet of metal stamped into ornament.
//
// The whole character comes from how sheet metal deforms. It cannot take a
// sharp edge, so every raised line has a rounded shoulder and the crown of a
// stroke is nearly flat. Light then does two things at once: the shoulders
// throw a hard specular because they sweep through every angle in a couple of
// millimetres, and the recesses fill with shadow and darken. That contrast is
// the ornament, not any painted line.
//
// So the tile is built as a height field first, the way a die would be cut,
// and the shading reads the surface that falls out of it.

export const VS_TILE = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aPart;   // 0 face, 1 edge

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vPart;

void main(){
  vec4 p = uModel * vec4(aPos, 1.0);
  vWorld = p.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vUv = aPos.xy * 0.5 + 0.5;
  vPart = aPart;
  gl_Position = uViewProj * p;
}`;

export const FS_TILE = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vPart;

uniform vec3  uCam;
uniform float uRelief;     // how deep the press is
uniform float uHammer;     // planishing marks on the ground
uniform float uRough;
uniform float uTarnish;    // how much the recesses have gone dark
uniform float uExposure;
uniform float uLightSpin;
uniform vec2  uTexel;
uniform mat3  uNormalRot;

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

// ------------------------------------------------------------ ornament
float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdRoundRect(vec2 p, vec2 b, float r){
  vec2 d = abs(p) - b + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

// A C scroll, the backbone of this kind of ornament. Walked as a logarithmic
// spiral because that is the curve a scroll actually is, tightening as it
// turns in on itself.
float sdScroll(vec2 p, vec2 c, float a0, float scale, float turns, float dir){
  float best = 1e9;
  for (int i = 0; i <= 26; i++){
    float t = float(i) / 26.0;
    float th = a0 + dir * t * turns * PI * 2.0;
    float r = scale * exp(-0.62 * t);
    vec2 q = c + vec2(cos(th), sin(th)) * r;
    if (i > 0){
      float tp = float(i - 1) / 26.0;
      float thp = a0 + dir * tp * turns * PI * 2.0;
      float rp = scale * exp(-0.62 * tp);
      vec2 qp = c + vec2(cos(thp), sin(thp)) * rp;
      best = min(best, sdSeg(p, qp, q));
    }
  }
  return best;
}

// An acanthus frond: tapered lobes fanning off a stem, which is the motif
// every pressed tin pattern leans on.
float sdAcanthus(vec2 p, vec2 c, float rot, float scale){
  float cs = cos(rot), sn = sin(rot);
  vec2 q = vec2((p.x - c.x) * cs + (p.y - c.y) * sn,
                -(p.x - c.x) * sn + (p.y - c.y) * cs) / scale;
  float best = sdSeg(q, vec2(0.0, -0.1), vec2(0.0, 0.85)) - 0.045;   // stem
  for (int i = 0; i < 5; i++){
    float f = float(i) / 4.0;
    float side = mod(float(i), 2.0) * 2.0 - 1.0;
    float len = 0.62 * (1.0 - 0.45 * f);
    vec2 tip = vec2(side * len * 0.85, 0.12 + f * 0.72 + len * 0.35);
    vec2 mid = vec2(side * len * 0.30, 0.10 + f * 0.70);
    float d = min(sdSeg(q, mid, tip), sdSeg(q, vec2(0.0, 0.08 + f * 0.7), mid));
    best = min(best, d - mix(0.055, 0.022, f));
  }
  return best * scale;
}

// Beading: a row of little domes punched along an arc, as in the reference.
float beadRow(vec2 p, vec2 c, float r, float a0, float a1, int n, float bead){
  float best = 1e9;
  for (int i = 0; i < 22; i++){
    if (i >= n) break;
    float t = float(i) / float(max(n - 1, 1));
    float a = mix(a0, a1, t);
    best = min(best, length(p - (c + vec2(cos(a), sin(a)) * r)) - bead);
  }
  return best;
}

// Sheet metal cannot hold a crease. Every stroke comes up with a rounded
// shoulder and a flat crown, so the height of a stroke is a dome across its
// width rather than a step.
float ridge(float d, float w){
  float t = clamp(1.0 - max(d, 0.0) / w, 0.0, 1.0);
  return sqrt(max(t * (2.0 - t), 0.0));      // circular shoulder
}

// The die. Everything above is combined into one height field, in tile space
// running 0..1 on each axis.
float height(vec2 uv){
  vec2 p = uv * 2.0 - 1.0;          // -1..1
  float h = 0.0;

  // planished ground, the hammer marks the sheet arrives with
  h += (fbm(uv * 9.0) - 0.5) * 0.16 * uHammer;
  h += (fbm(uv * 23.0) - 0.5) * 0.045 * uHammer;

  // outer frame, a pair of beaded rules stepped in from the edge
  float f1 = abs(sdRoundRect(p, vec2(0.92), 0.05));
  float f2 = abs(sdRoundRect(p, vec2(0.80), 0.05));
  h = max(h, ridge(f1, 0.028) * 0.85);
  h = max(h, ridge(f2, 0.018) * 0.65);

  // fold into one quadrant so the tile reads as a stamping, four fold
  // symmetric the way these panels are
  vec2 q = abs(p);
  if (q.x < q.y) q = q.yx;           // and mirrored about the diagonal

  // corner rosette
  float rose = length(q - vec2(0.70, 0.70));
  float petal = rose - 0.055 - 0.025 * cos(8.0 * atan(q.y - 0.70, q.x - 0.70));
  h = max(h, ridge(petal, 0.05) * 0.95);

  // the main scroll sweeping in from the corner
  float s1 = sdScroll(q, vec2(0.34, 0.32), 2.35, 0.46, 1.35, 1.0);
  h = max(h, ridge(s1, 0.045) * 1.0);

  // a second, tighter scroll turning the other way
  float s2 = sdScroll(q, vec2(0.66, 0.24), 0.9, 0.26, 1.15, -1.0);
  h = max(h, ridge(s2, 0.032) * 0.88);

  // acanthus sitting in the crook of the big scroll
  float ac = sdAcanthus(q, vec2(0.52, 0.46), -0.7, 0.30);
  h = max(h, ridge(ac, 0.030) * 0.92);

  // beading following the scroll's outer edge
  float bd = beadRow(q, vec2(0.30, 0.30), 0.52, 0.15, 1.35, 14, 0.016);
  h = max(h, ridge(bd, 0.016) * 0.80);

  return h;
}

// The room the sheet stands in. Broad bright panels rather than points,
// because what makes a stamping legible is a big light sweeping across the
// shoulders: each shoulder turns through ninety degrees in a millimetre, so it
// catches the panel edge as a hard line while the flats stay quiet.
vec3 env(vec3 d){
  float c = cos(uLightSpin), sn = sin(uLightSpin);
  d = vec3(d.x * c - d.z * sn, d.y, d.x * sn + d.z * c);
  float up = clamp(d.y, -1.0, 1.0);

  vec3 col = mix(vec3(0.012, 0.013, 0.017), vec3(0.17, 0.185, 0.225),
                 smoothstep(-0.7, 0.95, up));
  // two broad panels overhead and one low fill, the shape of a working studio
  col += vec3(3.4, 3.36, 3.26) * exp(-pow((d.z + 0.45) * 2.6, 2.0)) * smoothstep(0.0, 0.7, up);
  col += vec3(2.1, 2.10, 2.16) * exp(-pow((d.z - 0.55) * 3.0, 2.0)) * smoothstep(0.05, 0.8, up);
  col += vec3(0.30, 0.34, 0.44) * pow(max(-d.x, 0.0), 2.5) * 0.5;
  col = mix(col, vec3(0.022, 0.021, 0.020), smoothstep(-0.25, -0.95, up));
  return col;
}

float ggx(float ndh, float a){
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 1e-7);
}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);
  float h = 0.0;
  float occ = 1.0;

  if (vPart < 0.5) {
    // Read the die, then take the surface from its slope. Four samples is
    // steadier than trying to differentiate the ornament analytically.
    vec2 e = uTexel;
    h = height(vUv);
    float hx = height(vUv + vec2(e.x, 0.0)) - height(vUv - vec2(e.x, 0.0));
    float hy = height(vUv + vec2(0.0, e.y)) - height(vUv - vec2(0.0, e.y));
    // relief is the press depth as a fraction of the tile's width, so the
    // slope comes out in the same units as the surface it belongs to
    vec2 slope = vec2(hx / (2.0 * e.x), hy / (2.0 * e.y)) * uRelief;
    vec3 nLocal = normalize(vec3(-slope, 1.0));
    N = normalize(uNormalRot * nLocal);

    // Recesses see less of the room. Cheap, but it is what stops a normal map
    // from looking like a sticker.
    occ = mix(0.20, 1.0, smoothstep(0.0, 0.70, h));
  }

  vec3 R = reflect(-V, N);
  float ndv = max(dot(N, V), 1e-4);

  // tin plate: a bright, very slightly cool metal
  vec3 F0 = vec3(0.80, 0.825, 0.865);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);

  // A satin finish, so the room arrives slightly softened rather than mirrored.
  vec3 spec = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 9; i++){
    float fi = float(i);
    float a = fi * 2.399963;
    float rr = sqrt(fi / 9.0) * uRough * 1.5;
    vec3 off = normalize(R + vec3(cos(a), sin(a), 0.0) * rr);
    float w = 1.0 - fi / 12.0;
    spec += env(off) * w;
    wsum += w;
  }
  spec /= wsum;

  // one hard panel edge, which is the line that traces every shoulder
  vec3 L = normalize(vec3(-0.34, 0.80, 0.49));
  vec3 Hv = normalize(L + V);
  float d = ggx(max(dot(N, Hv), 0.0), max(uRough, 0.05));
  vec3 direct = vec3(2.2, 2.18, 2.14) * d * max(dot(N, L), 0.0) / (4.0 * ndv + 1e-4);

  vec3 col = (spec * occ + direct) * F;

  // the recesses hold dirt and oxide, which is most of what makes old tin
  // read as old
  col *= mix(1.0 - uTarnish, 1.0, smoothstep(0.0, 0.5, h));
  if (vPart > 0.5) col *= 0.58;

  col *= uExposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  fragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;
