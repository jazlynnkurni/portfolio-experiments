/**
 * The print layer for Track record.
 *
 * The 2D plate underneath is only ink on paper: the track, the runner and her
 * ghosts, the type. Everything that makes this look like a physical object is
 * done here, in one fragment shader.
 *
 * The discs are NOT drawn on the 2D canvas and then blurred. They are solved
 * per pixel as translucent sheets and applied as a SUBTRACTIVE stack, which is
 * the one decision the whole look rests on. Laying tissue on tissue removes
 * light twice, so overlaps go darker and denser in a way that alpha blending
 * toward a flat colour never reproduces. On white paper that inverts the
 * reference print, where the same stack was additive on black, and it is why
 * the crossings read as a third colour rather than as a lighter version of
 * the second one.
 *
 * Three things sell a sheet as paper rather than as a circle:
 *   1. a torn deckle rim, angular noise on the radius, so no edge is a
 *      compass arc;
 *   2. cloudy mottle across the face, because tissue holds its pulp unevenly,
 *      plus a denser band at the rim where the sheet curls;
 *   3. per sheet misregistration, each disc offset a hair differently per
 *      channel, so the edges carry the colour fringe of a press that did not
 *      quite line its plates up.
 *
 * Raw WebGL1 and GLSL ES 1.00, no dependencies, so this ports as one file.
 */

/** A stamped sheet. Position and radius are in uv, y down, radius in height units. */
export type Sheet = {
  x: number;
  y: number;
  r: number;
  /** 0..1, how fully the sheet has settled onto the pile */
  fade: number;
  /** multiplier ink, 0..1 per channel */
  ink: [number, number, number];
};

export type SheetFrame = {
  time: number;
  sheets: Sheet[];
  /** 0..1 master texture amount */
  grain: number;
};

