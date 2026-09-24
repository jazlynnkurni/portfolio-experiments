/**
 * The lighting layer for Butter side up.
 *
 * Everything that makes paint look thick happens here. The three 2D canvases
 * underneath carry no shading at all: the collage ground, the knife paint on
 * its own transparent sheet above it, and THICKNESS as a greyscale height
 * field. This shader turns that height into a surface normal and rakes a light
 * across it.
 *
 * Keeping the paint off the ground rather than painted into it is what makes
 * the knife reversible. Scraping is then one destination-out pass on the paint
 * and the height, and the collage underneath is simply uncovered again,
 * because it was never touched.
 *
 * That is the whole trick, and it is why an impasto filter painted as a
 * texture never convinces. Thick paint does not read as thick because it is
 * lighter or darker. It reads as thick because each ridge is lit on the side
 * facing the window and shadowed on the side facing away, and because the
 * furrows between ridges are occluded and go dull. Give a fragment the local
 * gradient of the height field and all of that falls out for free, from one
 * light vector.
 *
 * Four things on top of the basic relief, each answering something visible in
 * a real smear of butter:
 *   1. cavity shading. A furrow sitting below its neighbourhood catches less
 *      of the room, so it darkens independently of which way it faces. Without
 *      it the comb marks look embossed rather than dug.
 *   2. the crumb's own relief, taken from the luminance gradient of the bread
 *      canvas, so every pore is a real dimple lit by the same lamp, and butter
 *      dragged over it genuinely fills them in.
 *   3. SUBSURFACE. Butter is translucent, so the thin places at the edge of a
 *      smear pass light and glow warm, while the thick places do not. That one
 *      term is the difference between butter and yellow plastic, and it is why
 *      a hard specular has to stay out of it.
 *   4. a warm highlight and a cool shadow, because a neutral grey ramp is the
 *      single biggest tell of a fake.
 *
 * Raw WebGL1, GLSL ES 1.00, no dependencies.
 */

export type ImpastoFrame = {
  time: number;
  /** 0..1 master texture amount */
  grain: number;
  /** relief strength, how steep the paint stands */
  relief: number;
};

export type ImpastoLayer = {
  render: (frame: ImpastoFrame) => void;
  /** re-upload the ground. it only changes when the canvas is re-prepared */
  touchGround: () => void;
  /** re-upload the paint and height sheets, after the knife has been through */
  touchPaint: () => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

const TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

const VERTEX_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  // both sources upload flipped, so uv is y up and +y is up on screen
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uGround;
uniform sampler2D uPaint;
uniform sampler2D uHeight;
uniform vec2 uResolution;
uniform float uTime;
uniform float uGrain;
uniform float uRelief;

/* raking from the upper left, the way a canvas is lit off a window */
const vec3 LIGHT = vec3(-0.58, 0.60, 0.55);
const vec3 LUMA = vec3(0.299, 0.587, 0.114);

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  return vnoise(p) * 0.6 + vnoise(p * 2.13 + 11.7) * 0.28 +
         vnoise(p * 4.31 + 27.1) * 0.12;
}

float H(vec2 uv) {
  return texture2D(uHeight, uv).r;
}

