// The dial: geometry, camera and the turn. The material lives in shaders.ts.

import { VS_TILE, FS_TILE } from "./shaders";

export type TinParams = {
  relief: number;
  hammer: number;
  rough: number;
  tarnish: number;
  exposure: number;
  drift: number;
  tilt: number;
  swing: number;
};

export const DEFAULT_PARAMS: TinParams = {
  relief: 0.035,
  hammer: 0.7,
  rough: 0.26,
  tarnish: 0.42,
  exposure: 0.66,
  drift: 0.06,
  tilt: 0.34,
  swing: 0.30,
};

export type TinHandle = {
  params: TinParams;
  dispose: () => void;
};

type Options = {
  params?: TinParams;
  onError?: (message: string) => void;
  onFirstTouch?: () => void;
};

// ---------------------------------------------------------------- matrices
function perspective(fov: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fov / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye: number[], at: number[], up: number[]) {
  const z = norm([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: number[], b: number[]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: number[]) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function mul(a: Float32Array, b: Float32Array) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  }
  return o;
}

function rotX(t: number) {
  const c = Math.cos(t), s = Math.sin(t);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
function rotZ(t: number) {
  const c = Math.cos(t), s = Math.sin(t);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// The rotation part of the model matrix, for normals. No non uniform scale
// here, so the matrix itself will do.
function normalMat(m: Float32Array) {
  return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
}

// ---------------------------------------------------------------- geometry
const S = 1.0;            // half width of the tile
const T = 0.055;          // half thickness

// A slab: the stamped face, and four sides so the sheet has an edge. The
// ornament lives in the height field, not in the mesh, but the slab is what
// gives the thing somewhere to be.
function buildSlab() {
  const pos: number[] = [];
  const nrm: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, p: number) => {
    pos.push(x, y, z); nrm.push(nx, ny, nz); part.push(p);
    return pos.length / 3 - 1;
  };

  // face, subdivided so the perspective stays honest across it
  const N = 2;
  const grid: number[][] = [];
  for (let j = 0; j <= N; j++) {
    const row: number[] = [];
    for (let i = 0; i <= N; i++) {
      row.push(push((i / N) * 2 * S - S, (j / N) * 2 * S - S, T, 0, 0, 1, 0));
    }
    grid.push(row);
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      idx.push(grid[j][i], grid[j][i + 1], grid[j + 1][i]);
      idx.push(grid[j + 1][i], grid[j][i + 1], grid[j + 1][i + 1]);
    }
  }

  // four sides
  const side = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
    const a = push(ax, ay, T, nx, ny, 0, 1);
    const b = push(bx, by, T, nx, ny, 0, 1);
    const c = push(ax, ay, -T, nx, ny, 0, 1);
    const d = push(bx, by, -T, nx, ny, 0, 1);
    idx.push(a, c, b, b, c, d);
  };
  side(-S, S, S, S, 0, 1);
  side(S, -S, -S, -S, 0, -1);
  side(S, S, S, -S, 1, 0);
  side(-S, -S, -S, S, -1, 0);

  return {
    pos: new Float32Array(pos),
    nrm: new Float32Array(nrm),
    part: new Float32Array(part),
    idx: new Uint32Array(idx),
  };
}

