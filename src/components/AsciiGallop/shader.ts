/**
 * WebGL post-processing layer for the AsciiGallop experiment.
 *
 * Takes the finished 2D ASCII canvas as a texture and pushes it through one
 * fragment shader that fakes a glitchy risograph print: rotated CMYK-ish
 * halftone screens, radial chromatic aberration, a magnifying cursor lens,
 * expanding click shockwaves, animated grain and a slow scanline wobble.
 *
 * Raw WebGL1 with GLSL ES 1.00, no dependencies, no React. The effect is
 * additive and zero-mean so it reads as printed texture rather than as a
 * darkening filter.
 */

/** One click shockwave. Position is uv 0..1 (origin top-left), age in seconds. */
export type ShaderRipple = { x: number; y: number; age: number };

export type ShaderFrame = {
  /** seconds since start */
  time: number;
  /** uv 0..1, origin top-left, y down */
  cursor: [number, number];
  /** 0 = pointer away, 1 = pointer over */
  cursorActive: number;
  /** click shockwaves, may be empty */
  ripples: ShaderRipple[];
  /** 0..1 master intensity for the whole effect */
  grain: number;
};

export type ShaderLayer = {
  render: (frame: ShaderFrame) => void;
  /** width and height in device pixels */
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

/** Fixed uniform array size, GLSL ES 1.00 needs a compile time bound. */
export const MAX_RIPPLES = 6;

/** Ripple ring speed in uv per second, and the age at which a ripple dies. */
const RIPPLE_SPEED = 0.55;
const RIPPLE_LIFE = 1.6;

/** Full screen triangle, so there is no seam down the diagonal of a quad. */
const TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

const VERTEX_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  // texture is uploaded with UNPACK_FLIP_Y_WEBGL, so uv is y up here
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uCursor;
uniform float uCursorActive;
uniform float uGrain;
uniform vec3 uRipples[${MAX_RIPPLES}];
uniform int uRippleCount;

const float PI = 3.14159265359;
const float RIPPLE_SPEED = ${RIPPLE_SPEED.toFixed(3)};
const float RIPPLE_LIFE = ${RIPPLE_LIFE.toFixed(3)};
const float LENS_RADIUS = 0.18;

/** Scale that turns uv deltas into square screen space, so circles are round. */
vec2 aspectScale() {
  return vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
}

vec2 rotate2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/** Rotate a colour around the grey axis, Rodrigues style. Cheap hue shift. */
vec3 hueShift(vec3 c, float a) {
  vec3 k = vec3(0.57735027);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec3 saturateBy(vec3 c, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, amt);
}

/** Signed screen wave in -1..1 for one rotated halftone grid. */
float printScreen(vec2 px, float angleDeg, float pitch) {
  vec2 r = rotate2(px, radians(angleDeg)) / pitch;
  return sin(r.x * PI) * sin(r.y * PI);
}

/**
 * Break one channel into dots. The midtone weight keeps solid ink and bare
 * paper untouched, so glyph edges stay crisp and average brightness holds.
 */
float inkChannel(float value, float dots, float amount) {
  float mid = 4.0 * value * (1.0 - value);
  return clamp(value + dots * amount * mid, 0.0, 1.0);
}

void main() {
  vec2 asp = aspectScale();
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec2 uv = vUv;

  // 5a. slow horizontal scanline wobble, a lazy press feeding paper crooked
  float wobble =
    sin(uv.y * 11.0 - uTime * 0.55) * 0.0018 +
    sin(uv.y * 97.0 + uTime * 1.9) * 0.0006;
  uv.x += wobble * uGrain;

  // 4. click shockwaves: displace radially, remember the band for recolouring
  float ringMask = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i < uRippleCount) {
      vec3 rip = uRipples[i];
      vec2 d = (uv - rip.xy) * asp;
      float dist = length(d);
      // the 2D pass grows the ring at 0.55 of the canvas WIDTH per second, so
      // scale into this height normalised space or the two rings drift apart
      float radius = rip.z * RIPPLE_SPEED * asp.x;
      float t = (dist - radius) / 0.035;
      float band = exp(-t * t);
      float fade = clamp(1.0 - rip.z / RIPPLE_LIFE, 0.0, 1.0);
      vec2 dir = d / max(dist, 1e-4);
      uv += (dir / asp) * band * fade * 0.013;
      ringMask += band * fade;
    }
  }
  ringMask = clamp(ringMask, 0.0, 1.0);

  // 3. cursor lens: contract the sample coords so the glyphs magnify outward
  vec2 toCursor = (uv - uCursor) * asp;
  float cursorDist = length(toCursor);
  // edge0 must stay below edge1 for smoothstep, so invert rather than swap
  float lens = (1.0 - smoothstep(0.0, LENS_RADIUS, cursorDist)) * uCursorActive;
  uv -= (toCursor / asp) * lens * 0.22;

  // 2. chromatic aberration along the radial direction, growing with distance
  vec2 focus = mix(vec2(0.5), uCursor, uCursorActive);
  vec2 fromFocus = (uv - focus) * asp;
  float focusDist = length(fromFocus);
  vec2 radial = fromFocus / max(focusDist, 1e-4);
  float pulse = 0.85 + 0.15 * sin(uTime * 1.3);
  float aberrPx = (0.6 + focusDist * 2.4) * pulse;
  // radial direction back in uv space, scaled to a couple of device pixels
  vec2 shift = (radial / asp) * texel * aberrPx;

  // 1. three rotated halftone screens, one per channel, ~4px pitch
  vec2 px = gl_FragCoord.xy;
  float pitch = 4.0;
  float amount = 0.20 * (0.55 + 0.45 * uGrain);

  float r = texture2D(uSource, uv + shift).r;
  float g = texture2D(uSource, uv).g;
  float b = texture2D(uSource, uv - shift).b;

  r = inkChannel(r, printScreen(px, 15.0, pitch), amount);
  g = inkChannel(g, printScreen(px, 75.0, pitch * 1.05), amount);
  b = inkChannel(b, printScreen(px, 0.0, pitch * 0.95), amount);

  vec3 color = vec3(r, g, b);

  // 3b. the lens also pushes saturation, so the print blooms under the pointer
  color = saturateBy(color, 1.0 + lens * 0.9);

  // 4b. invert and hue rotate inside the shockwave band
  vec3 flipped = hueShift(1.0 - color, 2.1);
  color = mix(color, flipped, ringMask * 0.65);

  // 5b. fine animated grain plus sparse RGB confetti misfires
  float seed = floor(uTime * 24.0);
  float mono = hash21(px + seed * 37.13) - 0.5;
  color += mono * 0.085 * uGrain;

  vec3 confetti = vec3(
    hash21(px + seed * 11.7),
    hash21(px + seed * 23.9 + 71.0),
    hash21(px + seed * 47.3 + 19.0)
  );
  float sparse = step(0.994, hash21(px * 0.5 + seed * 3.1));
  color += (confetti - 0.5) * sparse * 0.9 * uGrain;

  // 6. lift the mean back where it started so this reads as texture, not dirt
  color = clamp(color + 0.012 * uGrain, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`;

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // shaders are owned by the program once linked
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * Build the post-processing layer. Returns null when WebGL is unavailable or
 * the shader fails to build, so callers can fall back to the bare 2D canvas.
 * Never throws.
 */
export function createShaderLayer(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
): ShaderLayer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
  } catch {
    return null;
  }
  if (!gl) return null;
  const ctx = gl;

  const program = link(ctx);
  if (!program) return null;

  const buffer = ctx.createBuffer();
  const texture = ctx.createTexture();
  if (!buffer || !texture) {
    ctx.deleteProgram(program);
    if (buffer) ctx.deleteBuffer(buffer);
    if (texture) ctx.deleteTexture(texture);
    return null;
  }

  ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
  ctx.bufferData(ctx.ARRAY_BUFFER, TRIANGLE, ctx.STATIC_DRAW);

  ctx.useProgram(program);
  const aPosition = ctx.getAttribLocation(program, "aPosition");
  if (aPosition >= 0) {
    ctx.enableVertexAttribArray(aPosition);
    ctx.vertexAttribPointer(aPosition, 2, ctx.FLOAT, false, 0, 0);
  }

  const uSource = ctx.getUniformLocation(program, "uSource");
  const uResolution = ctx.getUniformLocation(program, "uResolution");
  const uTime = ctx.getUniformLocation(program, "uTime");
  const uCursor = ctx.getUniformLocation(program, "uCursor");
  const uCursorActive = ctx.getUniformLocation(program, "uCursorActive");
  const uGrain = ctx.getUniformLocation(program, "uGrain");
  // some drivers only answer to the bracketed name for array uniforms
  const uRipples =
    ctx.getUniformLocation(program, "uRipples") ??
    ctx.getUniformLocation(program, "uRipples[0]");
  const uRippleCount = ctx.getUniformLocation(program, "uRippleCount");

  // non power of two source, so nearest filtering, clamped edges, no mipmaps
  ctx.activeTexture(ctx.TEXTURE0);
  ctx.bindTexture(ctx.TEXTURE_2D, texture);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.NEAREST);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.NEAREST);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
  // sticky context state, so it applies to texImage2D and texSubImage2D alike
  ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, 1);
  ctx.uniform1i(uSource, 0);

  const rippleData = new Float32Array(MAX_RIPPLES * 3);
  // -1 forces the first upload down the allocating texImage2D path
  let texWidth = -1;
  let texHeight = -1;
  let disposed = false;

  const render = (frame: ShaderFrame): void => {
    if (disposed) return;
    if (source.width === 0 || source.height === 0) return;
    if (canvas.width === 0 || canvas.height === 0) return;

    // program, buffer, attribute and texture binding are set once at init and
    // nothing else touches this context, so only the pixels and uniforms move
    if (source.width === texWidth && source.height === texHeight) {
      // common case: same size every frame, so refill the existing storage
      ctx.texSubImage2D(
        ctx.TEXTURE_2D,
        0,
        0,
        0,
        ctx.RGBA,
        ctx.UNSIGNED_BYTE,
        source,
      );
    } else {
      ctx.texImage2D(
        ctx.TEXTURE_2D,
        0,
        ctx.RGBA,
        ctx.RGBA,
        ctx.UNSIGNED_BYTE,
        source,
      );
      texWidth = source.width;
      texHeight = source.height;
    }

    ctx.uniform2f(uResolution, canvas.width, canvas.height);
    ctx.uniform1f(uTime, frame.time);
    // incoming uv has y down, the flipped texture wants y up
    ctx.uniform2f(uCursor, frame.cursor[0], 1.0 - frame.cursor[1]);
    ctx.uniform1f(uCursorActive, frame.cursorActive);
    ctx.uniform1f(uGrain, frame.grain);

    let count = 0;
    for (let i = 0; i < frame.ripples.length && count < MAX_RIPPLES; i++) {
      const rip = frame.ripples[i];
      if (rip.age >= RIPPLE_LIFE) continue;
      rippleData[count * 3] = rip.x;
      rippleData[count * 3 + 1] = 1.0 - rip.y;
      rippleData[count * 3 + 2] = rip.age;
      count++;
    }
    for (let i = count; i < MAX_RIPPLES; i++) {
      rippleData[i * 3] = 0;
      rippleData[i * 3 + 1] = 0;
      rippleData[i * 3 + 2] = 0;
    }
    ctx.uniform3fv(uRipples, rippleData);
    ctx.uniform1i(uRippleCount, count);

    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
  };

  const resize = (width: number, height: number): void => {
    if (disposed) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.viewport(0, 0, w, h);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    // deliberately no WEBGL_lose_context here: a canvas element hands back the
    // same context object forever, and a simulated loss would only be undone by
    // restoreContext, so losing it would kill every later createShaderLayer on
    // this canvas (React StrictMode mounts twice in dev)
    ctx.deleteProgram(program);
    ctx.deleteBuffer(buffer);
    ctx.deleteTexture(texture);
  };

  resize(canvas.width, canvas.height);

  return { render, resize, dispose };
}
