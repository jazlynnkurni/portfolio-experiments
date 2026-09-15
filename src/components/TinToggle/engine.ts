import { VS_QUAD, FS_TOGGLE } from "./shaders";

export type ToggleParams = {
  press: number;
  hammer: number;
  rough: number;
  tarnish: number;
  exposure: number;
  sunHeight: number;
  shadow: number;
  stiffness: number;
};

export const DEFAULT_PARAMS: ToggleParams = {
  press: 0.55,
  hammer: 0.7,
  rough: 0.24,
  tarnish: 0.20,
  exposure: 0.92,
  sunHeight: 0.62,
  shadow: 0.85,
  stiffness: 150,
};

export type ToggleHandle = {
  params: ToggleParams;
  set: (on: boolean) => void;
  dispose: () => void;
};

type Options = {
  params?: ToggleParams;
  onChange?: (on: boolean) => void;
  onError?: (message: string) => void;
};

export function startToggle(cvs: HTMLCanvasElement, opts: Options = {}): ToggleHandle {
  const onChange = opts.onChange ?? (() => {});
  const onError = opts.onError ?? (() => {});
  const P: ToggleParams = opts.params ?? { ...DEFAULT_PARAMS };

  const ctx = cvs.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: false });
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
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS_QUAD, "toggle vertex"));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS_TOGGLE, "toggle fragment"));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("toggle failed to link\n" + (gl.getProgramInfoLog(prog) ?? ""));
  }
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const u = (n: string) => (loc[n] ??= gl.getUniformLocation(prog, n));
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

  // The thumb is on a spring, so it overshoots a touch and settles, the way a
  // detented switch does.
  // ?on=1 starts it thrown, which is the only way to capture the far state
  // in a screenshot.
  let on = typeof location !== "undefined" && new URLSearchParams(location.search).get("on") === "1";
  let pos = on ? 1 : 0;      // 0 left, 1 right
  let vel = 0;

  const flip = (next: boolean) => {
    if (next === on) return;
    on = next;
    onChange(on);
  };

  const onDown = (e: PointerEvent) => {
    const r = cvs.getBoundingClientRect();
    flip(e.clientX - r.left > r.width * 0.5 ? true : false);
    cvs.setPointerCapture(e.pointerId);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(!on); }
    if (e.key === "ArrowLeft") flip(false);
    if (e.key === "ArrowRight") flip(true);
  };
  cvs.addEventListener("pointerdown", onDown);
  cvs.addEventListener("keydown", onKey);
  cvs.tabIndex = 0;
  cvs.style.cursor = "pointer";

  let raf = 0, stopped = false, last = performance.now(), t = 0;

  function frame(now: number) {
    if (stopped) return;
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
    t += dt;

    const target = on ? 1 : 0;
    const k = P.stiffness, c = 2 * Math.sqrt(k) * 0.72;
    vel += ((target - pos) * k - vel * c) * dt;
    pos += vel * dt;

    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(u("uRes"), W, H);
    gl.uniform1f(u("uT"), Math.max(-0.08, Math.min(1.08, pos)));
    gl.uniform1f(u("uPress"), P.press);
    gl.uniform1f(u("uHammer"), P.hammer);
    gl.uniform1f(u("uRough"), P.rough);
    gl.uniform1f(u("uTarnish"), P.tarnish);
    gl.uniform1f(u("uExposure"), P.exposure);
    gl.uniform1f(u("uSunHeight"), P.sunHeight);
    gl.uniform1f(u("uShadow"), P.shadow);
    gl.uniform1f(u("uTime"), t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    raf = requestAnimationFrame(frame);
  }

  // report where we begin, not only where we change to
  if (on) onChange(true);

  try { raf = requestAnimationFrame(frame); } catch (e) { onError(String(e)); }

  return {
    params: P,
    set(next: boolean) { flip(next); },
    dispose() {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ro?.disconnect();
      cvs.removeEventListener("pointerdown", onDown);
      cvs.removeEventListener("keydown", onKey);
    },
  };
}
