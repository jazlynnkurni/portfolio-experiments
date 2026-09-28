import { VS_QUAD, FS_BLOBS, MAX_BALLS } from "./shaders";
import { LETTERS, PLATE_ASPECT, matchOrder, type Disc } from "./letters";

export type BlobParams = {
  radius: number;
  knit: number;
  rim: number;
  reach: number;
  thresh: number;
  gain: number;
  fillIn: number;
  pixel: number;
  levels: number;
  plate: number;
  grad: number;
  hold: number;
  speed: number;
};

export const DEFAULT_PARAMS: BlobParams = {
  // where Jaz left the sliders
  radius: 0.84,
  reach: 2.35,
  thresh: 0.76,
  rim: 0.03,
  gain: 0.68,
  fillIn: 0.33,
  levels: 7,
  pixel: 0.5,
  plate: 0.16,
  grad: 0.22,
  hold: 0.28,
  speed: 0.6,
  knit: 0.14,
};

// Measured off the reference: four held frames, 24 apart, at 40ms each.
const BEAT = 0.96;

const PLATE_X = 0.195;
const PLATE_Y = 0.073;

type Extra = {
  x: number; y: number;
  vx: number; vy: number;
  r: number; want: number; w: number;
  held: boolean; popping: number;
};

export type BlobsHandle = { params: BlobParams; dispose: () => void };
type Options = { params?: BlobParams; onError?: (m: string) => void };

