// An orb with writing on it, turning.
//
// Drawn as a sphere rather than a circle with a warp painted on, because the
// thing that makes it read is genuine spherical foreshortening: a line of type
// crossing the middle is upright and evenly spaced, and as it turns away it
// compresses toward the silhouette and bends into an arc that follows the rim.
// That compression is not a curve you can fake convincingly by hand, it falls
// out of the projection.
//
// The liquid is a domain warp applied to the surface coordinate before the
// type is looked up, so the letters ripple as if printed on something that is
// still moving rather than on glass.

export const VS_QUAD = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FS_ORB = `#version 300 es
precision highp float;

in vec2 vUv;

uniform vec2  uRes;
uniform float uTime;
uniform mat3  uRot;       // where the ball has got to, as a frame
uniform float uWobble;    // how much the surface moves
uniform float uWobScale;
uniform float uWobSpeed;
uniform float uInk;       // how hard the type bites
uniform float uEdgeInk;   // extra smear toward the rim
uniform float uRadius;
uniform float uGrain;
uniform vec3  uPaper;
uniform vec3  uOrb;
uniform vec3  uType;
uniform float uThrough;   // how much of the far side shows
uniform float uSwirl;
uniform sampler2D uText;

out vec4 fragColor;

const float PI = 3.14159265359;

float hash21(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = i.xy + vec2(37.0, 17.0) * i.z + f.xy;
  float a = hash21(uv);
  float b = hash21(uv + vec2(1.0, 0.0));
  float c = hash21(uv + vec2(0.0, 1.0));
  float d = hash21(uv + vec2(1.0, 1.0));
  float n0 = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  vec2 uv2 = uv + vec2(37.0, 17.0);
  float a2 = hash21(uv2);
  float b2 = hash21(uv2 + vec2(1.0, 0.0));
  float c2 = hash21(uv2 + vec2(0.0, 1.0));
  float d2 = hash21(uv2 + vec2(1.0, 1.0));
  float n1 = mix(mix(a2, b2, f.x), mix(c2, d2, f.x), f.y);
  return mix(n0, n1, f.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++){ s += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return s;
}

void main(){
  vec2 p = (vUv * uRes - uRes * 0.5) / min(uRes.x, uRes.y) * 2.0;

  vec3 col = uPaper;
  float alpha = 0.0;

  float r = length(p) / uRadius;
  // taken outside the branch, where the derivative is defined
  float aa = fwidth(r) * 1.5;

  if (r <= 1.0){
    // Straight down the axis, so the silhouette is a true circle and the
    // foreshortening is the honest cosine one.
    float z = sqrt(max(1.0 - r * r, 0.0));
    vec3 n = normalize(vec3(p / uRadius, z));

    // turn the ball, not the type
    vec3 sn = uRot * n;

    // Liquid: the surface coordinate is pushed around before the type is read
    // off it, so the letters ride on something still settling. It builds
    // toward the rim, where a small push covers a lot of surface.
    float grazing = 1.0 - z;
    vec3 w = sn * uWobScale + vec3(0.0, 0.0, uTime * uWobSpeed);
    float wx = fbm(w) - 0.5;
    float wy = fbm(w + vec3(19.3, 7.1, 4.2)) - 0.5;

    // and a swirl about the axis, which is what drags the type into those long
    // arcs chasing the rim rather than merely rippling it
    float rim = grazing * grazing;
    float swirl = (fbm(sn * 1.3 + vec3(0.0, 0.0, uTime * 0.13)) - 0.5) * uSwirl * rim;
    float cs = cos(swirl), ss = sin(swirl);
    vec3 sw = vec3(sn.x * cs - sn.z * ss, sn.y, sn.x * ss + sn.z * cs);

    float amt = uWobble * (0.06 + 2.4 * rim);
    vec3 nf = normalize(sw + vec3(wx, wy, 0.0) * amt);

    // Reading the type off a surface coordinate, twice: once on the near face,
    // once on the far one. The ball passes enough light that the writing on the
    // back shows through, and because we see it from behind it arrives mirrored
    // and hugging the silhouette. That crowded rim is most of the character.
    vec2 duv = vec2(0.0015 + 0.03 * grazing * grazing, 0.0);
    // the surface runs away from us at the limb, so ask for a coarser level
    // there instead of letting the hardware guess from derivatives it does not
    // have
    float lod = log2(1.0 + grazing * grazing * 26.0);

    float inkF = 0.0;
    float inkB = 0.0;
    for (int i = -2; i <= 2; i++){
      float t = float(i) / 2.0;
      float uF = 0.75 - atan(nf.z, nf.x) / (2.0 * PI);
      float vF = acos(clamp(nf.y, -1.0, 1.0)) / PI;
      inkF += textureLod(uText, vec2(uF, vF) + duv * t, lod).r;

      // the same point on the far side of the ball
      vec3 nb = vec3(nf.x, nf.y, -nf.z);
      float uB = 0.75 - atan(nb.z, nb.x) / (2.0 * PI);
      float vB = acos(clamp(nb.y, -1.0, 1.0)) / PI;
      inkB += textureLod(uText, vec2(uB, vB) + duv * t, lod + 0.6).r;
    }
    inkF /= 5.0;
    inkB /= 5.0;

    // the far side reads strongest where the ball is thinnest to look through,
    // which is right at the edge
    float through = uThrough * smoothstep(0.15, 0.95, grazing);
    float ink = clamp(inkF * (uInk + uEdgeInk * grazing) + inkB * through, 0.0, 1.0);

    vec3 orb = mix(uOrb, uType, ink);

    // the print is not perfectly even, it has tooth
    orb *= 1.0 + (hash21(p * 520.0) - 0.5) * uGrain;

    float cov = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    col = mix(col, orb, cov);
    alpha = cov;
  }

  fragColor = vec4(col, max(alpha, 0.0));
}`;
