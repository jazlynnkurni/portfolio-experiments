import { VS_QUAD, FS_ORB } from "./shaders";

export type OrbParams = {
  speed: number;
  tilt: number;
  wobble: number;
  wobScale: number;
  wobSpeed: number;
  ink: number;
  edgeInk: number;
  radius: number;
  grain: number;
  through: number;
  swirl: number;
};

export const DEFAULT_PARAMS: OrbParams = {
  speed: 0.34,
  tilt: 0.12,
  wobble: 0.075,
  wobScale: 2.1,
  wobSpeed: 0.22,
  ink: 1.35,
  edgeInk: 0.55,
  radius: 0.92,
  grain: 0.05,
  through: 0.85,
  swirl: 0.9,
};

export type OrbHandle = {
  params: OrbParams;
  setLines: (lines: string[]) => void;
  dispose: () => void;
};

type Options = {
  params?: OrbParams;
  lines?: string[];
  onError?: (message: string) => void;
};

// The type is laid out on an equirectangular sheet, which is the surface the
// sphere reads from: x is longitude all the way round, y is pole to pole. Type
// is kept to a band either side of the equator, because anything near a pole
// gets wrung out into a spiral as the projection converges.
function drawText(lines: string[]): HTMLCanvasElement {
  const W = 2048, H = 1024;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;

  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";

  // one face of the ball is half the sheet, so the block is sized against that
  const faceW = W * 0.46;
  const blocks = lines.filter((l) => l.trim().length > 0);
  const lineH = H * 0.085;
  const top = H * 0.5 - ((blocks.length - 1) * lineH) / 2;

  blocks.forEach((line, i) => {
    let size = H * 0.075;
    g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    // shrink anything that would run off the visible face
    while (g.measureText(line).width > faceW && size > 12) {
      size *= 0.94;
      g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    }
    g.fillText(line, W * 0.5, top + i * lineH);
  });

  return cv;
}

export function startOrb(cvs: HTMLCanvasElement, opts: Options = {}): OrbHandle {
  const onError = opts.onError ?? (() => {});
  const P: OrbParams = opts.params ?? { ...DEFAULT_PARAMS };

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
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS_QUAD, "orb vertex"));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS_ORB, "orb fragment"));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("orb failed to link\n" + (gl.getProgramInfoLog(prog) ?? ""));
  }

  const loc: Record<string, WebGLUniformLocation | null> = {};
  const u = (n: string) => (loc[n] ??= gl.getUniformLocation(prog, n));
  const vao = gl.createVertexArray()!;

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // wrap in longitude so the type runs round without a seam, clamp pole to pole
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  function upload(lines: string[]) {
    const canvas = drawText(lines);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  upload(opts.lines ?? ["Yale Photo", "Lecture Series", "presents"]);

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

  // drag to turn it, and it keeps going when let go
  let spin = 0, spinVel = 0, dragging = false, lastX = 0;
  const onDown = (e: PointerEvent) => {
    dragging = true; lastX = e.clientX; spinVel = 0;
    cvs.setPointerCapture(e.pointerId);
    cvs.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const d = (e.clientX - lastX) * 0.008;
    spin -= d;
    spinVel = -d * 60;
    lastX = e.clientX;
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { cvs.releasePointerCapture(e.pointerId); } catch { /* gone */ }
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

    if (dragging) {
      // the hand has it
    } else {
      spin += (P.speed + spinVel) * dt;
      spinVel *= Math.exp(-dt * 1.6);
      if (Math.abs(spinVel) < 0.01) spinVel = 0;
    }

    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u("uText"), 0);
    gl.uniform2f(u("uRes"), W, H);
    gl.uniform1f(u("uTime"), t);
    gl.uniform1f(u("uSpin"), spin);
    gl.uniform1f(u("uTilt"), P.tilt);
    gl.uniform1f(u("uWobble"), P.wobble);
    gl.uniform1f(u("uWobScale"), P.wobScale);
    gl.uniform1f(u("uWobSpeed"), P.wobSpeed);
    gl.uniform1f(u("uInk"), P.ink);
    gl.uniform1f(u("uEdgeInk"), P.edgeInk);
    gl.uniform1f(u("uRadius"), P.radius);
    gl.uniform1f(u("uGrain"), P.grain);
    gl.uniform1f(u("uThrough"), P.through);
    gl.uniform1f(u("uSwirl"), P.swirl);
    gl.uniform3f(u("uPaper"), 1.0, 1.0, 1.0);
    gl.uniform3f(u("uOrb"), 0.93, 0.42, 0.09);
    gl.uniform3f(u("uType"), 0.06, 0.05, 0.05);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    raf = requestAnimationFrame(frame);
  }

  try { raf = requestAnimationFrame(frame); } catch (e) { onError(String(e)); }

  return {
    params: P,
    setLines(lines: string[]) { upload(lines); },
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