export type SheetLayer = {
  render: (frame: SheetFrame) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

/** Fixed array size, GLSL ES 1.00 needs a compile time loop bound. */
export const MAX_SHEETS = 16;

const TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

const VERTEX_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  // the source is uploaded flipped, so uv is y up from here on
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uAspect;
uniform float uTime;
uniform float uGrain;
uniform vec4 uSheets[${MAX_SHEETS}];
uniform vec3 uInks[${MAX_SHEETS}];
uniform int uSheetCount;

/**
 * Hoskins hash. The usual fract(p.x * p.y) one falls apart once the input is
 * in the hundreds, which gl_FragCoord always is: the product overflows the
 * mantissa and the "noise" comes back as vertical rules down the paper. This
 * one keeps every intermediate inside a unit cube, so it stays white.
 */
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

/** value noise, smoothed on the cell so the pulp has no grid in it */
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

/** two octaves is enough for pulp and keeps the sixteen sheet loop affordable */
float fbm(vec2 p) {
  return vnoise(p) * 0.65 + vnoise(p * 2.17 + 19.3) * 0.35;
}

/**
 * Coverage of one sheet at a given distance from its centre. Split out so the
 * three colour plates can be evaluated at three slightly different distances
 * without paying for the noise three times.
 */
float cover(float dist, float r, float feather, float mottle) {
  float body = 1.0 - smoothstep(r - feather, r + feather, dist);
  // the curled rim holds more pulp, so it prints denser than the face
  float rim = smoothstep(r - r * 0.075, r - r * 0.012, dist) * body;
  return clamp(body * mottle + rim * 0.34, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 px = gl_FragCoord.xy;
  vec2 asp = vec2(uAspect, 1.0);

  // the press feeds paper very slightly crooked
  uv.x += (sin(uv.y * 9.0 - uTime * 0.35) * 0.0011 +
           sin(uv.y * 71.0 + uTime * 1.4) * 0.0004) * uGrain;

  // 1. the plate. a touch of radial aberration, so the ink is not perfectly
  // registered against the paper either
  vec2 fromMid = (uv - vec2(0.5)) * asp;
  vec2 shift = fromMid / max(uResolution.y, 1.0) * (0.13 + uGrain * 0.22);
  vec3 col = vec3(
    texture2D(uSource, uv + shift).r,
    texture2D(uSource, uv).g,
    texture2D(uSource, uv - shift).b
  );

  // 2. the stack of sheets, oldest first, each one taking light out
  for (int i = 0; i < ${MAX_SHEETS}; i++) {
    if (i < uSheetCount) {
      vec4 s = uSheets[i];
      vec2 q = (uv - s.xy) * asp;
      float dist = length(q);
      // most pixels are outside most sheets, so reject before touching noise
      if (dist < s.z * 1.3) {
        float fi = float(i);
        vec2 seed = vec2(fi * 7.31, fi * 3.17 + 4.1);
        vec2 rim = q / max(dist, 1e-5);

        // torn edge: the radius wanders with the angle around the sheet
        float wob = fbm(rim * 2.6 + seed);
        float r = s.z * (0.975 + wob * 0.062);
        // a cut edge, not a fade. the softness has to come from the torn
        // radius above, otherwise the sheet reads as an airbrushed gradient
        float feather = s.z * 0.008 + 0.002;
        // a slow cloud for how the pulp settled, a fine tooth for the fibres
        // caught in it
        float mottle = 0.62 + 0.42 * fbm(q * 5.0 + seed * 2.3) +
                       0.16 * (vnoise(q * 85.0 + seed) - 0.5);

        // this sheet's plates are off by a hair, in its own direction
        float reg = dot(rim, vec2(cos(fi * 2.39), sin(fi * 1.73))) * 0.0016;

        vec3 c3 = vec3(
          cover(dist + reg, r, feather, mottle),
          cover(dist, r, feather, mottle),
          cover(dist - reg, r, feather, mottle)
        );

        c3 *= s.w;
        col *= mix(vec3(1.0), uInks[i], c3);
      }
    }
  }

  // 3. the paper itself: long fibres one way, a slow cloud in both
  float fibre = vnoise(vec2(px.x * 0.004, px.y * 0.35));
  float cloud = fbm(px * 0.008);
  col *= 1.0 - (fibre * 0.011 + cloud * 0.045) * uGrain;

  // 4. press grain, zero mean so this stays texture rather than dirt
  float seed = floor(uTime * 12.0);
  col += (hash21(px + seed * 37.13) - 0.5) * 0.055 * uGrain;

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

/**
 * Build the print layer over `canvas`, reading `source` as its plate. Returns
 * null when WebGL is missing or the program fails to build, so the caller can
 * fall back to showing the bare 2D plate. Never throws.
 */
export function createSheetLayer(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
): SheetLayer | null {
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
  const uAspect = ctx.getUniformLocation(program, "uAspect");
  const uTime = ctx.getUniformLocation(program, "uTime");
  const uGrain = ctx.getUniformLocation(program, "uGrain");
  // some drivers only answer to the bracketed name for array uniforms
  const uSheets =
    ctx.getUniformLocation(program, "uSheets") ??
    ctx.getUniformLocation(program, "uSheets[0]");
  const uInks =
    ctx.getUniformLocation(program, "uInks") ??
    ctx.getUniformLocation(program, "uInks[0]");
  const uSheetCount = ctx.getUniformLocation(program, "uSheetCount");

  ctx.activeTexture(ctx.TEXTURE0);
  ctx.bindTexture(ctx.TEXTURE_2D, texture);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
  ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, 1);
  ctx.uniform1i(uSource, 0);

  const sheetData = new Float32Array(MAX_SHEETS * 4);
  const inkData = new Float32Array(MAX_SHEETS * 3);
  let texWidth = -1;
  let texHeight = -1;
  let disposed = false;

  const render = (frame: SheetFrame): void => {
    if (disposed) return;
    if (source.width === 0 || source.height === 0) return;
    if (canvas.width === 0 || canvas.height === 0) return;

    if (source.width === texWidth && source.height === texHeight) {
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
    ctx.uniform1f(uAspect, canvas.width / Math.max(canvas.height, 1));
    ctx.uniform1f(uTime, frame.time);
    ctx.uniform1f(uGrain, frame.grain);

    let count = 0;
    for (let i = 0; i < frame.sheets.length && count < MAX_SHEETS; i++) {
      const s = frame.sheets[i];
      if (s.fade <= 0.001) continue;
      sheetData[count * 4] = s.x;
      sheetData[count * 4 + 1] = 1 - s.y;
      sheetData[count * 4 + 2] = s.r;
      sheetData[count * 4 + 3] = s.fade;
      inkData[count * 3] = s.ink[0];
      inkData[count * 3 + 1] = s.ink[1];
      inkData[count * 3 + 2] = s.ink[2];
      count++;
    }
    for (let i = count; i < MAX_SHEETS; i++) {
      sheetData[i * 4] = 0;
      sheetData[i * 4 + 1] = 0;
      sheetData[i * 4 + 2] = 0;
      sheetData[i * 4 + 3] = 0;
      inkData[i * 3] = 1;
      inkData[i * 3 + 1] = 1;
      inkData[i * 3 + 2] = 1;
    }
    ctx.uniform4fv(uSheets, sheetData);
    ctx.uniform3fv(uInks, inkData);
    ctx.uniform1i(uSheetCount, count);

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
    // no simulated context loss here: a canvas hands back the same context
    // forever, so losing it would break every later layer on this element
    ctx.deleteProgram(program);
    ctx.deleteBuffer(buffer);
    ctx.deleteTexture(texture);
  };

  resize(canvas.width, canvas.height);

  return { render, resize, dispose };
}
