/* ant.js: one ant, many skins. The ant is a small set of shapes in its
   own units (about 20 long, heading +x): abdomen, waist, thorax, head,
   three legs on one side (mirrored), one antenna (mirrored). A texture
   is a function that paints those shapes. Ant.draw(ctx, shape, texture,
   {phase, f, scale}) paints it at the current origin heading +x. */
(() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const hash = (x, y, z) => { let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
  function vnoise(x, y, z = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash(xi, yi, z), hash(xi + 1, yi, z), u), lerp(hash(xi, yi + 1, z), hash(xi + 1, yi + 1, z), u), v);
  }

  const DEFAULT = {
    abdomen: { x: -5.4, y: 0, rx: 4.2, ry: 2.7 },
    waist: { x: -1.5, y: 0, rx: 0.9, ry: 0.7 },
    thorax: { x: 0.9, y: 0, rx: 2.3, ry: 1.6 },
    head: { x: 4.9, y: 0, rx: 2.3, ry: 1.95 },
    legs: [
      { b: [2.2, 1.0], k: [4.6, 3.2], t: [6.8, 6.0] },
      { b: [0.8, 1.3], k: [1.4, 4.0], t: [1.9, 7.0] },
      { b: [-0.6, 1.2], k: [-3.2, 3.5], t: [-5.8, 6.4] },
    ],
    antenna: { b: [6.8, 0.8], c: [9.4, 1.9], t: [11.0, 4.5] },
  };
  const copy = (o) => JSON.parse(JSON.stringify(o));

  /* ---- geometry ---- */
  function ellipsePts(e, n, jit, f, seed) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU; const w = jit ? 1 + jit * (vnoise(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3 + seed, f) - 0.5) * 2 : 1; pts.push([e.x + Math.cos(a) * e.rx * w, e.y + Math.sin(a) * e.ry * w]); }
    return pts;
  }
  const path = (pts) => { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; };
  const rot = (p, o, a) => { const dx = p[0] - o[0], dy = p[1] - o[1], c = Math.cos(a), s = Math.sin(a); return [o[0] + dx * c - dy * s, o[1] + dx * s + dy * c]; };
  /* the legs for this instant: each side, each leg, posed by the gait */
  function legs(shape, phase) {
    const out = [];
    for (const side of [1, -1]) shape.legs.forEach((L, i) => {
      const tripod = ((i + (side > 0 ? 0 : 1)) % 2) * Math.PI;
      const swing = phase == null ? 0 : Math.sin(phase + tripod) * 0.5;
      const b = [L.b[0], L.b[1] * side];
      const k = rot([L.k[0], L.k[1] * side], b, swing * side), t = rot([L.t[0], L.t[1] * side], b, swing * side);
      out.push({ b, k, t, side, i });
    });
    return out;
  }
  function antennae(shape, phase) {
    const A = shape.antenna; const out = [];
    for (const side of [1, -1]) { const w = phase == null ? 0 : Math.sin(phase * 0.5 + side) * 0.3; out.push({ b: [A.b[0], A.b[1] * side], c: [A.c[0] + w, A.c[1] * side], t: [A.t[0], (A.t[1] + w) * side] }); }
    return out;
  }
  const SEGS = ['abdomen', 'waist', 'thorax', 'head'];

  /* a wobbly polyline between points, for brushed legs */
  function wobble(a, b, n, amt, f, seed) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const u = i / n; const x = lerp(a[0], b[0], u), y = lerp(a[1], b[1], u); const s = Math.sin(u * Math.PI) * amt; pts.push([x + (vnoise(i, f, seed) - 0.5) * s, y + (vnoise(i, f, seed + 9) - 0.5) * s]); }
    return pts;
  }
  const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); };

  /* ---- grain, shared ---- */
  const grain = document.createElement('canvas'); grain.width = grain.height = 128;
  { const g = grain.getContext('2d'); const im = g.createImageData(128, 128); for (let i = 0; i < im.data.length; i += 4) { const v = 150 + Math.random() * 105; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); }

  /* ---- textures ---- */
  const TEX = {};

  /* 1 ink: a loaded brush. Solid near-black, edges that wobble, a soft bleed under everything, legs that thin toward the tip. */
  TEX.ink = { label: 'ink', blurb: 'a loaded brush: solid black, wobbling edges, a soft bleed, legs thinning to the tip',
    draw(ctx, shape, o) {
      const f = o.f, C = '#1B1C20';
      const segs = SEGS.map((k, i) => path(ellipsePts(shape[k], 36, 0.07, f, i * 5)));
      ctx.save(); ctx.filter = 'blur(0.35px)'; ctx.globalAlpha = 0.45; ctx.fillStyle = C; segs.forEach((p) => ctx.fill(p)); ctx.restore();
      ctx.fillStyle = C; segs.forEach((p) => ctx.fill(p));
      ctx.strokeStyle = C; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const L of legs(shape, o.phase)) { ctx.lineWidth = 1.05; poly(ctx, wobble(L.b, L.k, 4, 0.25, f, L.i + L.side * 3)); ctx.stroke(); ctx.lineWidth = 0.6; poly(ctx, wobble(L.k, L.t, 5, 0.3, f, L.i + L.side * 7)); ctx.stroke(); ctx.beginPath(); ctx.arc(L.t[0], L.t[1], 0.36, 0, TAU); ctx.fill(); }
      ctx.lineWidth = 0.55; for (const A of antennae(shape, o.phase)) { ctx.beginPath(); ctx.moveTo(...A.b); ctx.quadraticCurveTo(...A.c, ...A.t); ctx.stroke(); }
    } };

  /* 2 wash: the pear's own technique. A translucent slate wash with a darker rim where it pooled and paper grain through it. */
  TEX.wash = { label: 'wash', blurb: 'the pear\'s own technique: a translucent slate wash, a pooled darker rim, grain showing through',
    draw(ctx, shape, o) {
      const f = o.f, C = '#3D4458', D = '#1C2130';
      const pts = SEGS.map((k, i) => ellipsePts(shape[k], 36, 0.1, f, i * 5)), segs = pts.map(path);
      segs.forEach((p) => { ctx.save(); ctx.clip(p); ctx.globalAlpha = 0.78; ctx.fillStyle = C; ctx.fillRect(-20, -20, 40, 40);
        ctx.globalCompositeOperation = 'multiply'; ctx.filter = 'blur(0.5px)'; ctx.globalAlpha = 0.55; ctx.strokeStyle = D; ctx.lineWidth = 1.3; ctx.stroke(p); ctx.filter = 'none';
        const pat = ctx.createPattern(grain, 'repeat'); pat.setTransform(new DOMMatrix().scale(0.06)); ctx.globalAlpha = 0.35; ctx.fillStyle = pat; ctx.fillRect(-20, -20, 40, 40); ctx.restore(); });
      ctx.strokeStyle = C; ctx.globalAlpha = 0.72; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const L of legs(shape, o.phase)) { ctx.lineWidth = 0.95; poly(ctx, wobble(L.b, L.k, 4, 0.2, f, L.i + L.side * 3)); ctx.stroke(); ctx.lineWidth = 0.6; poly(ctx, wobble(L.k, L.t, 5, 0.25, f, L.i + L.side * 7)); ctx.stroke();
        ctx.save(); ctx.filter = 'blur(0.4px)'; ctx.fillStyle = D; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(L.k[0], L.k[1], 0.5, 0, TAU); ctx.fill(); ctx.restore(); }
      ctx.lineWidth = 0.5; for (const A of antennae(shape, o.phase)) { ctx.beginPath(); ctx.moveTo(...A.b); ctx.quadraticCurveTo(...A.c, ...A.t); ctx.stroke(); }
      ctx.globalAlpha = 1;
    } };

  /* 3 pencil: graphite. Each outline drawn twice, slightly off, with the segments filled by diagonal hatching that shifts with the boil. */
  TEX.pencil = { label: 'pencil', blurb: 'graphite: outlines drawn twice, a little off, segments filled with shifting diagonal hatching',
    draw(ctx, shape, o) {
      const f = o.f, C = '#3A3A40';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = C;
      SEGS.forEach((k, i) => {
        const e = shape[k]; const p = path(ellipsePts(e, 36, 0.05, f, i * 5));
        ctx.save(); ctx.clip(p); ctx.globalAlpha = 0.55; ctx.lineWidth = 0.16;
        const R = Math.max(e.rx, e.ry) * 1.5, step = 0.42; let n = 0;
        for (let d = -R; d <= R; d += step, n++) { const j = (vnoise(n, f, i) - 0.5) * 0.3; ctx.beginPath(); ctx.moveTo(e.x + d - R + j, e.y - R); ctx.lineTo(e.x + d + R + j, e.y + R); ctx.stroke(); }
        if (k !== 'waist') for (let d = -R; d <= R; d += step * 2.2, n++) { ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(e.x + d + R, e.y - R); ctx.lineTo(e.x + d - R, e.y + R); ctx.stroke(); }
        ctx.restore();
        for (let pass = 0; pass < 2; pass++) { ctx.globalAlpha = pass ? 0.5 : 0.85; ctx.lineWidth = pass ? 0.18 : 0.26; ctx.stroke(path(ellipsePts({ x: e.x + (pass ? 0.12 : 0), y: e.y + (pass ? -0.1 : 0), rx: e.rx, ry: e.ry }, 36, 0.05, f + pass, i * 5 + pass))); }
      });
      for (const L of legs(shape, o.phase)) for (let pass = 0; pass < 2; pass++) { ctx.globalAlpha = pass ? 0.45 : 0.8; ctx.lineWidth = pass ? 0.18 : 0.3; const off = pass ? 0.14 : 0; poly(ctx, [[L.b[0] + off, L.b[1]], [L.k[0] + off, L.k[1] - off], [L.t[0], L.t[1]]]); ctx.stroke(); }
      ctx.lineWidth = 0.22; ctx.globalAlpha = 0.8; for (const A of antennae(shape, o.phase)) { ctx.beginPath(); ctx.moveTo(...A.b); ctx.quadraticCurveTo(...A.c, ...A.t); ctx.stroke(); }
      ctx.globalAlpha = 1;
    } };

  /* 4 gloss: a beetle's shell. Each segment lit from the upper left with a dark base, a cool sheen and a hard specular, legs with a hairline highlight. */
  TEX.gloss = { label: 'gloss', blurb: 'a beetle\'s shell: segments lit from the upper left, a cool sheen, a hard specular, hairline highlights on the legs',
    draw(ctx, shape, o) {
      SEGS.forEach((k) => { const e = shape[k]; const r = Math.max(e.rx, e.ry);
        const g = ctx.createRadialGradient(e.x - e.rx * 0.3, e.y - e.ry * 0.4, 0, e.x, e.y, r * 1.25); g.addColorStop(0, '#7E8392'); g.addColorStop(0.4, '#2B2E37'); g.addColorStop(1, '#0C0D10');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(e.x - e.rx * 0.32, e.y - e.ry * 0.45, e.rx * 0.28, e.ry * 0.16, -0.3, 0, TAU); ctx.fill(); });
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const L of legs(shape, o.phase)) { ctx.strokeStyle = '#17181C'; ctx.lineWidth = 0.95; poly(ctx, [L.b, L.k]); ctx.stroke(); ctx.lineWidth = 0.6; poly(ctx, [L.k, L.t]); ctx.stroke(); ctx.strokeStyle = 'rgba(160,165,180,0.75)'; ctx.lineWidth = 0.18; poly(ctx, [[L.b[0] - 0.12, L.b[1] - 0.14], [L.k[0] - 0.12, L.k[1] - 0.16]]); ctx.stroke(); }
      ctx.strokeStyle = '#17181C'; ctx.lineWidth = 0.5; for (const A of antennae(shape, o.phase)) { ctx.beginPath(); ctx.moveTo(...A.b); ctx.quadraticCurveTo(...A.c, ...A.t); ctx.stroke(); }
    } };

  /* 5 stipple: dotted, not drawn. A few fat dots stand in for each segment, a short run of dots for each leg, the whole ant a loose speckle that re-settles each frame. */
  TEX.stipple = { label: 'stipple', blurb: 'dotted, not drawn: a few fat dots per segment, short runs of dots for legs, a loose speckle that re-settles each frame',
    draw(ctx, shape, o) {
      const f = o.f, C = '#232529'; ctx.fillStyle = C;
      SEGS.forEach((k, si) => { const e = shape[k]; const area = Math.PI * e.rx * e.ry; const n = Math.round(area * 1.6 + 4);
        for (let i = 0; i < n; i++) { const a = hash(i, si, f % 4) * TAU; const rr = Math.pow(hash(i + 50, si, f % 4), 0.6) * 0.92; const x = e.x + Math.cos(a) * e.rx * rr, y = e.y + Math.sin(a) * e.ry * rr; const d = 0.32 + 0.3 * hash(i + 99, si, f % 4);
          ctx.globalAlpha = 0.75 + 0.25 * hash(i + 3, si, f % 4); ctx.beginPath(); ctx.arc(x, y, d, 0, TAU); ctx.fill(); } });
      ctx.globalAlpha = 0.9;
      const dots = (a, b, sp, w, seed) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.round(len / sp)); for (let i = 0; i <= n; i++) { const u = i / n; const x = lerp(a[0], b[0], u) + (hash(i, seed, f % 3) - 0.5) * w, y = lerp(a[1], b[1], u) + (hash(i + 7, seed, f % 3) - 0.5) * w; ctx.beginPath(); ctx.arc(x, y, 0.26 + 0.18 * hash(i, seed + 3, f % 3), 0, TAU); ctx.fill(); } };
      for (const L of legs(shape, o.phase)) { dots(L.b, L.k, 0.9, 0.35, L.i * 2 + L.side); dots(L.k, L.t, 1.0, 0.4, L.i * 2 + L.side + 20); }
      for (const A of antennae(shape, o.phase)) { dots(A.b, A.c, 1.0, 0.25, 40 + A.b[1]); dots(A.c, A.t, 1.0, 0.25, 50 + A.b[1]); }
      ctx.globalAlpha = 1;
    } };

  function draw(ctx, shape, texture, o = {}) {
    ctx.save(); if (o.scale) ctx.scale(o.scale, o.scale);
    (TEX[texture] || TEX.ink).draw(ctx, shape, { phase: o.phase ?? null, f: o.f ?? 0 });
    ctx.restore();
  }

  window.Ant = { DEFAULT, copy, TEX, ORDER: ['ink', 'wash', 'pencil', 'gloss', 'stipple'], SEGS, legs, antennae, draw, vnoise };
})();