// ---------------------------------------------------------------- engine
export function startTin(cvs: HTMLCanvasElement, opts: Options = {}): TinHandle {
  const onError = opts.onError ?? (() => {});
  const onFirstTouch = opts.onFirstTouch ?? (() => {});
  const P: TinParams = opts.params ?? { ...DEFAULT_PARAMS };

  const ctx = cvs.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!ctx) throw new Error("this needs webgl2, and this browser did not give one up.");
  const gl = ctx;

  type Prog = WebGLProgram & { u: Record<string, WebGLUniformLocation | null> };

  function compile(type: number, src: string, label: string) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(label + " failed to compile\n" + (gl.getShaderInfoLog(s) ?? ""));
    }
    return s;
  }

  function program(vs: string, fs: string, label: string): Prog {
    const p = gl.createProgram() as Prog;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, label + " vertex"));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, label + " fragment"));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(label + " failed to link\n" + (gl.getProgramInfoLog(p) ?? ""));
    }
    const cache: Record<string, WebGLUniformLocation | null> = {};
    p.u = new Proxy(cache, {
      get: (store: Record<string, WebGLUniformLocation | null>, name: string | symbol) => {
        const key = String(name);
        if (!(key in store)) store[key] = gl.getUniformLocation(p, key);
        return store[key];
      },
    });
    return p;
  }

  const prog = program(VS_TILE, FS_TILE, "tile");
  const mesh = buildSlab();

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const attach = (data: Float32Array, loc: number, size: number) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  attach(mesh.pos, 0, 3);
  attach(mesh.nrm, 1, 3);
  attach(mesh.part, 2, 1);
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  let W = 0, H = 0;
  function resize() {
    const cw = Math.max(1, cvs.clientWidth);
    const ch = Math.max(1, cvs.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (w === W && h === H) return;
    W = w; H = h;
    cvs.width = W; cvs.height = H;
    gl.viewport(0, 0, W, H);
  }
  resize();
  window.addEventListener("resize", resize);
  let ro: ResizeObserver | null = null;
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(cvs); }

  // ---------------------------------------------------------- the tilt
  let yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0;
  let dragging = false, lastX = 0, lastY = 0;

  const onDown = (e: PointerEvent) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    cvs.setPointerCapture(e.pointerId);
    cvs.style.cursor = "grabbing";
    onFirstTouch();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    targetYaw += (e.clientX - lastX) * 0.006;
    targetPitch += (e.clientY - lastY) * 0.006;
    targetPitch = Math.max(-0.9, Math.min(0.9, targetPitch));
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { cvs.releasePointerCapture(e.pointerId); } catch { /* gone already */ }
    cvs.style.cursor = "grab";
  };
  cvs.addEventListener("pointerdown", onDown);
  cvs.addEventListener("pointermove", onMove);
  cvs.addEventListener("pointerup", onUp);
  cvs.addEventListener("pointercancel", onUp);
  cvs.style.cursor = "grab";

  let raf = 0, stopped = false, last = performance.now(), t = 0;

  function frame(now: number) {
    if (stopped) return;
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
    t += dt;

    // Idle, the panel rocks very slightly, which is the only way a still
    // image of a stamping shows you it is stamped.
    const idleYaw = Math.sin(t * 0.32) * P.swing;
    const idlePitch = Math.sin(t * 0.23 + 1.1) * P.swing * 0.45;
    const wantYaw = dragging ? targetYaw : targetYaw + idleYaw;
    const wantPitch = dragging ? targetPitch : targetPitch + idlePitch;
    yaw += (wantYaw - yaw) * Math.min(1, dt * 4.0);
    pitch += (wantPitch - pitch) * Math.min(1, dt * 4.0);

    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const aspect = W / Math.max(1, H);
    const dist = 4.0;
    const proj = perspective(0.62, aspect, 0.1, 40);
    const view = lookAt([0, 0, dist], [0, 0, 0], [0, 1, 0]);
    const viewProj = mul(proj, view);
    const model = mul(rotX(-P.tilt - pitch), rotZ(yaw));

    gl.useProgram(prog);
    gl.uniformMatrix4fv(prog.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(prog.u.uModel, false, model);
    gl.uniformMatrix3fv(prog.u.uNormalMat, false, normalMat(model));
    gl.uniformMatrix3fv(prog.u.uNormalRot, false, normalMat(model));
    gl.uniform3f(prog.u.uCam, 0, 0, dist);
    gl.uniform1f(prog.u.uRelief, P.relief);
    gl.uniform1f(prog.u.uHammer, P.hammer);
    gl.uniform1f(prog.u.uRough, P.rough);
    gl.uniform1f(prog.u.uTarnish, P.tarnish);
    gl.uniform1f(prog.u.uExposure, P.exposure);
    gl.uniform1f(prog.u.uLightSpin, t * P.drift);
    // The die is read by finite difference, so the step has to match how big
    // the tile actually lands on screen or the relief turns to mush.
    const px = 1.0 / Math.max(120.0, Math.min(W, H) * 0.62);
    gl.uniform2f(prog.u.uTexel, px, px);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_INT, 0);

    raf = requestAnimationFrame(frame);
  }

  try { raf = requestAnimationFrame(frame); } catch (e) { onError(String(e)); }

  return {
    params: P,
    dispose() {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ro?.disconnect();
      cvs.removeEventListener("pointerdown", onDown);
      cvs.removeEventListener("pointermove", onMove);
      cvs.removeEventListener("pointerup", onUp);
      cvs.removeEventListener("pointercancel", onUp);
    },
  };
}