export function startBlobs(cvs: HTMLCanvasElement, opts: Options = {}): BlobsHandle {
  const onError = opts.onError ?? (() => {});
  const P: BlobParams = opts.params ?? { ...DEFAULT_PARAMS };

  const ctx = cvs.getContext("webgl2", { antialias: false, alpha: false });
  if (!ctx) throw new Error("this needs webgl2, and this browser did not give one up.");
  const gl = ctx;

  function compile(type: number, src: string, label: string) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(label + " failed to compile\n" + (gl.getShaderInfoLog(s) ?? ""));
    }
    return s;
  }
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS_QUAD, "blobs vertex"));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS_BLOBS, "blobs fragment"));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("blobs failed to link\n" + (gl.getProgramInfoLog(prog) ?? ""));
  }
  const cache: Record<string, WebGLUniformLocation | null> = {};
  const u = (n: string) => (cache[n] ??= gl.getUniformLocation(prog, n));
  const vao = gl.createVertexArray()!;

  let W = 0, H = 0;
  function resize() {
    const cw = Math.max(1, cvs.clientWidth), ch = Math.max(1, cvs.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (w === W && h === H) return;
    W = w; H = h; cvs.width = W; cvs.height = H;
    gl.viewport(0, 0, W, H);
  }
  resize();
  window.addEventListener("resize", resize);
  let ro: ResizeObserver | null = null;
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(cvs); }

  const N = LETTERS[0].length;
  const orders = LETTERS.map((a, i) => matchOrder(a, LETTERS[(i + 1) % LETTERS.length]));
  // when each letter disc was last knocked out, so it can swell back
  const muted = new Array<number>(N).fill(-99);

  const extras: Extra[] = [];
  const live: Disc[] = LETTERS[0].map((d) => [d[0], d[1], d[2]]);

  // ---- canvas space to plate space -------------------------------------
  // The letters live on the plate, not on the canvas, so everything the pointer
  // says has to be brought into the same frame the discs are written in.
  const toPlate = (ux: number, uy: number) => {
    const pw = 1 - PLATE_X * 2;
    const ph = 1 - PLATE_Y * 2;
    return { x: (ux - PLATE_X) / pw, y: ((uy - PLATE_Y) / ph) * PLATE_ASPECT };
  };
  const toUv = (px: number, py: number) => {
    const pw = 1 - PLATE_X * 2;
    const ph = 1 - PLATE_Y * 2;
    return { x: PLATE_X + px * pw, y: PLATE_Y + (py / PLATE_ASPECT) * ph };
  };

  const at = (e: PointerEvent) => {
    const r = cvs.getBoundingClientRect();
    const ux = (e.clientX - r.left) / Math.max(1, r.width);
    const uy = (e.clientY - r.top) / Math.max(1, r.height);
    return toPlate(ux, uy);
  };

  let head: Extra | null = null;
  let tail: Extra | null = null;
  let downAt = { x: 0, y: 0, t: 0 };
  let downLetter = -1;
  let downExtra: Extra | null = null;

  function hitLetter(x: number, y: number) {
    for (let i = 0; i < N; i++) {
      const d = live[i];
      if (Math.hypot(x - d[0], y - d[1]) < d[2] * P.radius * 1.5) return i;
    }
    return -1;
  }
  function hitExtra(x: number, y: number) {
    for (const e of extras) {
      if (e.popping > 0 || e.r <= 0) continue;
      if (Math.hypot(x - e.x, y - e.y) < e.r * 1.5) return e;
    }
    return null;
  }

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  // No shrapnel. A bubble arrives by swelling from nothing and leaves by
  // sinking back into nothing, and the field does the rest: a neighbour it was
  // merged with simply unsticks as it goes. Throwing droplets was a louder
  // event than this picture wants, and it read as debris rather than as
  // something going away.

  const onDown = (e: PointerEvent) => {
    const p = at(e);
    cvs.setPointerCapture(e.pointerId);
    downAt = { x: p.x, y: p.y, t: performance.now() };
    downExtra = hitExtra(p.x, p.y);
    downLetter = downExtra ? -1 : hitLetter(p.x, p.y);
    if (downExtra || downLetter >= 0) return;   // a tap on something is a pop

    if (extras.length + 2 > MAX_BALLS - N) return;
    // A press on bare plate starts a bubble as TWO sources: one left where the
    // finger landed, one under the finger. The neck between them is the field
    // doing its own work, not a shape anybody draws.
    tail = { x: p.x, y: p.y, vx: 0, vy: 0, r: 0.004, want: 0.05, w: 1,
             held: false, popping: 0 };
    head = { x: p.x, y: p.y, vx: 0, vy: 0, r: 0.004, want: 0.05, w: 1,
             held: true, popping: 0 };
    extras.push(tail, head);
  };

  const onMove = (e: PointerEvent) => {
    if (!head) return;
    const p = at(e);
    head.x = p.x; head.y = p.y;
    const d = Math.hypot(p.x - downAt.x, p.y - downAt.y);
    head.want = Math.min(0.13, 0.05 + d * 0.30);
    if (tail) tail.want = Math.min(0.11, 0.046 + d * 0.17);
  };

  const onUp = (e: PointerEvent) => {
    const p = at(e);
    const moved = Math.hypot(p.x - downAt.x, p.y - downAt.y);
    const quick = performance.now() - downAt.t < 350;

    if (quick && moved < 0.035) {
      if (downExtra) { downExtra.popping = 1e-4; }
      else if (downLetter >= 0) {
        muted[downLetter] = now01;
      }
    }

    if (head && tail) {
      // let go and it gathers itself. Area is conserved, so a long pull leaves
      // one big bubble rather than two thin ones.
      head.want = Math.sqrt(head.want * head.want + tail.want * tail.want);
      head.held = false;
      tail.want = 0; tail.popping = 1e-4;
    }
    head = null; tail = null; downExtra = null; downLetter = -1;
    try { cvs.releasePointerCapture(e.pointerId); } catch {}
  };

  cvs.addEventListener("pointerdown", onDown);
  cvs.addEventListener("pointermove", onMove);
  cvs.addEventListener("pointerup", onUp);
  cvs.addEventListener("pointercancel", onUp);

  // ------------------------------------------------------------------ frames
  const data = new Float32Array(MAX_BALLS * 4);
  let raf = 0, stopped = false, last = performance.now(), t = 0, now01 = 0;

  const ease = (k: number) => k * k * (3 - 2 * k);

  function letterStep() {
    const cycle = BEAT * LETTERS.length;
    const ph = ((t * P.speed) % cycle) / BEAT;
    const i = Math.floor(ph) % LETTERS.length;
    const j = (i + 1) % LETTERS.length;
    const k = ph - Math.floor(ph);
    // still for the first slice of the beat, then travel
    const hold = Math.min(0.6, Math.max(0, P.hold));
    const m = k < hold ? 0 : ease((k - hold) / (1 - hold));

    // Fatten everything slightly while it is in transit. Interpolating radius
    // straight from one letter to the next lets the mass come apart halfway
    // across, because discs are at their furthest from their neighbours exactly
    // when they are between two arrangements. A small bump at the midpoint,
    // gone by the time it arrives, keeps the field merged the whole way, which
    // is what makes the reference read as one thing pouring into the next shape
    // rather than as a set of circles relocating.
    const knit = 1.0 + P.knit * Math.sin(Math.PI * m);

    const a = LETTERS[i], b = LETTERS[j], ord = orders[i];
    for (let s = 0; s < N; s++) {
      const q = b[ord[s]];
      live[s][0] = a[s][0] + (q[0] - a[s][0]) * m;
      live[s][1] = a[s][1] + (q[1] - a[s][1]) * m;
      live[s][2] = (a[s][2] + (q[2] - a[s][2]) * m) * knit;
    }
  }

  function extrasStep(dt: number) {
    for (let i = extras.length - 1; i >= 0; i--) {
      const s = extras[i];
      if (s.popping > 0) {
        s.popping += dt;
        s.want = 0;
        if (s.popping > 0.5) { extras.splice(i, 1); continue; }
      }
      s.r += (s.want - s.r) * Math.min(1, dt * 9.0);
      if (s.r < 0.0015 && s.want === 0) { extras.splice(i, 1); continue; }
      if (s.held) continue;
      // left where it was put, drifting only a little
      s.x += Math.cos(t * 0.4 + s.r * 90) * 0.004 * dt;
      s.y += Math.sin(t * 0.33 + s.r * 70) * 0.004 * dt;
    }
  }

  function frame(nowMs: number) {
    if (stopped) return;
    let dt = (nowMs - last) / 1000; last = nowMs;
    if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
    t += dt; now01 = t;

    letterStep();
    extrasStep(dt);
    resize();

    data.fill(0);
    let n = 0;
    for (let i = 0; i < N && n < MAX_BALLS; i++) {
      const d = live[i];
      // a knocked out disc comes back on its own over about a second
      const since = t - muted[i];
      const back = since < 0 ? 1 : Math.min(1, since / 1.1);
      const r = d[2] * P.radius * (back * back);
      const uv = toUv(d[0], d[1]);
      // the shader works in (x, yDown * aspect), so everything is in units of
      // the canvas WIDTH and a radius means the same thing along both axes
      data[n * 4] = uv.x; data[n * 4 + 1] = uv.y * (H / W);
      data[n * 4 + 2] = r * (1 - PLATE_X * 2);
      data[n * 4 + 3] = 1;
      n++;
    }
    for (const s of extras) {
      if (n >= MAX_BALLS) break;
      const uv = toUv(s.x, s.y);
      data[n * 4] = uv.x; data[n * 4 + 1] = uv.y * (H / W);
      data[n * 4 + 2] = Math.max(0, s.r) * (1 - PLATE_X * 2);
      data[n * 4 + 3] = s.w;
      n++;
    }

    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(u("uRes"), W, H);
    gl.uniform1f(u("uAspect"), H / W);
    gl.uniform4fv(u("uBalls"), data);
    gl.uniform1i(u("uCount"), n);
    gl.uniform1f(u("uRim"), P.rim);
    gl.uniform1f(u("uReach"), P.reach);
    gl.uniform1f(u("uThresh"), P.thresh);
    gl.uniform1f(u("uGain"), P.gain);
    gl.uniform1f(u("uFillIn"), P.fillIn);
    // the reference's matrix is 4 pixels of a 640 wide frame, so the cell
    // tracks the canvas rather than sitting at a fixed number of device pixels
    gl.uniform1f(u("uPixel"), Math.max(1, (W / 640) * P.pixel));
    gl.uniform1f(u("uLevels"), P.levels);
    gl.uniform1f(u("uPlate"), P.plate);
    gl.uniform1f(u("uGrad"), P.grad);
    gl.uniform2f(u("uInset"), PLATE_X, PLATE_Y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

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
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
    },
  };
}
