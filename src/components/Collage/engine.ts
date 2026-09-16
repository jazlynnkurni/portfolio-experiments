import { VS_PIECE, FS_ORB, FS_BLEED } from "./shaders";
import { orbSheet, crossSheet } from "./textures";

export type PieceKind = "orb" | "cross" | "photo";

export type Piece = {
  id: string;
  kind: PieceKind;
  x: number;      // centre, in css pixels
  y: number;
  w: number;      // full size, css pixels
  h: number;
  rot: number;
};

export type CollageHandle = {
  pieces: Piece[];
  onChange: (fn: () => void) => void;
  bringToFront: (id: string) => void;
  dispose: () => void;
};

type Options = {
  onError?: (message: string) => void;
  onPick?: (id: string | null) => void;
};

const HANDLE = 15;   // corner grab area, css pixels

export function startCollage(cvs: HTMLCanvasElement, opts: Options = {}): CollageHandle {
  const onError = opts.onError ?? (() => {});
  const onPick = opts.onPick ?? (() => {});

  const ctx = cvs.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: false });
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
  function program(fs: string, label: string) {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS_PIECE, label + " vertex"));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, label + " fragment"));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(label + " failed to link\n" + (gl.getProgramInfoLog(p) ?? ""));
    }
    const cache: Record<string, WebGLUniformLocation | null> = {};
    return {
      program: p,
      u: (n: string) => (cache[n] ??= gl.getUniformLocation(p, n)),
    };
  }

  const progOrb = program(FS_ORB, "orb");
  const progBleed = program(FS_BLEED, "bleed");

  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  function makeTex(source: TexImageSource, mip: boolean) {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mip ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }

  const texOrb = makeTex(orbSheet([
    ["Yale Photo", "Pop Up", "Lecture Series", "presents"],
    ["JEFF WALL"],
    ["Monday", "April 26, 6pm"],
  ]), true);
  const texCross = makeTex(crossSheet("Agency", "Services", "#1a1ad0"), false);

  // the photograph arrives late, so the board draws without it until it lands
  let texPhoto: WebGLTexture | null = null;
  const img = new Image();
  img.onload = () => { texPhoto = makeTex(img, false); };
  img.onerror = () => onError("could not load /refs/sheep.jpg");
  img.src = "/refs/sheep.jpg";

  const pieces: Piece[] = [
    { id: "orb", kind: "orb", x: 300, y: 300, w: 300, h: 300, rot: 0 },
    { id: "photo", kind: "photo", x: 620, y: 360, w: 300, h: 300, rot: -0.04 },
    { id: "cross", kind: "cross", x: 430, y: 620, w: 340, h: 340, rot: 0.02 },
  ];

  let W = 0, H = 0, dpr = 1;
  function resize() {
    const cw = Math.max(1, cvs.clientWidth), ch = Math.max(1, cvs.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (w === W && h === H) return;
    W = w; H = h; cvs.width = W; cvs.height = H;
    gl.viewport(0, 0, W, H);
  }
  resize();
  window.addEventListener("resize", resize);
  let ro: ResizeObserver | null = null;
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(cvs); }

  // ---------------------------------------------------------------- picking
  let changed = () => {};

  function local(p: Piece, px: number, py: number) {
    const c = Math.cos(-p.rot), s = Math.sin(-p.rot);
    const dx = px - p.x, dy = py - p.y;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  function hit(px: number, py: number): { piece: Piece; corner: boolean } | null {
    // topmost first, which is the end of the list
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      const l = local(p, px, py);
      const hx = p.w / 2, hy = p.h / 2;
      if (Math.abs(l.x) <= hx + HANDLE && Math.abs(l.y) <= hy + HANDLE) {
        const corner = Math.abs(l.x) > hx - HANDLE && Math.abs(l.y) > hy - HANDLE;
        if (Math.abs(l.x) <= hx || Math.abs(l.y) <= hy || corner) {
          // the orb is round, so do not claim its empty corners
          if (p.kind === "orb" && !corner) {
            if ((l.x * l.x) / (hx * hx) + (l.y * l.y) / (hy * hy) > 1.0) continue;
          }
          return { piece: p, corner };
        }
      }
    }
    return null;
  }

  let drag: { piece: Piece; corner: boolean; ox: number; oy: number; w0: number; h0: number; d0: number } | null = null;

  const pt = (e: PointerEvent) => {
    const r = cvs.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    const { x, y } = pt(e);
    const h = hit(x, y);
    if (!h) { onPick(null); return; }
    // picked piece goes to the top of the pile
    const i = pieces.indexOf(h.piece);
    pieces.splice(i, 1);
    pieces.push(h.piece);
    onPick(h.piece.id);
    drag = {
      piece: h.piece,
      corner: h.corner,
      ox: x - h.piece.x,
      oy: y - h.piece.y,
      w0: h.piece.w,
      h0: h.piece.h,
      d0: Math.hypot(x - h.piece.x, y - h.piece.y) || 1,
    };
    cvs.setPointerCapture(e.pointerId);
    cvs.style.cursor = h.corner ? "nwse-resize" : "grabbing";
    changed();
  };

  const onMove = (e: PointerEvent) => {
    const { x, y } = pt(e);
    if (!drag) {
      const h = hit(x, y);
      cvs.style.cursor = h ? (h.corner ? "nwse-resize" : "grab") : "default";
      return;
    }
    if (drag.corner) {
      // scale about the centre, by how much further out the corner has gone
      const d = Math.hypot(x - drag.piece.x, y - drag.piece.y);
      const k = Math.max(0.15, d / drag.d0);
      drag.piece.w = Math.max(60, drag.w0 * k);
      drag.piece.h = Math.max(60, drag.h0 * k);
    } else {
      drag.piece.x = x - drag.ox;
      drag.piece.y = y - drag.oy;
    }
    changed();
  };

  const onUp = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    try { cvs.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    cvs.style.cursor = "default";
  };

  cvs.addEventListener("pointerdown", onDown);
  cvs.addEventListener("pointermove", onMove);
  cvs.addEventListener("pointerup", onUp);
  cvs.addEventListener("pointercancel", onUp);

  // ---------------------------------------------------------------- draw
  let raf = 0, stopped = false, last = performance.now(), t = 0;

  function setQuad(u: (n: string) => WebGLUniformLocation | null, p: Piece) {
    gl.uniform2f(u("uRes"), W, H);
    gl.uniform2f(u("uCentre"), p.x * dpr, p.y * dpr);
    gl.uniform2f(u("uSize"), (p.w / 2) * dpr, (p.h / 2) * dpr);
    gl.uniform1f(u("uRot"), p.rot);
  }

  function frame(now: number) {
    if (stopped) return;
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
    t += dt;

    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);

    for (const p of pieces) {
      if (p.kind === "orb") {
        const { program: pr, u } = progOrb;
        gl.useProgram(pr);
        setQuad(u, p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texOrb);
        gl.uniform1i(u("uText"), 0);
        gl.uniform1f(u("uTime"), t);
        gl.uniform1f(u("uSpin"), t * 0.34);
        gl.uniform1f(u("uTilt"), 0.12);
        gl.uniform1f(u("uWobble"), 0.075);
        gl.uniform1f(u("uWobScale"), 2.1);
        gl.uniform1f(u("uWobSpeed"), 0.22);
        gl.uniform1f(u("uSwirl"), 0.9);
        gl.uniform1f(u("uInk"), 1.35);
        gl.uniform1f(u("uEdgeInk"), 0.95);
        gl.uniform1f(u("uThrough"), 1.05);
        gl.uniform1f(u("uGrain"), 0.05);
        gl.uniform3f(u("uOrb"), 0.93, 0.42, 0.09);
        gl.uniform3f(u("uType"), 0.06, 0.05, 0.05);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const tex = p.kind === "photo" ? texPhoto : texCross;
        if (!tex) continue;
        const isType = p.kind === "cross" ? 1 : 0;
        const { program: pr, u } = progBleed;
        gl.useProgram(pr);
        setQuad(u, p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(u("uImage"), 0);
        gl.uniform1f(u("uTime"), t);
        gl.uniform1f(u("uBleed"), isType ? 0.004 : 0.010);
        gl.uniform1f(u("uSoft"), isType ? 0.006 : 0.030);
        gl.uniform1f(u("uBloom"), isType ? 0.25 : 0.85);
        gl.uniform1f(u("uPaper"), 0.10);
        gl.uniform1f(u("uFade"), isType ? 0.92 : 0.96);
        gl.uniform1f(u("uSat"), isType ? 0.95 : 0.88);
        gl.uniform1f(u("uIsType"), isType);
        gl.uniform1f(u("uHasAlpha"), isType);
        gl.uniform3f(u("uSheet"), 0.976, 0.965, 0.949);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    raf = requestAnimationFrame(frame);
  }

  try { raf = requestAnimationFrame(frame); } catch (e) { onError(String(e)); }

  return {
    pieces,
    onChange(fn: () => void) { changed = fn; },
    bringToFront(id: string) {
      const i = pieces.findIndex((p) => p.id === id);
      if (i >= 0) pieces.push(pieces.splice(i, 1)[0]);
    },
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
