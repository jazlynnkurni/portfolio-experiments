// A collage board. Each piece is a quad the shader fills, so they can be moved,
// scaled and turned independently while sharing one canvas, one paper and one
// grain. Three kinds of piece, three ways of putting ink on a page.

export const VS_PIECE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;   // -1..1

uniform vec2  uRes;      // canvas, device pixels
uniform vec2  uCentre;   // piece centre, device pixels
uniform vec2  uSize;     // piece half size, device pixels
uniform float uRot;

out vec2 vLocal;         // -1..1 inside the piece

void main(){
  vLocal = aCorner;
  float c = cos(uRot), s = sin(uRot);
  vec2 p = aCorner * uSize;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + uCentre;
  vec2 ndc = (p / uRes) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;

const NOISE = `
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
`;

// ---------------------------------------------------------------- the orb
export const FS_ORB = `#version 300 es
precision highp float;
in vec2 vLocal;

uniform sampler2D uText;
uniform float uTime;
uniform float uSpin;
uniform float uTilt;
uniform float uWobble;
uniform float uWobScale;
uniform float uWobSpeed;
uniform float uSwirl;
uniform float uInk;
uniform float uEdgeInk;
uniform float uThrough;
uniform float uGrain;
uniform vec3  uOrb;
uniform vec3  uType;

out vec4 fragColor;
const float PI = 3.14159265359;
${NOISE}

float vnoise3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = i.xy + vec2(37.0, 17.0) * i.z + f.xy;
  float a = hash21(uv), b = hash21(uv + vec2(1,0));
  float c = hash21(uv + vec2(0,1)), d = hash21(uv + vec2(1,1));
  float n0 = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  vec2 uv2 = uv + vec2(37.0, 17.0);
  float a2 = hash21(uv2), b2 = hash21(uv2 + vec2(1,0));
  float c2 = hash21(uv2 + vec2(0,1)), d2 = hash21(uv2 + vec2(1,1));
  float n1 = mix(mix(a2, b2, f.x), mix(c2, d2, f.x), f.y);
  return mix(n0, n1, f.z);
}
float fbm3(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++){ s += a * vnoise3(p); p *= 2.02; a *= 0.5; }
  return s;
}
mat3 rotY(float t){ float c = cos(t), s = sin(t); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotX(float t){ float c = cos(t), s = sin(t); return mat3(1,0,0, 0,c,s, 0,-s,c); }

void main(){
  vec2 L = vec2(vLocal.x, -vLocal.y);    // the vertex stage flipped Y, undo it here
  float r = length(L);
  float aa = fwidth(r) * 1.5;            // outside the branch, where it is defined
  if (r > 1.0 + aa) discard;

  float z = sqrt(max(1.0 - min(r, 1.0) * min(r, 1.0), 0.0));
  vec3 n = normalize(vec3(L, z));
  vec3 sn = rotX(uTilt) * rotY(uSpin) * n;

  float grazing = 1.0 - z;
  float rim = grazing * grazing;

  vec3 w = sn * uWobScale + vec3(0.0, 0.0, uTime * uWobSpeed);
  float wx = fbm3(w) - 0.5;
  float wy = fbm3(w + vec3(19.3, 7.1, 4.2)) - 0.5;
  float swirl = (fbm3(sn * 1.3 + vec3(0.0, 0.0, uTime * 0.13)) - 0.5) * uSwirl * rim;
  float cs = cos(swirl), ss = sin(swirl);
  vec3 sw = vec3(sn.x * cs - sn.z * ss, sn.y, sn.x * ss + sn.z * cs);
  vec3 nf = normalize(sw + vec3(wx, wy, 0.0) * uWobble * (0.06 + 2.4 * rim));

  vec2 duv = vec2(0.0015 + 0.03 * rim, 0.0);
  float lod = log2(1.0 + rim * 26.0);     // explicit, so no derivative is needed

  float inkF = 0.0, inkB = 0.0;
  for (int i = -2; i <= 2; i++){
    float t = float(i) / 2.0;
    float uF = 0.75 - atan(nf.z, nf.x) / (2.0 * PI);
    float vF = acos(clamp(nf.y, -1.0, 1.0)) / PI;
    inkF += textureLod(uText, vec2(uF, vF) + duv * t, lod).r;
    vec3 nb = vec3(nf.x, nf.y, -nf.z);
    float uB = 0.75 - atan(nb.z, nb.x) / (2.0 * PI);
    float vB = acos(clamp(nb.y, -1.0, 1.0)) / PI;
    inkB += textureLod(uText, vec2(uB, vB) + duv * t, lod + 0.6).r;
  }
  inkF /= 5.0; inkB /= 5.0;

  float through = uThrough * smoothstep(0.15, 0.95, grazing);
  float ink = clamp(inkF * (uInk + uEdgeInk * grazing) + inkB * through, 0.0, 1.0);

  vec3 col = mix(uOrb, uType, ink);
  col *= 1.0 + (hash21(L * 520.0) - 0.5) * uGrain;

  float cov = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  fragColor = vec4(col, cov);
}`;

// ------------------------------------------------------- ink bled on paper
// For the photograph and for the type. Both are the same physical event: a wet
// mark spreading into an absorbent sheet, losing its edge, blooming past where
// it was laid, and picking up the tooth of the paper as it goes.
export const FS_BLEED = `#version 300 es
precision highp float;
in vec2 vLocal;

uniform sampler2D uImage;
uniform float uTime;
uniform float uBleed;     // how far the mark creeps
uniform float uSoft;      // how much of its edge it has lost
uniform float uBloom;     // colour carrying past the edge
uniform float uPaper;     // tooth
uniform float uFade;      // how much the sheet eats the mark
uniform float uSat;
uniform vec3  uSheet;
uniform float uIsType;    // type keeps a harder edge than a photograph does
uniform float uHasAlpha;  // 1 when the source already carries its own coverage

out vec4 fragColor;
${NOISE}

void main(){
  vec2 uv = vLocal * 0.5 + 0.5;

  // the wet front is ragged, not round: fibre pulls it unevenly
  vec2 warp = vec2(fbm(uv * 7.0 + uTime * 0.02) - 0.5,
                   fbm(uv * 7.0 + 31.7 - uTime * 0.015) - 0.5) * uBleed;

  // Read the mark several times at widening radii. The far taps are what
  // carries colour past the edge, which is the bloom you get when a sheet
  // wicks faster than the ink dries.
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 12; i++){
    float fi = float(i);
    float a = fi * 2.399963;
    float rad = sqrt(fi / 12.0) * uSoft;
    vec2 o = vec2(cos(a), sin(a)) * rad;
    float w = 1.0 - fi / 16.0;
    acc += texture(uImage, uv + warp + o) * w;
    wsum += w;
  }
  vec4 src = acc / wsum;

  // a second, much wider read, only for the colour that has run
  vec4 wide = vec4(0.0);
  for (int i = 0; i < 8; i++){
    float fi = float(i);
    float a = fi * 2.399963 + 0.7;
    vec2 o = vec2(cos(a), sin(a)) * uSoft * 3.2;
    wide += texture(uImage, uv + warp + o);
  }
  wide /= 8.0;

  vec3 mark = mix(src.rgb, wide.rgb, uBloom * (1.0 - src.a) * 0.9);
  float amt = clamp(src.a + wide.a * uBloom * 0.55, 0.0, 1.0);

  // type stays crisper than a photograph: less ink, less water
  amt = mix(amt, smoothstep(0.35, 0.62, amt), uIsType);

  // A photograph has no alpha of its own, so its coverage is the square it was
  // laid down as, with a soft irregular edge: ink does not stop at a ruled line,
  // it feathers into the fibre.
  if (uHasAlpha < 0.5) {
    vec2 d = abs(vLocal) ;
    float edge = max(d.x, d.y);
    float ragged = (fbm(uv * 9.0 + 4.3) - 0.5) * 0.10;
    amt = 1.0 - smoothstep(0.72 + ragged, 0.99 + ragged, edge);
  }

  // the tooth of the board shows through the mark
  float tooth = (fbm(uv * 190.0) - 0.5) * uPaper;

  // pigment sinks in and loses some of itself to the fibre
  vec3 lost = mix(vec3(dot(mark, vec3(0.299, 0.587, 0.114))), mark, uSat);
  lost *= 1.0 + tooth * 0.5;

  float cov = clamp(amt * uFade, 0.0, 1.0);
  fragColor = vec4(lost, cov);
}`;
