/* lab.js: the chassis every style page runs on. A full-window canvas, a
 * walker sized to the stage, a clock, and a small panel of the few numbers
 * worth touching. A style is an object with setup(lab) and frame(lab, dt).
 *
 *   lab.ctx, lab.W, lab.H     the stage (CSS px; the canvas is DPR scaled)
 *   lab.walker                the Gait.Walker
 *   lab.ground                y of the ground line
 *   lab.time                  seconds of walking so far
 *   lab.layer(name)           an offscreen canvas of the same size, kept across resizes
 */

(function () {
  const $ = (s, el = document) => el.querySelector(s);

  const lab = {
    W: 0, H: 0, dpr: 1, time: 0, playing: true,
    tempo: 1.08, height: 0.46, lean: 10, speed: 1, life: 1,
    layers: new Map(),
  };

  function sizeCanvas(c) {
    c.width = Math.round(lab.W * lab.dpr); c.height = Math.round(lab.H * lab.dpr);
    c.style.width = lab.W + 'px'; c.style.height = lab.H + 'px';
    const x = c.getContext('2d'); x.setTransform(lab.dpr, 0, 0, lab.dpr, 0, 0);
    return x;
  }

  lab.layer = function (name) {
    let L = lab.layers.get(name);
    if (!L) { L = { canvas: document.createElement('canvas') }; lab.layers.set(name, L); L.ctx = sizeCanvas(L.canvas); }
    return L;
  };

  function makeWalker() {
    const H = lab.H * lab.height;
    const w = new window.Gait.Walker({ H, period: lab.tempo, lean: lab.lean, life: lab.life, ground: lab.ground, t: lab.walker ? lab.walker.t : 0.1 });
    if (lab.walker) { w.cycles = lab.walker.cycles; w.caseTheta = lab.walker.caseTheta; w.caseOmega = lab.walker.caseOmega; }
    w.place(lab.walker ? lab.walker.hipX() : -H * 0.6);
    lab.walker = w;
    return w;
  }

  function resize() {
    const box = lab.mount ? { w: lab.mount.clientWidth, h: lab.mount.clientHeight } : { w: innerWidth, h: innerHeight };
    const dprCap = window.LAB_DPR || 2;
    // a resize event with nothing changed (headless fires one after load) must not wipe the plates
    if (lab.W === box.w && lab.H === box.h && lab.dpr === Math.min(dprCap, devicePixelRatio || 1)) return;
    lab.W = box.w; lab.H = box.h; lab.dpr = Math.min(dprCap, devicePixelRatio || 1);
    lab.ctx = sizeCanvas(lab.canvas);
    lab.ground = Math.round(lab.H * (window.LAB_GROUND || 0.76));
    // layers keep what they hold across a resize, stretched to the new size
    for (const [, L] of lab.layers) {
      const old = L.canvas;
      const fresh = document.createElement('canvas');
      const x = sizeCanvas(fresh);
      if (old.width && old.height) x.drawImage(old, 0, 0, lab.W, lab.H);
      L.canvas = fresh; L.ctx = x;
    }
    makeWalker();
    // setup runs once; a later resize keeps the plates (stretched) and the walk
    if (!lab.ready) { lab.ready = true; lab.style.setup && lab.style.setup(lab); }
    else lab.style.resized && lab.style.resized(lab);
  }

  /* a style can lock its own numbers: lab.apply({ tempo, height, lean, speed, life }) */
  lab.apply = function (o) {
    Object.assign(lab, o);
    makeWalker();
    for (const k of ['tempo', 'height', 'lean', 'speed', 'life']) {
      const i = document.getElementById(k); if (!i || o[k] == null) continue;
      i.value = lab[k];
      i.nextElementSibling.innerHTML = k === 'tempo' ? lab.tempo.toFixed(2) + 's' : k === 'height' ? Math.round(lab.height * 100) + '%' : k === 'lean' ? lab.lean + '&deg;' : k === 'life' ? lab.life.toFixed(1) : lab.speed.toFixed(2) + 'x';
    }
  };

  /* he walks off the right edge and comes back in from the left */
  lab.wrap = function (margin = 1.2) {
    const w = lab.walker, m = w.H * margin;
    if (w.hipX() > lab.W + m) { w.place(-m); lab.style.onWrap && lab.style.onWrap(lab); }
  };

  function panel() {
    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `
      <label><span>tempo</span><input id="tempo" type="range" min="0.7" max="1.6" step="0.01" value="${lab.tempo}"><b>${lab.tempo.toFixed(2)}s</b></label>
      <label><span>height</span><input id="height" type="range" min="0.25" max="0.7" step="0.01" value="${lab.height}"><b>${Math.round(lab.height * 100)}%</b></label>
      <label><span>lean</span><input id="lean" type="range" min="0" max="18" step="0.5" value="${lab.lean}"><b>${lab.lean}&deg;</b></label>
      <label><span>time</span><input id="speed" type="range" min="0.1" max="1.5" step="0.05" value="${lab.speed}"><b>${lab.speed.toFixed(2)}x</b></label>
      <label><span>life</span><input id="life" type="range" min="0" max="2.5" step="0.1" value="${lab.life}"><b>${lab.life.toFixed(1)}</b></label>
      <label><span>stride</span><b id="stride"></b></label>`;
    document.body.appendChild(el);
    const bind = (id, fn, fmt) => { const i = $('#' + id, el); i.addEventListener('input', () => { fn(+i.value); i.nextElementSibling.innerHTML = fmt(+i.value); }); };
    bind('tempo', (v) => { lab.tempo = v; makeWalker(); }, (v) => v.toFixed(2) + 's');
    bind('height', (v) => { lab.height = v; makeWalker(); lab.style.setup && lab.style.setup(lab); }, (v) => Math.round(v * 100) + '%');
    bind('lean', (v) => { lab.lean = v; makeWalker(); }, (v) => v + '&deg;');
    bind('speed', (v) => { lab.speed = v; }, (v) => v.toFixed(2) + 'x');
    bind('life', (v) => { lab.life = v; makeWalker(); }, (v) => v.toFixed(1));
    lab.panel = el;
  }

  function chrome(name, blurb) {
    const h = document.createElement('header');
    h.className = 'top';
    h.innerHTML = `<a class="back" href="./">walk lab</a><span class="sep">/</span><span class="name">${name}</span><span class="blurb">${blurb || ''}</span>`;
    document.body.appendChild(h);
  }

  lab.start = function (style) {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => lab.start(style)); return; }
    if (window.Shade && !lab.shadeLoaded) { lab.shadeLoaded = true; window.Shade.load().then(() => lab.start(style)); return; }
    lab.style = style;
    lab.canvas = document.createElement('canvas'); lab.canvas.id = 'stage';
    /* window.LAB_MOUNT: a selector to live inside, bare, with no chrome or panel */
    lab.mount = window.LAB_MOUNT ? document.querySelector(window.LAB_MOUNT) : null;
    if (lab.mount) { lab.mount.appendChild(lab.canvas); lab.canvas.style.position = 'absolute'; lab.canvas.style.inset = '0'; }
    else { document.body.prepend(lab.canvas); chrome(style.name, style.blurb); panel(); }
    resize();
    if (lab.mount && window.ResizeObserver) new ResizeObserver(resize).observe(lab.mount);
    addEventListener('resize', resize);
    addEventListener('keydown', (e) => { if (e.key === ' ') { lab.playing = !lab.playing; e.preventDefault(); } });
    /* ?t=seconds fast-forwards the walk before the first paint, through the
       style's own frame so trails and plates are built too (for stills) */
    const pre = +(new URLSearchParams(location.search).get('t') || 0);
    for (let k = 0; k < pre * 60; k++) {
      const dt = (1 / 60) * lab.speed; lab.time += dt; lab.walker.step(dt); lab.wrap(); style.frame(lab, dt);
    }
    let last = null;
    const loop = (now) => {
      // the first frame's stamp can sit before the clock started, so the first
      // step is zero, and a step is never negative or longer than a twentieth
      let dt = last == null ? 0 : Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
      if (!lab.playing) dt = 0;
      dt *= lab.speed;
      lab.time += dt;
      lab.walker.step(dt);
      lab.wrap();
      style.frame(lab, dt);
      const s = $('#stride'); if (s) s.textContent = (lab.walker.stride / lab.walker.H * 1.75).toFixed(2) + ' m';
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  /* A coarse occupancy mask of the man: the silhouette drawn at 1/cell scale
   * into a small canvas and read back. Returns cells in stage px. Cheap
   * enough to do every frame. */
  const maskCanvas = document.createElement('canvas');
  lab.mask = function (P, cell, pad = 2) {
    const pts = [];
    const ch = window.Gait.chains(P);
    for (const c of [...ch.far, ...ch.trunk, ...ch.near]) for (const q of c) pts.push(q);
    pts.push({ x: P.head.x - P.head.r, y: P.head.y - P.head.r }, { x: P.head.x + P.head.r, y: P.head.y + P.head.r });
    if (P.case) pts.push({ x: P.case.centre.x - P.case.w, y: P.case.centre.y + P.case.h }, { x: P.case.centre.x + P.case.w, y: P.case.top.y });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const m = cell * pad;
    x0 = Math.floor((x0 - m) / cell) * cell; y0 = Math.floor((y0 - m) / cell) * cell;
    const cols = Math.ceil((x1 + m - x0) / cell), rows = Math.ceil((y1 + m - y0) / cell);
    if (cols <= 0 || rows <= 0) return null;
    maskCanvas.width = cols; maskCanvas.height = rows;
    const x = maskCanvas.getContext('2d', { willReadFrequently: true });
    x.setTransform(1 / cell, 0, 0, 1 / cell, -x0 / cell, -y0 / cell);
    x.clearRect(x0, y0, cols * cell, rows * cell);
    // the case in red so the caller can tell it from the man
    window.Figure.drawFigure(x, P, { ink: '#000', far: '#000', skin: '#000', hair: '#000', shoe: '#000', case: '#f00' });
    const d = x.getImageData(0, 0, cols, rows).data;
    return { x0, y0, cols, rows, cell, data: d, at(i, j) { const k = (j * cols + i) * 4; return d[k + 3] < 90 ? 0 : (d[k] > 128 && d[k + 1] < 100 ? 2 : 1); } };
  };

  window.lab = lab;
})();