void main() {
  vec2 uv = vUv;
  vec2 px = gl_FragCoord.xy;
  vec2 t = 1.0 / max(uResolution, vec2(1.0));

  float h = H(uv);

  // 1. relief, differenced over a WIDE baseline. This is the single most
  // important number in the file. Canvas strokes leave the height field full
  // of one pixel cliffs, and a gradient taken across one texel turns every one
  // of them into a vertical lit wall, which is why a naive version of this
  // reads as corrugated plastic rather than as paint. Sampling three texels
  // out low passes the field: a cliff still shows, but spread over a soft band
  // the width of the baseline, which is what a ridge of paint actually is.
  vec2 d = t * 1.7;
  float hl = H(uv - vec2(d.x, 0.0));
  float hr = H(uv + vec2(d.x, 0.0));
  float hdn = H(uv - vec2(0.0, d.y));
  float hup = H(uv + vec2(0.0, d.y));
  vec3 n = normalize(vec3((hl - hr) * uRelief, (hdn - hup) * uRelief, 1.0));

  float bare = 1.0 - smoothstep(0.03, 0.22, h);

  // 2. the collage has its own relief. a torn edge is a colour edge and a
  // height edge at the same time, so the ground's own luminance gradient is
  // enough to give every torn lip a lit side, with no second height map to
  // keep in step. it stops the moment paint covers it
  float gl0 = dot(texture2D(uGround, uv - vec2(d.x, 0.0)).rgb, LUMA);
  float gr0 = dot(texture2D(uGround, uv + vec2(d.x, 0.0)).rgb, LUMA);
  float gd0 = dot(texture2D(uGround, uv - vec2(0.0, d.y)).rgb, LUMA);
  float gu0 = dot(texture2D(uGround, uv + vec2(0.0, d.y)).rgb, LUMA);
  n = normalize(n + vec3(gl0 - gr0, gd0 - gu0, 0.0) * 0.42 * bare);

  // 3. tooth on the butter itself, so the smears are not glassy
  float tx = fbm(px * 0.42);
  float ty = fbm(px * 0.42 + vec2(19.7, 4.3));
  n = normalize(n + vec3((vec2(tx, ty) - 0.5) * 0.34 *
                         smoothstep(0.02, 0.3, h), 0.0));

  vec3 L = normalize(LIGHT);
  // wrapped rather than clamped at the terminator: butter is soft and the
  // light dies round its ridges gradually instead of stopping at ninety
  // degrees. this is most of the dreaminess
  float diff = clamp((dot(n, L) + 0.45) / 1.45, 0.0, 1.0);
  // the eye is straight on, so the specular lobe is just how far the mirror
  // direction has been tipped back toward the viewer
  vec3 refl = reflect(-L, n);
  // oil paint is matte. a tight bright lobe is what turns thick white into
  // crumpled foil, so the sheen here is low and broad, barely a gloss
  float spec = pow(max(refl.z, 0.0), 14.0);

  // 4. cavity shading. below the neighbourhood means dug in, means dull
  float wide = (H(uv + vec2(t.x * 5.0, 0.0)) + H(uv - vec2(t.x * 5.0, 0.0)) +
                H(uv + vec2(0.0, t.y * 5.0)) + H(uv - vec2(0.0, t.y * 5.0))) *
               0.25;
  float cavity = clamp(1.0 - max(wide - h, 0.0) * 3.0, 0.72, 1.0);

  vec4 laid = texture2D(uPaint, uv);
  vec3 base = mix(texture2D(uGround, uv).rgb, laid.rgb, laid.a);
  float paint = smoothstep(0.015, 0.16, h);

  // a narrow diffuse swing. this is a bright room, not a spotlight
  vec3 col = base * (0.86 + 0.28 * diff) * cavity;
  // the crests glint. this is the only place butter is allowed to be shiny
  col += spec * 0.2 * paint;

  // 5. subsurface. thin butter passes light and comes back warm, thick butter
  // does not, so the glow lives at the edges of a smear and in the furrows the
  // knife scraped nearly clean
  float thin = paint * (1.0 - smoothstep(0.06, 0.42, h));
  col += vec3(0.085, 0.062, 0.014) * thin;

  // 6. warm where the light lands, cool where it does not
  col += vec3(0.030, 0.016, -0.020) * diff * paint;
  col += vec3(-0.018, -0.010, 0.024) * (1.0 - diff) * paint;

  // 7. a soft bloom off the brightest butter, which is what makes a lit
  // object in a white room read as photographed rather than as drawn
  float lum = dot(col, LUMA);
  col += vec3(0.05, 0.045, 0.03) * smoothstep(0.78, 1.0, lum);

  // 8. the faintest grain, so the whole thing is not vector clean
  float seed = floor(uTime * 10.0);
  col += (hash21(px + seed * 41.7) - 0.5) * 0.018 * uGrain;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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

function makeTexture(
  gl: WebGLRenderingContext,
  unit: number,
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * Build the lighting layer over `canvas`, reading the collage from `ground`,
 * the knife paint from `paint` and its thickness from `height`. Returns null if
 * WebGL is missing or the program fails, so the caller can fall back to the
 * flat canvases. Never throws.
 */
export function createImpastoLayer(
  canvas: HTMLCanvasElement,
  ground: HTMLCanvasElement,
  paint: HTMLCanvasElement,
  height: HTMLCanvasElement,
): ImpastoLayer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: false,
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
  if (!buffer) {
    ctx.deleteProgram(program);
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

  ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, 1);
  const texGround = makeTexture(ctx, ctx.TEXTURE0);
  const texPaint = makeTexture(ctx, ctx.TEXTURE1);
  const texHeight = makeTexture(ctx, ctx.TEXTURE2);
  if (!texGround || !texPaint || !texHeight) {
    ctx.deleteProgram(program);
    ctx.deleteBuffer(buffer);
    if (texGround) ctx.deleteTexture(texGround);
    if (texPaint) ctx.deleteTexture(texPaint);
    if (texHeight) ctx.deleteTexture(texHeight);
    return null;
  }

  const uGround = ctx.getUniformLocation(program, "uGround");
  const uPaint = ctx.getUniformLocation(program, "uPaint");
  const uHeight = ctx.getUniformLocation(program, "uHeight");
  const uResolution = ctx.getUniformLocation(program, "uResolution");
  const uTime = ctx.getUniformLocation(program, "uTime");
  const uGrain = ctx.getUniformLocation(program, "uGrain");
  const uRelief = ctx.getUniformLocation(program, "uRelief");
  ctx.uniform1i(uGround, 0);
  ctx.uniform1i(uPaint, 1);
  ctx.uniform1i(uHeight, 2);

  // the sources are large and change only when someone paints, so they are
  // uploaded on demand rather than every frame
  let groundDirty = true;
  let paintDirty = true;
  let groundW = -1;
  let groundH = -1;
  let paintW = -1;
  let paintH = -1;
  let heightW = -1;
  let heightH = -1;
  let disposed = false;

  const upload = (
    unit: number,
    tex: WebGLTexture,
    src: HTMLCanvasElement,
    w: number,
    h: number,
  ): [number, number] => {
    ctx.activeTexture(unit);
    ctx.bindTexture(ctx.TEXTURE_2D, tex);
    if (src.width === w && src.height === h) {
      ctx.texSubImage2D(
        ctx.TEXTURE_2D,
        0,
        0,
        0,
        ctx.RGBA,
        ctx.UNSIGNED_BYTE,
        src,
      );
    } else {
      ctx.texImage2D(
        ctx.TEXTURE_2D,
        0,
        ctx.RGBA,
        ctx.RGBA,
        ctx.UNSIGNED_BYTE,
        src,
      );
    }
    return [src.width, src.height];
  };

  const render = (frame: ImpastoFrame): void => {
    if (disposed) return;
    if (canvas.width === 0 || canvas.height === 0) return;
    if (ground.width === 0 || paint.width === 0 || height.width === 0) return;

    if (groundDirty) {
      [groundW, groundH] = upload(
        ctx.TEXTURE0,
        texGround,
        ground,
        groundW,
        groundH,
      );
      groundDirty = false;
    }
    if (paintDirty) {
      [paintW, paintH] = upload(ctx.TEXTURE1, texPaint, paint, paintW, paintH);
      [heightW, heightH] = upload(
        ctx.TEXTURE2,
        texHeight,
        height,
        heightW,
        heightH,
      );
      paintDirty = false;
    }

    ctx.uniform2f(uResolution, canvas.width, canvas.height);
    ctx.uniform1f(uTime, frame.time);
    ctx.uniform1f(uGrain, frame.grain);
    ctx.uniform1f(uRelief, frame.relief);
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
  };

  const resize = (width: number, height2: number): void => {
    if (disposed) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height2));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.viewport(0, 0, w, h);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    ctx.deleteProgram(program);
    ctx.deleteBuffer(buffer);
    ctx.deleteTexture(texGround);
    ctx.deleteTexture(texPaint);
    ctx.deleteTexture(texHeight);
  };

  resize(canvas.width, canvas.height);

  return {
    render,
    touchGround: () => {
      groundDirty = true;
    },
    touchPaint: () => {
      paintDirty = true;
    },
    resize,
    dispose,
  };
}
