// Soap bubbles, rendered from the optics rather than faked.
//
// The wall of a bubble is a few hundred nanometres of soapy water. Light
// reflects off both of its faces and the two reflections interfere, which is
// where the colour comes from, and gravity drains the wall thinner at the top
// as it ages until the crown goes black and it gives out. Nothing here is a
// gradient standing in for that.
//
// Vanilla WebGL2 on purpose: the piece predates this repo and stays portable.
// React owns the chrome, this owns the canvas.

import {
  VS_FULL, FS_BG, VS_BUBBLE, FS_BUBBLE, VS_DROP, FS_DROP,
  FS_BRIGHT, FS_BLUR, FS_COMP,
} from "./shaders";

export type BubbleParams = {
  density: number;
  film: number;
  gain: number;
  refract: number;
  bloom: number;
  dof: number;
  focus: number;
  gravity: number;
  slowmo: number;
};

export const DEFAULT_PARAMS: BubbleParams = {
    density: 1.0,
    film: 430,       // nanometres, the wall thickness of a fresh bubble
    gain: 2.8,       // how far past physical the interference is pushed
    refract: 0.55,
    bloom: 0.42,
    dof: 1.55,
    focus: 0.40,
    gravity: 900,
    slowmo: 1.0
};

export type BubblesHandle = {
  params: BubbleParams;
  popAll: () => void;
  dispose: () => void;
};

type Options = {
  onError?: (message: string) => void;
  onFirstTouch?: () => void;
  /** Mutate this object to retune while it runs; the loop reads it every frame. */
  params?: BubbleParams;
};

