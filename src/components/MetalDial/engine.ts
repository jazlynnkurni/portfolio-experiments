// The dial: geometry, camera and the turn. The material lives in shaders.ts.

import { VS_DIAL, FS_DIAL, VS_SHADOW, FS_SHADOW } from "./shaders";

export type DialParams = {
  alongRough: number;
  acrossRough: number;
  grain: number;
  dish: number;
  anodise: number;
  exposure: number;
  drift: number;
  tilt: number;
};

export const DEFAULT_PARAMS: DialParams = {
  alongRough: 0.035,
  acrossRough: 0.34,
  grain: 0.17,
  dish: 0.1,
  anodise: 0,
  exposure: 0.72,
  drift: 0.05,
  tilt: 0.42,
};

export type DialHandle = {
  params: DialParams;
  dispose: () => void;
};

type Options = {
  params?: DialParams;
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
const R = 1.0;
const HALF_T = 0.115;      // half the thickness
const CHAMFER_W = 0.075;   // how far in from the rim the chamfer starts
const CHAMFER_D = 0.055;   // how far down it falls
const SEG = 256;

// A disc with a dished face, a rolled chamfer and a side wall. The chamfer is
// what sells the thickness: it is the band that catches a strip light and
// travels as the thing turns.
function buildDial() {
  const pos: number[] = [];
  const nrm: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];

  const rFace = R - CHAMFER_W;
  const zFace = HALF_T;
  const zCham = HALF_T - CHAMFER_D;

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, p: number) => {
    pos.push(x, y, z); nrm.push(nx, ny, nz); part.push(p);
    return pos.length / 3 - 1;
  };

  // face, as a fan from the centre
  const centre = push(0, 0, zFace, 0, 0, 1, 0);
  const faceRing: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    faceRing.push(push(Math.cos(a) * rFace, Math.sin(a) * rFace, zFace, 0, 0, 1, 0));
  }
  for (let i = 0; i < SEG; i++) idx.push(centre, faceRing[i], faceRing[i + 1]);

  // chamfer, its normal splitting the difference between up and outward
  const chamTop: number[] = [];
  const chamBot: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    const nx = cx * 0.72, ny = cy * 0.72, nz = 0.70;
    const l = Math.hypot(nx, ny, nz);
    chamTop.push(push(cx * rFace, cy * rFace, zFace, nx / l, ny / l, nz / l, 1));
    chamBot.push(push(cx * R, cy * R, zCham, nx / l, ny / l, nz / l, 1));
  }
  for (let i = 0; i < SEG; i++) {
    idx.push(chamTop[i], chamBot[i], chamTop[i + 1]);
    idx.push(chamTop[i + 1], chamBot[i], chamBot[i + 1]);
  }

  // side wall
  const sideTop: number[] = [];
  const sideBot: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    sideTop.push(push(cx * R, cy * R, zCham, cx, cy, 0, 2));
    sideBot.push(push(cx * R, cy * R, -HALF_T, cx, cy, 0, 2));
  }
  for (let i = 0; i < SEG; i++) {
    idx.push(sideTop[i], sideBot[i], sideTop[i + 1]);
    idx.push(sideTop[i + 1], sideBot[i], sideBot[i + 1]);
  }

  return {
    pos: new Float32Array(pos),
    nrm: new Float32Array(nrm),
    part: new Float32Array(part),
    idx: new Uint32Array(idx),
  };
}

// ---------------------------------------------------------------- engine
export function startDial(cvs: HTMLCanvasElement, opts: Options = {}): DialHandle {
  const onError = opts.onError ?? (() => {});
  const onFirstTouch = opts.onFirstTouch ?? (() => {});
  const P: DialParams = opts.params ?? { ...DEFAULT_PARAMS };

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

  const progDial = program(VS_DIAL, FS_DIAL, "dial");
  const progShadow = program(VS_SHADOW, FS_SHADOW, "shadow");

  const mesh = buildDial();
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

  const shadowVao = gl.createVertexArray()!;
  gl.bindVertexArray(shadowVao);
  const sb = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, sb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
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

  // ---------------------------------------------------------- the turn
  let spin = 0;
  let spinVel = 0;
  let dragging = false;
  let lastAngle = 0;

  const angleAt = (e: PointerEvent) => {
    const r = cvs.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };

  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastAngle = angleAt(e);
    spinVel = 0;
    cvs.setPointerCapture(e.pointerId);
    cvs.style.cursor = "grabbing";
    onFirstTouch();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const a = angleAt(e);
    let d = a - lastAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    spin -= d;
    spinVel = -d * 60;
    lastAngle = a;
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { cvs.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    cvs.style.cursor = "grab";
  };
  cvs.addEventListener("pointerdown", onDown);
  cvs.addEventListener("pointermove", onMove);
  cvs.addEventListener("pointerup", onUp);
  cvs.addEventListener("pointercancel", onUp);
  cvs.style.cursor = "grab";

  // ---------------------------------------------------------- the loop
  let raf = 0;
  let stopped = false;
  let last = performance.now();
  let lightSpin = 0;

  function frame(now: number) {
    if (stopped) return;
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

    if (!dragging) {
      // let it coast, the way a weighted dial does
      spin += spinVel * dt;
      spinVel *= Math.exp(-dt * 1.9);
      if (Math.abs(spinVel) < 0.02) spinVel = 0;
    }
    // the room turns very slowly even when the dial is still, so the bowtie
    // is never completely dead
    lightSpin += dt * P.drift;

    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const aspect = W / Math.max(1, H);
    const dist = 4.2;
    const proj = perspective(0.62, aspect, 0.1, 40);
    const view = lookAt([0, 0, dist], [0, 0, 0], [0, 1, 0]);
    const viewProj = mul(proj, view);
    const model = mul(rotX(-P.tilt), rotZ(spin));

    // shadow first, under everything
    gl.depthMask(false);
    gl.useProgram(progShadow);
    gl.uniformMatrix4fv(progShadow.u.uViewProj, false, mul(viewProj, rotX(-P.tilt)));
    gl.uniform1f(progShadow.u.uSpread, R * 1.9);
    gl.uniform1f(progShadow.u.uDark, 0.5);
    gl.bindVertexArray(shadowVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.depthMask(true);

    gl.useProgram(progDial);
    gl.uniformMatrix4fv(progDial.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(progDial.u.uModel, false, model);
    gl.uniformMatrix3fv(progDial.u.uNormalMat, false, normalMat(model));
    gl.uniform3f(progDial.u.uCam, 0, 0, dist);
    gl.uniform1f(progDial.u.uRadius, R);
    gl.uniform1f(progDial.u.uSpin, 0);
    gl.uniform1f(progDial.u.uAlongRough, P.alongRough);
    gl.uniform1f(progDial.u.uAcrossRough, P.acrossRough);
    gl.uniform1f(progDial.u.uGrain, P.grain);
    gl.uniform1f(progDial.u.uDish, P.dish);
    gl.uniform1f(progDial.u.uAnodise, P.anodise);
    gl.uniform3f(progDial.u.uTint, 0.62, 0.66, 0.78);
    gl.uniform1f(progDial.u.uExposure, P.exposure);
    gl.uniform1f(progDial.u.uLightSpin, lightSpin);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_INT, 0);

    raf = requestAnimationFrame(frame);
  }

  try {
    raf = requestAnimationFrame(frame);
  } catch (e) {
    onError(String(e));
  }

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
