/* pearpaint.js: the pear as a shape and a set of skins. The shape lives in
   a 540 square like the GIF: a closed outline of control points (a smooth
   curve passes through them), a stalk (base, bend, tip, width), a calyx
   (centre, radius) and a list of bruises (centre, radii, turn, tone). A
   texture paints that shape. Pear.paint(ctx, shape, texture, {f, t, agitation})
   paints at the current origin in 540 units. */
(() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const sstep = (a, b, v) => { const u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  const hash = (x, y, z) => { let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
  function vnoise(x, y, z = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash(xi, yi, z), hash(xi + 1, yi, z), u), lerp(hash(xi, yi + 1, z), hash(xi + 1, yi + 1, z), u), v);
  }
  const copy = (o) => JSON.parse(JSON.stringify(o));

  /* ---- the default shape, built from the GIF's pear ---- */
  const DEFAULT = (() => {
    const P0 = [112, 212], P1 = [462, 332];
    const AX = Math.atan2(P1[1] - P0[1], P1[0] - P0[0]), AL = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), RMAX = 152;
    const width = (u, side) => RMAX * Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.55) * (0.5 + 0.5 * sstep(0.08, 0.78, u)) * (side > 0 ? 1.06 : 0.9);
    const at = (u, v) => { const w = width(u, v < 0 ? -1 : 1) * Math.abs(v), sg = Math.sign(v || 1); return [P0[0] + Math.cos(AX) * u * AL - Math.sin(AX) * w * sg, P0[1] + Math.sin(AX) * u * AL + Math.cos(AX) * w * sg]; };
    const r = (p) => p.map((v) => Math.round(v * 10) / 10);
    const us = [0.1, 0.25, 0.42, 0.6, 0.78, 0.92];
    const outline = [r(at(0.015, 0))].concat(us.map((u) => r(at(u, -1))), [r(at(1, 0))], us.slice().reverse().map((u) => r(at(u, 1))));
    const sb = at(0.02, 0), ang = AX + Math.PI + 0.22, st = [sb[0] + Math.cos(ang) * 70, sb[1] + Math.sin(ang) * 70];
    const sc = [(sb[0] + st[0]) / 2 + Math.cos(ang + Math.PI / 2) * 6, (sb[1] + st[1]) / 2 + Math.sin(ang + Math.PI / 2) * 6];
    const cal = at(0.9, 0.22);
    const B = (u, v, rx, ry, rot, c, a) => { const [x, y] = r(at(u, v)); return { x, y, rx, ry, rot, c, a }; };
    return {
      outline,
      stalk: { b: r(sb), c: r(sc), t: r(st), w: 15 },
      calyx: { x: Math.round(cal[0]), y: Math.round(cal[1]), r: 7.5, halo: 30 },
      bruises: [B(0.42, -0.42, 62, 40, 0.3, 'bruise', 0.5), B(0.47, 0.05, 78, 44, 0.2, 'bruiseLight', 0.55), B(0.3, 0.12, 44, 30, 0.5, 'bruise', 0.42), B(0.58, 0.5, 60, 34, 0.15, 'bruise', 0.5), B(0.72, -0.15, 36, 26, 0.1, 'bruiseLight', 0.38), B(0.62, -0.5, 30, 20, 0.6, 'bruise', 0.3)],
    };
  })();

  /* ---- geometry ---- */
  /* the outline as a smooth closed curve through the control points, boiled by frame f */
  function curve(ctrl, f = 0, boil = 0, sub = 8) {
    const n = ctrl.length, pts = [];
    for (let i = 0; i < n; i++) {
      const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      for (let s = 0; s < sub; s++) { const t = s / sub, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        const k = pts.length; pts.push(boil ? [x + (vnoise(k * 0.35, f * 1.7, 11) - 0.5) * 2 * boil, y + (vnoise(k * 0.35, f * 1.7, 12) - 0.5) * 2 * boil] : [x, y]); }
    }
    return boil ? smooth(pts, 1) : pts;
  }
  function smooth(pts, passes = 1) {
    for (let p = 0; p < passes; p++) { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } pts = out; }
    return pts;
  }
  const trace = (ctx, pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
  const path2d = (pts) => { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; };
  const centre = (shape) => { let x = 0, y = 0; for (const p of shape.outline) { x += p[0]; y += p[1]; } return [x / shape.outline.length, y / shape.outline.length]; };
  const bounds = (pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; };
  /* a random point on the outline with its outward heading, favouring the underside */
  function edgePoint(shape, rnd = Math.random) {
    const pts = curve(shape.outline), [cx, cy] = centre(shape);
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(rnd() * pts.length), a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]); const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      if ((pts[i][0] - cx) * nx + (pts[i][1] - cy) * ny < 0) { nx = -nx; ny = -ny; }
      if (ny > 0 || rnd() < 0.28) return { x: pts[i][0] - nx * 6, y: pts[i][1] - ny * 6, a: Math.atan2(ny, nx) };
    }
    return { x: cx, y: cy + 100, a: Math.PI / 2 };
  }
  const inside = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const bruisePts = (b, f, i, wob = 0.16) => { const pts = []; for (let k = 0; k < 28; k++) { const a = k / 28 * TAU; const r = 1 + wob * (vnoise(Math.cos(a) * 1.5 + 2, Math.sin(a) * 1.5 + 2 + i * 3, 40 + f % 7) - 0.5) * 2; const px = Math.cos(a) * b.rx * r, py = Math.sin(a) * b.ry * r; pts.push([b.x + px * Math.cos(b.rot) - py * Math.sin(b.rot), b.y + px * Math.sin(b.rot) + py * Math.cos(b.rot)]); } return smooth(pts, 1); };

  /* ---- grain ---- */
  const grain = document.createElement('canvas'); grain.width = grain.height = 256;
  { const g = grain.getContext('2d'); const im = g.createImageData(256, 256); for (let i = 0; i < im.data.length; i += 4) { const v = 180 + Math.random() * 75; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); }

  const C = { yellow: '#F6F000', warm: '#F0D800', rim: '#E2B400', bruise: '#DCA20A', bruiseLight: '#EEC100', stalk: '#A09CB0', stalkTip: '#B58466', calyxHalo: '#D59A12', calyx: '#5A5A20', ink: '#2A2C33' };
  const BIG = 2000;
  const fillAll = (ctx) => ctx.fillRect(-BIG, -BIG, BIG * 2, BIG * 2);

  /* the stalk as a path: base to tip through the bend */
  function stalkPath(ctx, s, wig = 0, inset = 0) {
    const dx = s.t[0] - s.b[0], dy = s.t[1] - s.b[1], L = Math.hypot(dx, dy) || 1;
    const px = -dy / L, py = dx / L;
    const b = [s.b[0] + dx / L * inset, s.b[1] + dy / L * inset], t = [s.t[0] + px * wig * L * 0.5, s.t[1] + py * wig * L * 0.5], c = [s.c[0] + px * wig * L * 0.25, s.c[1] + py * wig * L * 0.25];
    ctx.beginPath(); ctx.moveTo(...b); ctx.quadraticCurveTo(...c, ...t);
  }
  const stalkWiggle = (o) => Math.sin(o.t * 38) * 0.18 * o.agitation + (vnoise(o.f * 0.5, 0, 21) - 0.5) * 0.06;

  /* ---- textures ---- */
  const TEX = {};

  /* 1 wash: the GIF. A wet yellow wash, warmer down the belly, ochre bruises bled in, a pooled rim, grain. */
  TEX.wash = { label: 'wash', blurb: 'the GIF: a wet yellow wash, warmer down the belly, ochre bruises bled in, a pooled rim, grain',
    draw(ctx, shape, o) {
      const f = o.f, pts = curve(shape.outline, f, 2.2 + o.agitation * 1), s = shape.stalk;
      ctx.lineCap = 'round'; const wig = stalkWiggle(o);
      // the stalk: one brown stroke, nothing else
      ctx.strokeStyle = C.stalkTip; ctx.lineWidth = s.w; stalkPath(ctx, s, wig, 0); ctx.stroke();
      ctx.save(); trace(ctx, pts); ctx.clip();
      ctx.fillStyle = C.yellow; fillAll(ctx);
      const bb = bounds(pts); const g = ctx.createLinearGradient(0, bb.y0, 0, bb.y1); g.addColorStop(0, 'rgba(240,216,0,0)'); g.addColorStop(1, 'rgba(240,216,0,0.55)'); ctx.fillStyle = g; fillAll(ctx);
      ctx.globalCompositeOperation = 'multiply';
      shape.bruises.forEach((b, i) => { const d = { x: b.x + (vnoise(o.t * 0.12, i, 31) - 0.5) * 10, y: b.y + (vnoise(o.t * 0.12, i, 32) - 0.5) * 10, rx: b.rx, ry: b.ry, rot: b.rot }; const p = bruisePts(d, f, i);
        ctx.save(); ctx.filter = 'blur(9px)'; ctx.globalAlpha = b.a; ctx.fillStyle = C[b.c]; trace(ctx, p); ctx.fill(); ctx.restore();
        ctx.save(); ctx.filter = 'blur(2px)'; ctx.globalAlpha = b.a * 0.35; ctx.fillStyle = C[b.c]; trace(ctx, p); ctx.fill(); ctx.restore(); });
      const k = shape.calyx; ctx.save(); ctx.filter = 'blur(6px)'; ctx.globalAlpha = 0.55; ctx.fillStyle = C.calyxHalo; ctx.beginPath(); ctx.ellipse(k.x, k.y, k.halo, k.halo * 0.8, 0.3, 0, TAU); ctx.fill(); ctx.restore();
      ctx.save(); ctx.filter = 'blur(7px)'; ctx.strokeStyle = C.rim; ctx.globalAlpha = 0.5; ctx.lineWidth = 22; trace(ctx, pts); ctx.stroke(); ctx.restore();
      ctx.globalAlpha = 0.11; ctx.fillStyle = ctx.createPattern(grain, 'repeat'); fillAll(ctx);
      ctx.restore();
    } };

  /* 2 gouache: opaque. Flat yellow laid in with visible brush strokes, bruises as flat ragged ochre shapes, hard edges, a few dry white gaps. */
  TEX.gouache = { label: 'gouache', blurb: 'opaque: flat yellow laid in with visible strokes, bruises as flat ragged ochre shapes, hard edges, dry white gaps',
    draw(ctx, shape, o) {
      const f = o.f, pts = curve(shape.outline, f, 1.6 + o.agitation * 1), s = shape.stalk, wig = stalkWiggle(o);
      ctx.lineCap = 'round'; ctx.strokeStyle = '#8E8AA2'; ctx.lineWidth = s.w; stalkPath(ctx, s, wig, 4); ctx.stroke(); ctx.strokeStyle = '#B4B0C6'; ctx.lineWidth = s.w * 0.35; ctx.globalAlpha = 0.8; stalkPath(ctx, s, wig, 10); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.save(); trace(ctx, pts); ctx.clip();
      ctx.fillStyle = '#F4E100'; fillAll(ctx);
      const bb = bounds(pts), ang = Math.atan2(shape.outline[7][1] - shape.outline[0][1], shape.outline[7][0] - shape.outline[0][0]);
      ctx.save(); ctx.translate((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2); ctx.rotate(ang); ctx.lineCap = 'butt';
      for (let i = -14; i <= 14; i++) { const y = i * 13 + (vnoise(i, f * 0.1, 3) - 0.5) * 6; ctx.strokeStyle = i % 2 ? '#FBEF4A' : '#E9CF00'; ctx.globalAlpha = 0.22 + 0.2 * vnoise(i, 7, 4); ctx.lineWidth = 9 + 10 * vnoise(i, 2, 5); ctx.beginPath(); ctx.moveTo(-320, y); for (let x = -300; x <= 320; x += 40) ctx.lineTo(x, y + (vnoise(x * 0.02, i, 6) - 0.5) * 8); ctx.stroke(); }
      ctx.restore(); ctx.globalAlpha = 1;
      shape.bruises.forEach((b, i) => { const p = bruisePts(b, f, i, 0.2); ctx.fillStyle = b.c === 'bruise' ? '#D99E12' : '#E9BE12'; ctx.globalAlpha = Math.min(1, b.a + 0.35); trace(ctx, p); ctx.fill(); ctx.fillStyle = '#F0CC30'; ctx.globalAlpha = 0.35; trace(ctx, bruisePts({ x: b.x + 4, y: b.y - 3, rx: b.rx * 0.55, ry: b.ry * 0.5, rot: b.rot }, f + 3, i, 0.25)); ctx.fill(); });
      ctx.globalAlpha = 1;
      // dry gaps: short pale strokes the brush skipped, near the edge
      ctx.strokeStyle = '#FFFBE0'; ctx.lineCap = 'round'; for (let i = 0; i < 9; i++) { const q = pts[Math.floor(vnoise(i, 3, 8) * pts.length)]; const a = vnoise(i, 4, 8) * TAU; ctx.globalAlpha = 0.5; ctx.lineWidth = 2 + 3 * vnoise(i, 5, 8); ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0] + Math.cos(a) * 18, q[1] + Math.sin(a) * 18); ctx.stroke(); }
      const k = shape.calyx; ctx.globalAlpha = 0.7; ctx.fillStyle = '#D2991A'; ctx.beginPath(); ctx.ellipse(k.x, k.y, k.halo * 0.8, k.halo * 0.62, 0.3, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#4E4E1C'; ctx.beginPath(); ctx.ellipse(k.x + 2, k.y, k.r, k.r * 0.8, 0.4, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#E3C600'; ctx.lineWidth = 2; ctx.globalAlpha = 0.6; trace(ctx, pts); ctx.stroke(); ctx.globalAlpha = 1;
    } };

  /* 3 crayon: wax. A scribbled fill of short diagonal strokes with the paper showing through, bruises as denser darker scribble, a waxy outline. */
  TEX.crayon = { label: 'crayon', blurb: 'wax: a scribbled fill of short diagonal strokes with paper showing through, bruises as denser scribble, a waxy outline',
    draw(ctx, shape, o) {
      const f = o.f, pts = curve(shape.outline, f, 1.2 + o.agitation * 1), s = shape.stalk, wig = stalkWiggle(o);
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) { ctx.strokeStyle = '#9A96AE'; ctx.globalAlpha = 0.5; ctx.lineWidth = s.w * 0.3; ctx.save(); ctx.translate((vnoise(i, 1, 9) - 0.5) * s.w * 0.7, (vnoise(i, 2, 9) - 0.5) * s.w * 0.7); stalkPath(ctx, s, wig, 4); ctx.stroke(); ctx.restore(); }
      ctx.globalAlpha = 1;
      const bb = bounds(pts), scrib = (colour, lw, step, alpha, seed, region) => {
        ctx.save(); if (region) { trace(ctx, region); ctx.clip(); } ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.globalAlpha = alpha; ctx.lineCap = 'round';
        const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, R = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.55;
        ctx.translate(cx, cy); ctx.rotate(-0.72 + (vnoise(seed, 1, 17) - 0.5) * 0.25); let n = 0;
        for (let y = -R; y <= R; y += step, n++) { const dash = 10 + 40 * vnoise(n, 2, seed), gap = 4 + 14 * vnoise(n, 3, seed); ctx.setLineDash([dash, gap]); ctx.lineDashOffset = vnoise(n, f % 5, seed) * 60; const jy = y + (vnoise(n, 4, seed) - 0.5) * step; ctx.beginPath(); ctx.moveTo(-R, jy); ctx.lineTo(R, jy + (vnoise(n, 5, seed) - 0.5) * 10); ctx.stroke(); }
        ctx.restore(); };
      ctx.save(); trace(ctx, pts); ctx.clip();
      ctx.fillStyle = '#FFFDE8'; fillAll(ctx);
      scrib('#F2D800', 3.2, 4.2, 0.75, 1); scrib('#F7E84A', 2.4, 6, 0.5, 2); scrib('#E8C400', 2, 9, 0.4, 3);
      shape.bruises.forEach((b, i) => { const p = bruisePts(b, f, i, 0.22); scrib(b.c === 'bruise' ? '#D39A12' : '#E6B81A', 3, 3.6, 0.75, 10 + i, p); scrib('#B8820A', 2, 7, 0.4, 20 + i, p); });
      const k = shape.calyx; scrib('#C58F12', 2.6, 3.4, 0.7, 40, bruisePts({ x: k.x, y: k.y, rx: k.halo * 0.8, ry: k.halo * 0.62, rot: 0.3 }, f, 9, 0.2)); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.22; ctx.fillStyle = ctx.createPattern(grain, 'repeat'); fillAll(ctx);
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#4E4E1C'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(k.x + 2, k.y, k.r, k.r * 0.8, 0.4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      ctx.restore();
      ctx.strokeStyle = '#C9A400'; ctx.globalAlpha = 0.75; ctx.lineWidth = 3.2; ctx.lineJoin = 'round'; trace(ctx, curve(shape.outline, f + 2, 2.5)); ctx.stroke(); ctx.globalAlpha = 0.4; ctx.lineWidth = 2; trace(ctx, curve(shape.outline, f + 5, 3.5)); ctx.stroke(); ctx.globalAlpha = 1;
    } };

  /* 4 ink and wash: a sketchbook. A loose pale yellow wash that misses the line, then a dark ink outline of varying weight with breaks, bruises hatched. */
  TEX.inkwash = { label: 'ink and wash', blurb: 'a sketchbook: a loose pale wash that misses the line, a dark ink outline of varying weight with breaks, bruises hatched',
    draw(ctx, shape, o) {
      const f = o.f, pts = curve(shape.outline, f, 2 + o.agitation * 1), s = shape.stalk, wig = stalkWiggle(o);
      // the wash, offset and looser than the line
      const washPts = curve(shape.outline.map((p) => [p[0] + 7, p[1] + 6]), f + 3, 7);
      ctx.save(); ctx.filter = 'blur(1.5px)'; ctx.fillStyle = '#F7EB4C'; ctx.globalAlpha = 0.72; trace(ctx, washPts); ctx.fill(); ctx.restore();
      ctx.save(); trace(ctx, washPts); ctx.clip(); ctx.globalCompositeOperation = 'multiply';
      shape.bruises.forEach((b, i) => { ctx.save(); ctx.filter = 'blur(5px)'; ctx.fillStyle = b.c === 'bruise' ? '#DCA20A' : '#EEC100'; ctx.globalAlpha = b.a * 0.8; trace(ctx, bruisePts({ x: b.x + 6, y: b.y + 5, rx: b.rx, ry: b.ry, rot: b.rot }, f, i)); ctx.fill(); ctx.restore(); });
      ctx.globalAlpha = 0.1; ctx.fillStyle = ctx.createPattern(grain, 'repeat'); fillAll(ctx);
      ctx.restore();
      ctx.save(); ctx.strokeStyle = '#9A96AE'; ctx.globalAlpha = 0.55; ctx.lineCap = 'round'; ctx.lineWidth = s.w * 0.9; ctx.filter = 'blur(1px)'; stalkPath(ctx, s, wig, 8); ctx.stroke(); ctx.restore();
      // the line: segments of varying weight, some skipped
      ctx.strokeStyle = C.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const w = vnoise(i * 0.25, f % 3, 13); if (w < 0.14) continue; ctx.globalAlpha = 0.7 + 0.3 * w; ctx.lineWidth = 1 + 2.4 * w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.globalAlpha = 0.9; ctx.lineWidth = 1.6; stalkPath(ctx, s, wig, 2); ctx.stroke();
      { const dx = s.t[0] - s.b[0], dy = s.t[1] - s.b[1], L = Math.hypot(dx, dy) || 1, px = -dy / L * s.w * 0.5, py = dx / L * s.w * 0.5; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(s.b[0] + px, s.b[1] + py); ctx.quadraticCurveTo(s.c[0] + px, s.c[1] + py, s.t[0] + px * 0.4, s.t[1] + py * 0.4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(s.b[0] - px, s.b[1] - py); ctx.quadraticCurveTo(s.c[0] - px, s.c[1] - py, s.t[0] - px * 0.4, s.t[1] - py * 0.4); ctx.stroke(); }
      // bruises hatched
      ctx.lineWidth = 0.9; ctx.globalAlpha = 0.5;
      shape.bruises.forEach((b, i) => { const p = bruisePts(b, f, i, 0.12); ctx.save(); trace(ctx, p); ctx.clip(); for (let d = -b.rx - b.ry; d <= b.rx + b.ry; d += 7 + 3 * vnoise(d, i, 14)) { ctx.beginPath(); ctx.moveTo(b.x + d - 80, b.y - 60); ctx.lineTo(b.x + d + 80, b.y + 60); ctx.stroke(); } ctx.restore(); ctx.globalAlpha = 0.45; ctx.lineWidth = 1.1; trace(ctx, p); ctx.stroke(); ctx.globalAlpha = 0.5; ctx.lineWidth = 0.9; });
      const k = shape.calyx; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.4; for (let r = 0; r < 3; r++) { ctx.beginPath(); ctx.ellipse(k.x + 2 + (vnoise(r, 1, 15) - 0.5) * 3, k.y + (vnoise(r, 2, 15) - 0.5) * 3, k.r * (0.6 + r * 0.25), k.r * (0.5 + r * 0.2), 0.4 + r * 0.5, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(k.x + 2, k.y, k.r * 0.45, k.r * 0.35, 0.4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    } };

  /* 5 stipple: dots, like the ants. The pear is a field of fat yellow dots, the bruises ochre dots among them, all re-settling each frame. */
  TEX.stipple = { label: 'stipple', blurb: 'dots, like the ants: a field of fat yellow dots, bruises as ochre dots among them, all re-settling each frame',
    draw(ctx, shape, o) {
      const f = o.f, pts = curve(shape.outline, f, 1.5 + o.agitation * 1), bb = bounds(pts), s = shape.stalk;
      const seedF = f % 4;
      const dot = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
      // stalk: a run of grey dots along the curve
      ctx.fillStyle = '#9A96AE'; for (let i = 0; i <= 10; i++) { const u = i / 10; const x = (1 - u) * (1 - u) * s.b[0] + 2 * (1 - u) * u * s.c[0] + u * u * s.t[0], y = (1 - u) * (1 - u) * s.b[1] + 2 * (1 - u) * u * s.c[1] + u * u * s.t[1]; ctx.globalAlpha = 0.85; dot(x + (hash(i, 1, seedF) - 0.5) * 4, y + (hash(i, 2, seedF) - 0.5) * 4, s.w * (0.3 + 0.2 * hash(i, 3, seedF))); }
      // the body: fat yellow dots inside the outline, deciding ochre where a bruise sits
      const W = bb.x1 - bb.x0, H = bb.y1 - bb.y0, n = Math.round(W * H / 95);
      const bruiseAt = (x, y) => { for (const b of shape.bruises) { const dx = x - b.x, dy = y - b.y, c = Math.cos(-b.rot), sn = Math.sin(-b.rot); const lx = dx * c - dy * sn, ly = dx * sn + dy * c; const d = (lx * lx) / (b.rx * b.rx) + (ly * ly) / (b.ry * b.ry); if (d < 1) return { b, d }; } return null; };
      for (let i = 0; i < n; i++) {
        const x = bb.x0 + hash(i, 10, seedF) * W, y = bb.y0 + hash(i, 11, seedF) * H;
        if (!inside(pts, x, y)) continue;
        const hit = bruiseAt(x, y); const r = 3.2 + 3.6 * hash(i, 12, seedF);
        if (hit && hash(i, 13, seedF) < (1 - hit.d) * 1.6) { ctx.fillStyle = hit.b.c === 'bruise' ? '#D99E12' : '#E9BE12'; ctx.globalAlpha = 0.85; dot(x, y, r * 1.05); }
        else { ctx.fillStyle = hash(i, 14, seedF) < 0.75 ? '#F2DF00' : '#F9EE55'; ctx.globalAlpha = 0.8 + 0.2 * hash(i, 15, seedF); dot(x, y, r); }
      }
      const k = shape.calyx; ctx.fillStyle = '#D2991A'; for (let i = 0; i < 10; i++) { const a = hash(i, 20, seedF) * TAU, rr = Math.sqrt(hash(i, 21, seedF)) * k.halo * 0.7; ctx.globalAlpha = 0.8; dot(k.x + Math.cos(a) * rr, k.y + Math.sin(a) * rr * 0.8, 3.5 + 2 * hash(i, 22, seedF)); }
      ctx.fillStyle = '#4E4E1C'; ctx.globalAlpha = 0.95; for (let i = 0; i < 4; i++) { const a = hash(i, 23, seedF) * TAU; dot(k.x + 2 + Math.cos(a) * k.r * 0.45, k.y + Math.sin(a) * k.r * 0.4, k.r * 0.5); }
      ctx.globalAlpha = 1;
    } };

  function paint(ctx, shape, texture, o = {}) {
    ctx.save(); (TEX[texture] || TEX.wash).draw(ctx, shape, { f: o.f ?? 0, t: o.t ?? 0, agitation: o.agitation ?? 0 }); ctx.restore();
  }

  window.Pear = { DEFAULT, copy, TEX, ORDER: ['wash', 'gouache', 'crayon', 'inkwash', 'stipple'], curve, smooth, path2d, centre, bounds, edgePoint, bruisePts, inside, paint, vnoise };
})();