export function startBubbles(cvs: HTMLCanvasElement, opts: Options = {}): BubblesHandle {
  const onError = opts.onError ?? (() => {});
  const onFirstTouch = opts.onFirstTouch ?? (() => {});
  let touched = false;
  const touch = () => { if (!touched) { touched = true; onFirstTouch(); } };



  const ctx = cvs.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, powerPreference: 'high-performance',
  }) as WebGL2RenderingContext | null;
  if (!ctx) throw new Error('this needs webgl2, and this browser did not give one up.');
  const gl = ctx;

  // Programs carry a lazy uniform location cache, so call sites stay readable.
  type Prog = WebGLProgram & { u: Record<string, WebGLUniformLocation | null> };
  type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };

  function fail(msg: string){
    onError(msg);
    console.error(msg);
  }

  // ---------------------------------------------------------------------------
  // gl plumbing
  // ---------------------------------------------------------------------------
  const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  const IFMT = hasFloat ? gl.RGBA16F : gl.RGBA8;
  const ITYPE = hasFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  function compile(type: number, src: string, label: string){
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(s) ?? '';
      const line = /ERROR: \d+:(\d+)/.exec(log);
      let ctx = '';
      if (line){
        const n = parseInt(line[1], 10);
        ctx = '\n' + src.split('\n').slice(Math.max(0, n - 4), n + 2)
          .map((l: string, i: number) => (Math.max(1, n - 3) + i) + ' | ' + l).join('\n');
      }
      fail(label + ' failed to compile\n' + log + ctx);
      return null;
    }
    return s;
  }

  function program(vsSrc: string, fsSrc: string, label: string): Prog | null {
    const vs = compile(gl.VERTEX_SHADER, vsSrc, label + ' vertex');
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc, label + ' fragment');
    if (!vs || !fs) return null;
    const p = gl.createProgram() as Prog;
    gl.attachShader(p, vs!); gl.attachShader(p, fs!);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)){
      fail(label + ' failed to link\n' + (gl.getProgramInfoLog(p) ?? ''));
      return null;
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

  const need = (label: string, p: Prog | null): Prog => {
    if (!p) throw new Error(label + ' did not build');
    return p;
  };
  const progBg     = need('background', program(VS_FULL, FS_BG, 'background'));
  const progBubble = need('bubble', program(VS_BUBBLE, FS_BUBBLE, 'bubble'));
  const progDrop   = need('droplet', program(VS_DROP, FS_DROP, 'droplet'));
  const progBright = need('bright pass', program(VS_FULL, FS_BRIGHT, 'bright pass'));
  const progBlur   = need('blur', program(VS_FULL, FS_BLUR, 'blur'));
  const progComp   = need('composite', program(VS_FULL, FS_COMP, 'composite'));

  function makeTarget(w: number, h: number): Target {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, IFMT, w, h, 0, gl.RGBA, ITYPE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  let scene: Target, sample: Target, bloomA: Target, bloomB: Target;
  let W = 0, H = 0, PW = 0, PH = 0, dpr = 1;

  const emptyVao = gl.createVertexArray()!;

  // unit quad shared by both instanced passes
  const quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const MAXB = 300, BSTRIDE = 16;
  const MAXD = 4200, DSTRIDE = 8;
  const bData = new Float32Array(MAXB * BSTRIDE);
  const dData = new Float32Array(MAXD * DSTRIDE);

  const bBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, bBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bData.byteLength, gl.DYNAMIC_DRAW);
  const dBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, dBuf);
  gl.bufferData(gl.ARRAY_BUFFER, dData.byteLength, gl.DYNAMIC_DRAW);

  function makeVao(instBuf: WebGLBuffer, stride: number, slots: number){
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    for (let i = 0; i < slots; i++){
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, stride * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }
  const bVao = makeVao(bBuf, BSTRIDE, 4);
  const dVao = makeVao(dBuf, DSTRIDE, 2);

  // point the instance attributes at a slice of the buffer, which is how we get
  // a base instance offset without one
  function setBubbleBase(first: number){
    gl.bindBuffer(gl.ARRAY_BUFFER, bBuf);
    for (let i = 0; i < 4; i++){
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, BSTRIDE * 4, first * BSTRIDE * 4 + i * 16);
    }
  }

  function resize(){
    const cw = cvs.clientWidth || window.innerWidth;
    const ch = cvs.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // keep the pixel budget sane on very large displays
    const budget = 2600000;
    let s = dpr;
    if (cw * ch * s * s > budget) s = Math.sqrt(budget / (cw * ch));
    W = cw; H = ch;
    PW = Math.max(2, Math.round(cw * s));
    PH = Math.max(2, Math.round(ch * s));
    cvs.width = PW; cvs.height = PH;
    for (const t of [scene, sample, bloomA, bloomB]){
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    scene  = makeTarget(PW, PH);
    sample = makeTarget(PW, PH);
    bloomA = makeTarget(Math.max(2, PW >> 2), Math.max(2, PH >> 2));
    bloomB = makeTarget(Math.max(2, PW >> 2), Math.max(2, PH >> 2));
  }
  window.addEventListener('resize', resize);
  let ro: ResizeObserver | null = null;
  if (window.ResizeObserver){
    let first = true;
    ro = new ResizeObserver(() => { if (first) { first = false; return; } resize(); });
    ro.observe(cvs);
  }

  const P: BubbleParams = opts.params ?? { ...DEFAULT_PARAMS };

  // ---------------------------------------------------------------------------
  // the bubbles themselves
  // ---------------------------------------------------------------------------
  type Bubble = {
    x: number; y: number; r: number; depth: number; vx: number; vy: number;
    seed: number; filmMul: number; flow: number; wPhase: number;
    w1: number; p1: number; w2: number; p2: number;
    age: number; life: number; fade: number;
    hole: number; popT: number; prevHole: number; shed: number;
    hx: number; hy: number; hz: number; delay: number;
    dhx?: number; dhy?: number;
  };
  type Drop = {
    x: number; y: number; r: number; vx: number; vy: number;
    kind: number; film: number; life: number; age: number; seed: number;
  };
  type Ripple = { x: number; y: number; age: number; s: number };

  const bubbles: Bubble[] = [];
  const drops: Drop[] = [];
  const ripples: Ripple[] = [];
  let time = 0;

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  function spawnBubble(x: number, y: number, r?: number){
    if (bubbles.length >= MAXB) return null;
    const depth = Math.random();
    const unit = Math.min(W, H);
    const rad = r !== undefined ? r : unit * (0.135 + Math.pow(Math.random(), 1.5) * 0.13);
    const b = {
      x, y,
      r: rad * (1.06 - depth * 0.16),
      depth,
      vx: rnd(-8, 8), vy: rnd(-20, -6),
      seed: Math.random() * 40,
      filmMul: rnd(0.70, 1.38),
      flow: Math.random() * 10,
      wPhase: Math.random() * 7,
      w1: 0, p1: rnd(0, 6.28), w2: 0, p2: rnd(0, 6.28),
      age: 0,
      life: rnd(26, 60),
      fade: 0,
      hole: -1, popT: 0, prevHole: 0, shed: 0,
      hx: 0, hy: 1, hz: 0,
      delay: -1
    };
    bubbles.push(b);
    return b;
  }

  function pushDrop(x: number, y: number, r: number, vx: number, vy: number, kind: number, film: number, life: number){
    if (drops.length >= MAXD) return;
    drops.push({ x, y, r, vx, vy, kind, film, life, age: 0, seed: Math.random() * 20 });
  }

  const respawnQueue: number[] = [];

  function popBubble(b: Bubble, nx: number, ny: number, nz: number){
    if (b.hole >= 0) return;
    // something always takes its place, so the frame never empties out
    respawnQueue.push(rnd(0.45, 0.95));
    const l = Math.hypot(nx, ny, nz) || 1;
    b.hx = nx / l; b.hy = ny / l; b.hz = nz / l;
    b.hole = 0; b.popT = 0; b.prevHole = 0;

    // the first thing a puncture does is spit a little spray
    const px = b.x + b.hx * b.r, py = b.y - b.hy * b.r;
    for (let i = 0; i < ((12 + b.r * 0.18) | 0); i++){
      const a = rnd(0, 6.283), sp = rnd(30, 210);
      pushDrop(px, py, rnd(0.6, 1.8), b.vx + Math.cos(a) * sp, b.vy + Math.sin(a) * sp,
               0, 0, rnd(0.5, 1.1));
    }
    for (let i = 0; i < 16; i++){
      const a = rnd(0, 6.283), sp = rnd(10, 90);
      pushDrop(px, py, rnd(1.5, 5.0), b.vx + Math.cos(a) * sp, b.vy + Math.sin(a) * sp,
               1, 0, rnd(0.28, 0.62));
    }

    if (ripples.length < 6) ripples.push({ x: px, y: py, age: 0, s: Math.min(1, b.r / 70) });
    else { ripples.shift(); ripples.push({ x: px, y: py, age: 0, s: Math.min(1, b.r / 70) }); }

    // a bubble that gives out takes its touching neighbours with it
    for (const o of bubbles){
      if (o === b || o.hole >= 0 || o.delay >= 0) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d < (o.r + b.r) * 0.92 && Math.random() < 0.8){
        o.delay = rnd(0.03, 0.14);
        o.dhx = (o.x - b.x) / d; o.dhy = -(o.y - b.y) / d;
      }
    }
  }

  // a slow rolling field so the room has drafts rather than jitter
  function wind(x: number, y: number, t: number){
    const s = 0.0017;
    const a = Math.sin(x * s * 1.7 + t * 0.31) * Math.cos(y * s * 1.3 - t * 0.24);
    const b = Math.sin(y * s * 2.1 - t * 0.19) * Math.cos(x * s * 0.9 + t * 0.27);
    return [(a * 0.62 + b * 0.38) * 30, (b * 0.5 - a * 0.3) * 15];
  }

  // debug hooks, for looking at a single burst frame by frame:
  //   ?demo        one big bubble, centre frame, punctured at 0.5s
  //   ?freeze=0.8  stop the clock at that many seconds of simulated time
  const Q = new URLSearchParams(location.search);
  const DEMO = Q.has('demo');
  const FREEZE = parseFloat(Q.get('freeze') || '0') || 0;

  const pointer = { x: -999, y: -999, px: -999, py: -999, down: false, moved: false, blowing: false, blowT: 0 };

  function basis(nx: number, ny: number, nz: number){
    let ax = 0, az = 1;
    const ay = 0;
    if (Math.abs(nz) > 0.9){ ax = 1; az = 0; }
    let tx = ay * nz - az * ny, ty = az * nx - ax * nz, tz = ax * ny - ay * nx;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    return [tx, ty, tz, bx, by, bz];
  }

  function shedRim(b: Bubble, dt: number){
    const [tx, ty, tz, bx, by, bz] = basis(b.hx, b.hy, b.hz);
    const sh = Math.sin(b.hole), ch = Math.cos(b.hole);
    const rimSpeed = ((b.hole - b.prevHole) / Math.max(dt, 1e-4)) * b.r;
    b.shed += dt * 150 * Math.max(sh, 0.0) * (0.35 + b.r / 90) * P.density;
    let n = Math.floor(b.shed);
    b.shed -= n;
    n = Math.min(n, 22);
    for (let i = 0; i < n; i++){
      const az = rnd(0, 6.283), ca = Math.cos(az), sa = Math.sin(az);
      const nx = b.hx * ch + (tx * ca + bx * sa) * sh;
      const ny = b.hy * ch + (ty * ca + by * sa) * sh;
      const nz = b.hz * ch + (tz * ca + bz * sa) * sh;
      // the rim travels along the surface, so debris leaves on the tangent
      const dx = -b.hx * sh + (tx * ca + bx * sa) * ch;
      const dy = -b.hy * sh + (ty * ca + by * sa) * ch;
      const sp = rimSpeed * rnd(0.35, 1.15);
      const x = b.x + nx * b.r, y = b.y - ny * b.r;
      const vx = b.vx + dx * sp + rnd(-25, 25);
      const vy = b.vy - dy * sp + rnd(-25, 25);
      const roll = Math.random();
      if (roll < 0.45){
        pushDrop(x, y, rnd(0.5, 1.6), vx * 0.8, vy * 0.8, 0, 0, rnd(0.4, 0.9));
      } else if (roll < 0.8){
        pushDrop(x, y, rnd(1.0, 2.2) + b.r * 0.012, vx, vy, 2, P.film * rnd(0.4, 1.5), rnd(0.5, 1.2));
      } else {
        pushDrop(x, y, rnd(1.6, 4.5) + b.r * 0.02, vx * 0.7, vy * 0.7, 1, 0, rnd(0.3, 0.7));
      }
      void nz;
    }
  }

  // ---------------------------------------------------------------------------
  // simulation
  // ---------------------------------------------------------------------------
  function update(dt: number){
    time += dt;

    if (DEMO){
      const b = bubbles[0];
      if (b && b.hole < 0 && time >= 0.5) popBubble(b, 0.34, 0.52, 0.78);
    } else {
      // keep the room populated, new ones drift up from below the frame
      const target = Math.min(MAXB, Math.max(3, Math.round(4 * P.density)));
      if (bubbles.length < target && Math.random() < dt * 1.6 * P.density){
        spawnBubble(rnd(W * 0.15, W * 0.85), H + rnd(30, 120));
      }
    }

    const pvx = (pointer.x - pointer.px) / Math.max(dt, 1e-3);
    const pvy = (pointer.y - pointer.py) / Math.max(dt, 1e-3);
    pointer.px = pointer.x; pointer.py = pointer.y;

    for (let i = bubbles.length - 1; i >= 0; i--){
      const b = bubbles[i];
      b.age += dt;
      b.fade = Math.min(1, b.fade + dt * 3.2);

      if (b.delay >= 0){
        b.delay -= dt;
        if (b.delay < 0) popBubble(b, b.dhx || 0, b.dhy || 1, 0.35);
      }

      if (b.hole < 0){
        // buoyancy beats the weight of the wall, and beats it harder the bigger
        // the bubble gets, so the big ones climb faster
        const rise = -(16 + b.r * 0.46);
        b.vy += (rise - b.vy) * Math.min(1, dt * 1.5);
        const [wx, wy] = wind(b.x, b.y, time);
        b.vx += (wx * (0.7 + b.r * 0.006) - b.vx) * Math.min(1, dt * 1.1);
        b.vy += wy * dt * 1.4;

        // the pointer drags air with it
        const dx = b.x - pointer.x, dy = b.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        const reach = 190 + b.r;
        if (d2 < reach * reach && pointer.x > -500){
          const d = Math.sqrt(d2) + 1e-3;
          const f = (1 - d / reach) * (1 - d / reach);
          b.vx += (dx / d * 60 + pvx * 0.22) * f * dt * 6;
          b.vy += (dy / d * 60 + pvy * 0.22) * f * dt * 6;
        }

        const par = 1.18 - b.depth * 0.5;
        b.x += b.vx * dt * par;
        b.y += b.vy * dt * par;

        b.wPhase += dt * (2.4 + 46 / b.r);
        const amp = 0.010 + 0.020 * Math.min(1, Math.hypot(b.vx, b.vy) / 120);
        b.w1 = amp * Math.sin(b.wPhase);
        b.w2 = amp * 0.6 * Math.sin(b.wPhase * 1.63 + 1.1);

        if (b.y + b.r < -60 || b.x < -W * 0.4 || b.x > W * 1.4){ bubbles.splice(i, 1); continue; }
        // the crown drains to nothing, then it goes
        if (b.age > b.life) popBubble(b, rnd(-0.4, 0.4), 1, rnd(-0.3, 0.5));
        else if (b.y - b.r * 0.75 < 0) popBubble(b, rnd(-0.5, 0.5), 1, rnd(0.1, 0.6));
      } else {
        b.prevHole = b.hole;
        b.popT += dt;
        const T = 0.30 + b.r * 0.0022;
        const prog = Math.min(b.popT / T, 1);
        b.hole = Math.PI * Math.pow(prog, 0.78);
        b.x += b.vx * dt; b.y += b.vy * dt;
        shedRim(b, dt);
        if (prog >= 1){
          // whatever wall is left arrives all at once
          for (let k = 0; k < 10 + b.r * 0.5; k++){
            const a = rnd(0, 6.283), sp = rnd(40, 260) * (0.5 + b.r / 120);
            pushDrop(b.x - b.hx * b.r * 0.6, b.y + b.hy * b.r * 0.6,
                     rnd(1.2, 3.4) + b.r * 0.016,
                     b.vx + Math.cos(a) * sp, b.vy + Math.sin(a) * sp,
                     Math.random() < 0.5 ? 2 : 0, P.film * rnd(0.3, 1.6), rnd(0.5, 1.3));
          }
          for (let k = 0; k < 22; k++){
            const a = rnd(0, 6.283), sp = rnd(20, 150);
            pushDrop(b.x, b.y, rnd(2.0, 6.0), Math.cos(a) * sp, Math.sin(a) * sp, 1, 0, rnd(0.3, 0.8));
          }
          bubbles.splice(i, 1);
        }
      }
    }

    for (let i = drops.length - 1; i >= 0; i--){
      const d = drops[i];
      d.age += dt;
      if (d.age > d.life){ drops.splice(i, 1); continue; }
      const mist = d.kind === 1;
      // small things lose their speed to the air almost immediately
      const k = mist ? 4.5 : 1.6 + 9 / Math.max(d.r, 0.5);
      const damp = Math.exp(-dt * k);
      d.vx *= damp; d.vy *= damp;
      d.vy += P.gravity * dt * (mist ? 0.06 : Math.min(1, d.r / 2.2));
      if (mist){
        const [wx, wy] = wind(d.x, d.y, time);
        d.vx += wx * dt * 1.6; d.vy += wy * dt * 1.6 - 26 * dt;
        d.r += dt * 6;
      }
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.y > H + 60) { drops.splice(i, 1); continue; }
    }

    for (let i = respawnQueue.length - 1; i >= 0; i--){
      respawnQueue[i] -= dt;
      if (respawnQueue[i] <= 0){
        respawnQueue.splice(i, 1);
        const b = spawnBubble(rnd(W * 0.22, W * 0.78), H + rnd(30, 110));
        if (b) b.vy = -rnd(45, 85);
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--){
      ripples[i].age += dt;
      ripples[i].s *= Math.exp(-dt * 3.4);
      if (ripples[i].age > 0.9) ripples.splice(i, 1);
    }

    if (pointer.blowing){
      pointer.blowT -= dt;
      if (pointer.blowT <= 0){
        pointer.blowT = rnd(0.05, 0.14);
        const b = spawnBubble(pointer.x + rnd(-10, 10), pointer.y + rnd(-10, 10), rnd(9, 46));
        if (b){ b.vx = pvx * 0.25 + rnd(-30, 30); b.vy = pvy * 0.25 + rnd(-70, -10); }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // packing and drawing
  // ---------------------------------------------------------------------------
  const order: number[] = [];
  const ripBuf = new Float32Array(24);

  function packBubbles(){
    order.length = 0;
    for (let i = 0; i < bubbles.length; i++) order.push(i);
    order.sort((a, b) => bubbles[b].depth - bubbles[a].depth);   // far to near
    for (let n = 0; n < order.length; n++){
      const b = bubbles[order[n]];
      const o = n * BSTRIDE;
      const ageFrac = Math.min(1, b.age / b.life);
      bData[o + 0] = b.x; bData[o + 1] = b.y; bData[o + 2] = b.r; bData[o + 3] = b.depth;
      bData[o + 4] = b.w1; bData[o + 5] = b.p1; bData[o + 6] = b.w2; bData[o + 7] = b.p2;
      bData[o + 8] = P.film * b.filmMul * (1.3 - 0.58 * ageFrac);
      bData[o + 9] = b.seed;
      bData[o + 10] = b.hole;
      bData[o + 11] = b.flow;
      bData[o + 12] = b.hx; bData[o + 13] = b.hy; bData[o + 14] = b.hz;
      bData[o + 15] = b.fade;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, bBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bData, 0, order.length * BSTRIDE);
    return order.length;
  }

  function packDrops(){
    const n = Math.min(drops.length, MAXD);
    for (let i = 0; i < n; i++){
      const d = drops[i], o = i * DSTRIDE;
      const t = d.age / d.life;
      const alpha = d.kind === 1
        ? Math.sin(Math.min(1, t * 6) * 1.5708) * (1 - t) * (1 - t)
        : Math.min(1, (1 - t) * 3.2);
      dData[o + 0] = d.x; dData[o + 1] = d.y; dData[o + 2] = d.r; dData[o + 3] = alpha;
      dData[o + 4] = d.seed; dData[o + 5] = d.kind; dData[o + 6] = d.film; dData[o + 7] = 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dData, 0, n * DSTRIDE);
    return n;
  }

  function blitSceneToSample(): void {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, scene.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sample.fbo);
    gl.blitFramebuffer(0, 0, PW, PH, 0, 0, PW, PH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
  }

  function fullscreen(prog: Prog){
    gl.bindVertexArray(emptyVao);
    gl.useProgram(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const SLICES = 3;
  const ripLoc = gl.getUniformLocation(progComp, 'u_rip[0]');

  function render(){
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // sources are premultiplied

    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, PW, PH);
    gl.disable(gl.BLEND);
    gl.useProgram(progBg);
    gl.uniform2f(progBg.u.u_res, W, H);
    gl.uniform1f(progBg.u.u_time, time);
    fullscreen(progBg);
    gl.enable(gl.BLEND);

    const nb = packBubbles();
    const nd = packDrops();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sample.tex);

    // bubbles refract what is already on the canvas, so the canvas gets copied
    // aside between depth slices and they read that copy
    gl.useProgram(progBubble);
    gl.uniform1i(progBubble.u.u_scene, 0);
    gl.uniform2f(progBubble.u.u_res, W, H);
    gl.uniform1f(progBubble.u.u_time, time);
    gl.uniform1f(progBubble.u.u_refract, P.refract);
    gl.uniform1f(progBubble.u.u_gain, P.gain);
    gl.uniform1f(progBubble.u.u_focus, P.focus);
    gl.uniform1f(progBubble.u.u_dof, P.dof);
    gl.bindVertexArray(bVao);
    if (nb > 0){
      const per = Math.ceil(nb / SLICES);
      for (let s = 0; s < SLICES; s++){
        const first = s * per;
        const count = Math.min(per, nb - first);
        if (count <= 0) break;
        blitSceneToSample();
        setBubbleBase(first);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      }
    }

    if (nd > 0){
      blitSceneToSample();
      gl.useProgram(progDrop);
      gl.uniform1i(progDrop.u.u_scene, 0);
      gl.uniform2f(progDrop.u.u_res, W, H);
      gl.uniform1f(progDrop.u.u_gain, P.gain);
      gl.bindVertexArray(dVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nd);
    }

    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
    gl.viewport(0, 0, bloomA.w, bloomA.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.useProgram(progBright);
    gl.uniform1i(progBright.u.u_src, 0);
    gl.uniform1f(progBright.u.u_thresh, 0.72);
    fullscreen(progBright);

    gl.useProgram(progBlur);
    gl.uniform1i(progBlur.u.u_src, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fbo);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform2f(progBlur.u.u_dir, 1 / bloomA.w, 0);
    fullscreen(progBlur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
    gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
    gl.uniform2f(progBlur.u.u_dir, 0, 1 / bloomA.h);
    fullscreen(progBlur);

    ripBuf.fill(0);
    for (let i = 0; i < Math.min(6, ripples.length); i++){
      const r = ripples[i];
      ripBuf[i * 4 + 0] = r.x;
      ripBuf[i * 4 + 1] = H - r.y;                 // the composite samples with y up
      ripBuf[i * 4 + 2] = r.age;
      ripBuf[i * 4 + 3] = r.s;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, PW, PH);
    gl.useProgram(progComp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform1i(progComp.u.u_scene, 0);
    gl.uniform1i(progComp.u.u_bloom, 1);
    gl.uniform2f(progComp.u.u_res, W, H);
    gl.uniform1f(progComp.u.u_time, time);
    gl.uniform1f(progComp.u.u_bloomAmt, P.bloom);
    gl.uniform4fv(ripLoc, ripBuf);
    fullscreen(progComp);
    gl.activeTexture(gl.TEXTURE0);
  }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------
  function hit(x: number, y: number){
    let best = null;
    for (const b of bubbles){
      if (b.hole >= 0) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < Math.max(b.r * 1.05, 20) && (!best || b.depth < best.b.depth)) best = { b, d, x, y };
    }
    return best;
  }

  function localPointer(e: PointerEvent): [number, number] {
    const r = cvs.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  cvs.addEventListener('pointerdown', (e) => {
    cvs.setPointerCapture(e.pointerId);
    const [x, y] = localPointer(e);
    pointer.x = x; pointer.y = y; pointer.down = true;
    if (!pointer.moved){ pointer.px = x; pointer.py = y; pointer.moved = true; }
    const h = hit(x, y);
    if (h){
      const nx = (x - h.b.x) / h.b.r;
      const ny = -(y - h.b.y) / h.b.r;
      const nz = Math.sqrt(Math.max(0.04, 1 - nx * nx - ny * ny));
      popBubble(h.b, nx, ny, nz);
    touch();
    } else {
      pointer.blowing = true;
      pointer.blowT = 0;
    }
  });

  cvs.addEventListener('pointermove', (e) => {
    const [x, y] = localPointer(e);
    if (!pointer.moved){ pointer.px = x; pointer.py = y; pointer.moved = true; }
    pointer.x = x; pointer.y = y;
  });

  const release = () => { pointer.down = false; pointer.blowing = false; };
  cvs.addEventListener('pointerup', release);
  cvs.addEventListener('pointercancel', release);
  cvs.addEventListener('pointerleave', () => { pointer.x = -999; pointer.y = -999; release(); });



  // ---------------------------------------------------------------------------
  // go
  // ---------------------------------------------------------------------------
  resize();
  if (DEMO){
    const b = spawnBubble(W * 0.5, H * 0.52, Math.min(W, H) * 0.30);
    if (b){ b.r = Math.min(W, H) * 0.30; b.fade = 1; b.depth = 0.4; b.vx = 0; b.vy = 0; b.life = 1e9; }
  } else {
    for (let i = 0; i < 5; i++){
      const b = spawnBubble(rnd(W * 0.16, W * 0.84), rnd(H * 0.18, H * 0.86));
      if (b){ b.fade = 1; b.age = rnd(0, 8); }
    }
  }

  let warmed = false;
  const paused = false;
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  function frame(now: number){
    if (stopped) return;
    const raw = (now - last) / 1000;
    last = now;
    // With a freeze target, step the whole simulation there on the first frame in
    // fixed increments, then hold. Otherwise the captured moment depends on how
    // many frames the machine managed to render, which is not a moment at all.
    if (FREEZE > 0 && !warmed){
      warmed = true;
      while (time < FREEZE) update(1 / 120);
    }
    const frozen = FREEZE > 0;
    if (!paused && !frozen) update(Math.min(raw, 1 / 20) * P.slowmo);
    render();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    params: P,
    popAll(){
      for (const b of bubbles){
        if (b.hole < 0 && b.delay < 0) b.delay = Math.random() * 0.5;
        b.dhx = rnd(-0.5, 0.5); b.dhy = 1;
      }
    },
    dispose(){
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ro?.disconnect();
    },
  };
}
