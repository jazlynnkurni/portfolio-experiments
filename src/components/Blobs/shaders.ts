// A metaball field, rendered as an implicit surface, then thrown away to one bit.
//
// Three things make the reference look the way it does, and they are separable:
//
//   THE SHAPE is a summed radial field, f(p) = sum of w·r²/|p−c|², with the
//   surface at f = 1. Not a union of circles. You can tell from the two hooks,
//   the concave notch on the right of the upper cluster and its mirror at the
//   lower left: a union of circles meets in a sharp cusp there, and only a
//   summed field pinches into that S. The 1/d² kernel has no compact support,
//   so distant balls still pull on each other, which is what draws the long
//   necks rather than letting lobes touch and stop.
//
//   THE SHADING is rim light on that surface. Every lobe in the reference is
//   brightest around its perimeter and darkest through the middle, which is the
//   opposite of what a front lit sphere does. So the tone is not the field
//   value, it is the field GRADIENT: pow(1 − n.z, k), where n comes from the
//   slope of the surface. That also explains the bright seams where two lobes
//   meet, since the surface is at its most steeply curved exactly there.
//
//   THE GRAIN is an ordered dither, not noise. Solid white in the brights, a
//   regular checkerboard through the mids, sparse dots in the darks, all on an
//   axis aligned periodic grid: that is a Bayer matrix. The dots are several
//   screen pixels across, so it is evaluated on a coarse grid of its own rather
//   than per pixel, which is also why the background bands into faint quadrants
//   where the matrix tiles.

export const MAX_BALLS = 64;

export const VS_QUAD = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FS_BLOBS = `#version 300 es
precision highp float;
in vec2 vUv;

uniform vec2  uRes;
uniform float uAspect;      // plate height over width
uniform vec4  uBalls[${MAX_BALLS}];   // xy centre, z radius, w strength
uniform int   uCount;
uniform float uRim;
uniform float uReach;
uniform float uThresh;
uniform float uGain;
uniform float uFillIn;
uniform float uPixel;
uniform float uLevels;
uniform float uPlate;
uniform float uGrad;
uniform vec2  uInset;
out vec4 fragColor;

// The field and its gradient in ONE pass, analytically. Sampling the field five
// times to difference it costs five times the loop and is the obvious way to
// write this; the derivative of a sum of 1/d² terms is just another sum, so
// there is no reason to pay for it.
void fieldAndGrad(vec2 p, out float f, out vec2 g){
  f = 0.0;
  g = vec2(0.0);
  for (int i = 0; i < ${MAX_BALLS}; i++){
    if (i >= uCount) break;
    vec4 b = uBalls[i];
    if (b.z <= 0.0) continue;
    vec2 d = p - b.xy;
    float r2 = dot(d, d);
    // Wyvill's kernel, with COMPACT support, not 1/d².
    //
    // The inverse square kernel is the textbook metaball and it is wrong for
    // this: it never reaches zero, so every lobe pulls on every other lobe
    // across the whole plate and the counters of the letters fill in. The
    // reference keeps its lobes plainly distinct with deep notches between
    // them, which only happens if a ball stops having any influence at all
    // past a certain distance. This one dies exactly at R.
    // Wyvill's kernel, with COMPACT support, not 1/d².
    //
    // The inverse square kernel is the textbook metaball and it is wrong for
    // this: it never reaches zero, so every lobe pulls on every other lobe
    // across the whole plate and the counters of the letters fill in. The
    // reference keeps its lobes plainly distinct with deep notches between
    // them, which only happens if a ball stops having any influence at all
    // past a certain distance. This one dies exactly at R.
    float R = b.z * uReach;
    float q = clamp(1.0 - r2 / (R * R), 0.0, 1.0);
    float q2 = q * q;
    f += b.w * q2 * q;
    g += b.w * 3.0 * q2 * (-2.0 * d / (R * R));
  }
}

// Bayer, built by recursion rather than carried as a table. Each level adds two
// bits of ordering at half the scale, which is exactly what the matrix is.
// FOUR, not eight. Measured off the reference by self differencing a mid tone
// patch: the error collapses at a shift of exactly 4 pixels and again at 8, so
// the matrix period is 4 and the cell is one pixel of its 640.
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void main(){
  // plate space: x from 0 to 1, y from 0 to uAspect, so a radius is a radius
  vec2 p = vec2(vUv.x, (1.0 - vUv.y) * uAspect);

  float f;
  vec2 g;
  fieldAndGrad(p, f, g);

  // How far inside the surface this pixel is, in plate units.
  //
  // (f - 1) on its own is not a distance: the field climbs like 1/d², so it is
  // worth wildly different amounts in a thin neck and in the middle of a big
  // lobe. Dividing by the length of the gradient is the first order distance
  // to the isosurface, and it IS in plate units, which means one number for
  // the width of the bright edge works everywhere on the letter.
  //
  // Two earlier attempts drove the tone off the surface normal instead. Both
  // failed for the same reason from opposite ends: the slope of the field has
  // no natural scale, so whatever constant it was multiplied by either left
  // every normal pointing at the camera (no rim at all, and the body term
  // showing through bright in the middle of each lobe) or tipped every normal
  // flat (rim saturated, the whole letter solid white).
  float inside = f - uThresh;
  float dist = inside / (length(g) + 1e-5);

  // bright just inside the outline, falling to the body tone further in
  float rim = uGain * exp(-max(dist, 0.0) / max(uRim, 1e-4));
  float body = uFillIn;
  float tone = (rim + body) * step(0.0, inside);

  // the plate: a dark ground with a slow gradient across it, which is what the
  // dither breaks into those faint quadrants. Everything lives on it, and the
  // surround is true black.
  float vign = 1.0 - uGrad * pow(length(vUv - 0.5) * 1.414, 2.0);
  vec2 edge = abs(vUv - 0.5) - (0.5 - uInset);
  float onPlate = step(max(edge.x, edge.y), 0.0);
  tone = max(tone, uPlate * vign) * onPlate;

  // ---- one bit, on its own coarse grid ----
  vec2 cell = floor(gl_FragCoord.xy / max(uPixel, 1.0));
  float t = bayer4(cell);
  float q = max(uLevels, 1.0);
  float v = floor(clamp(tone, 0.0, 1.0) * q + t) / q;

  fragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}`;
