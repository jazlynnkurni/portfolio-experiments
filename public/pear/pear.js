/* pear.js: a watercolour pear lying on white, painted once per boil frame
   so its edges and bruises re-wobble twelve times a second like a
   hand-painted loop; ants amble on and around it; when the pointer
   touches the pear it rustles on a spring and ants pour out from under
   it, and when the pointer leaves they go back home. */
(() => {
  /* ---------- small tools ---------- */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const sstep = (a, b, v) => { const u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  const hash = (x, y, z) => { let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
  /* value noise in [0,1], smooth in x and y */
  function vnoise(x, y, z = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash(xi, yi, z), hash(xi + 1, yi, z), u), lerp(hash(xi, yi + 1, z), hash(xi + 1, yi + 1, z), u), v);
  }
  const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
  class Spring {
    constructor(k = 90, d = 7) { this.x = 0; this.v = 0; this.k = k; this.d = d; }
    step(dt, target = 0) { const a = -this.k * (this.x - target) - this.d * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
  }

  let lastF = -1;
  /* ---------- the pear: shape and skin from the pear studio (pear.html), saved in pear.json ---------- */
  let pearShape = Pear.copy(Pear.DEFAULT), pearTex = 'wash', CENTRE = Pear.centre(pearShape), RIM = Pear.curve(pearShape.outline);
  fetch('pear.json?' + Date.now()).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.shape) { pearShape = j.shape; if (j.texture) pearTex = j.texture; CENTRE = Pear.centre(pearShape); RIM = Pear.curve(pearShape.outline); lastF = -1; } }).catch(() => {});
  const paint = document.createElement('canvas');
  function paintPear(f, t, agitation) {
    const S = 540, dpr = Math.min(2, devicePixelRatio || 1), pad = 90;
    paint.width = (S + pad * 2) * dpr; paint.height = (S + pad * 2) * dpr;
    const ctx = paint.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr);
    Pear.paint(ctx, pearShape, pearTex, { f, t, agitation });
    return pad;
  }

  /* ---------- the ants ----------
     Every ant comes out from under the pear's rim and goes back under it.
     enter: slides out from beneath the edge, small and wriggling, drawn
     under the pear so the rim reveals it. roam: wanders, on and around the
     pear. return: walks to a door on the edge. exit: slips back under,
     shrinking, and is gone. Residents keep a small crowd going; the hover
     burst uses the same doors, only faster. */
  const ants = [];
  let antId = 0;
  const DOOR_IN = 16;   // how far under the rim an ant starts and ends
  function makeAnt(kind) {
    const d = Pear.edgePoint(pearShape, Math.random);
    const an = { id: antId++, kind, door: d, x: d.x - Math.cos(d.a) * DOOR_IN, y: d.y - Math.sin(d.a) * DOOR_IN, a: d.a, state: 'enter', age: 0, stateAge: 0,
      speed: 0, phase: rnd(0, TAU), panic: kind === 'out' ? 1 : 0, size: rnd(0.85, 1.15), seed: rnd(0, 100), life: kind === 'out' ? 1e9 : rnd(6, 16), scale: 0.5 };
    ants.push(an); return an;
  }
  /* the nearest door to an ant, from a few samples, so the way back is short */
  function doorNear(an) { let best = null, bd = 1e9; for (let i = 0; i < 8; i++) { const d = Pear.edgePoint(pearShape, Math.random); const k = Math.hypot(d.x - an.x, d.y - an.y); if (k < bd) { bd = k; best = d; } } return best; }
  function stepAnt(an, dt, t, hovered) {
    an.age += dt; an.stateAge += dt;
    const n1 = vnoise(t * 0.9 + an.seed, an.id * 0.37, 51) - 0.5;
    let turn = 0, cruise;
    if (an.state === 'enter') {
      // out from under the rim, wriggling, growing to full size
      turn = Math.sin(an.stateAge * 34 + an.seed) * 2.2 * Math.max(0, 1 - an.stateAge * 1.6);
      cruise = an.kind === 'out' ? 160 : 46; an.scale = Math.min(1, 0.5 + an.stateAge * 1.1);
      const out = (an.x - an.door.x) * Math.cos(an.door.a) + (an.y - an.door.y) * Math.sin(an.door.a);
      if (out > 10) { an.state = 'roam'; an.stateAge = 0; an.scale = 1; }
    } else if (an.state === 'roam') {
      turn = n1 * 3.2 + (an.panic > 0.2 ? (vnoise(t * 9 + an.seed, 3, 52) - 0.5) * 9 * an.panic : 0);
      turn += keepOff(an, dt, 1);
      const dx = an.x - CENTRE[0], dy = an.y - CENTRE[1], dist = Math.hypot(dx, dy);
      const reach = an.kind === 'out' ? 330 : 250;
      if (dist > reach) { const back = Math.atan2(-dy, -dx); turn += Math.atan2(Math.sin(back - an.a), Math.cos(back - an.a)) * 2.5; }
      cruise = an.kind === 'out' ? lerp(45, 210, an.panic) : lerp(22, 40, vnoise(an.seed, 1, 53));
      if (an.age > an.life) { an.state = 'return'; an.stateAge = 0; an.door = doorNear(an); }
    } else if (an.state === 'return') {
      const to = Math.atan2(an.door.y - an.y, an.door.x - an.x); turn = Math.atan2(Math.sin(to - an.a), Math.cos(to - an.a)) * 6 + n1 * 1.2;
      cruise = an.kind === 'out' ? lerp(60, 170, an.panic) : 48;
      if (Math.hypot(an.door.x - an.x, an.door.y - an.y) > 26) turn += keepOff(an, dt, 0.7);   // skirt the pear on the way to the door, until the door is right there
      if (Math.hypot(an.door.x - an.x, an.door.y - an.y) < 6) { an.state = 'exit'; an.stateAge = 0; an.a = an.door.a + Math.PI; }
    } else {
      // under the rim: a last wriggle, shrinking, then gone
      turn = Math.sin(an.stateAge * 40 + an.seed) * 2.5; cruise = 50; an.scale = Math.max(0.45, 1 - an.stateAge * 1.2);
      if (an.stateAge > 0.5) an.dead = true;
    }
    an.a += turn * dt;
    an.panic = Math.max(0, an.panic - dt * (hovered ? 0.35 : 0.9));
    an.speed += (cruise - an.speed) * Math.min(1, dt * 4);
    // ants scurry in little bursts, the gait modulating the pace
    const burst = 0.55 + 0.45 * Math.abs(Math.sin(an.phase));
    const v = an.speed * burst;
    an.x += Math.cos(an.a) * v * dt; an.y += Math.sin(an.a) * v * dt;
    an.phase += v * dt * 0.55;
  }
  const under = (an) => an.state === 'enter' || an.state === 'exit';
  /* the pear is not for walking on. If the ant's next few steps land inside the rim, it turns
     to face away from the pear's centre; if it is somehow already inside, it is eased out. */
  function keepOff(an, dt, gain) {
    const ahead = 20, px = an.x + Math.cos(an.a) * ahead, py = an.y + Math.sin(an.a) * ahead;
    const outA = Math.atan2(an.y - CENTRE[1], an.x - CENTRE[0]);
    let turn = 0;
    if (Pear.inside(RIM, px, py)) turn += Math.atan2(Math.sin(outA - an.a), Math.cos(outA - an.a)) * 7 * gain;
    if (Pear.inside(RIM, an.x, an.y)) { an.x += Math.cos(outA) * 60 * dt; an.y += Math.sin(outA) * 60 * dt; turn += Math.atan2(Math.sin(outA - an.a), Math.cos(outA - an.a)) * 10; }
    return turn;
  }
  /* the ant's shape and skin come from the ant studio (ant.html), saved in ant.json */
  let antShape = Ant.copy(Ant.DEFAULT), antTex = 'ink';
  fetch('ant.json?' + Date.now()).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.shape) { antShape = j.shape; if (j.texture) antTex = j.texture; } }).catch(() => {});
  function drawAnt(ctx, an, scale, f) {
    ctx.save(); ctx.translate(an.x, an.y); ctx.rotate(an.a);
    Ant.draw(ctx, antShape, antTex, { phase: an.phase, f: f + an.id, scale: an.size * an.scale * scale });
    ctx.restore();
  }

  /* ---------- the stage ---------- */
  const canvas = document.getElementById('stage'), ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  function resize() { W = innerWidth; H = innerHeight; dpr = Math.min(2, devicePixelRatio || 1); canvas.width = W * dpr; canvas.height = H * dpr; scale = Math.min(W, H) / 540 * 0.92; ox = (W - 540 * scale) / 2; oy = (H - 540 * scale) / 2; }
  addEventListener('resize', resize); resize();
  const toLocal = (px, py) => [(px - ox) / scale, (py - oy) / scale];

  const rock = new Spring(110, 6), dip = new Spring(140, 8);
  let hovered = false, agitation = 0, pointer = null, lastPointer = null, pearPath = null, emit = 0, t = 0, lastPaintAg = 0, pad = 0;
  const RESIDENTS = 7; let MAX_OUT = 12, nextResident = 0;

  canvas.addEventListener('pointermove', (e) => { pointer = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerleave', () => { pointer = null; });

  function enter() { hovered = true; MAX_OUT = 8 + Math.floor(Math.random() * 12); /* the cap changes per visit, eight to nineteen */ rock.v += rnd(2.0, 2.8) * (Math.random() < 0.5 ? -1 : 1); dip.v += 70; agitation = 1; const burst = 2 + Math.floor(Math.random() * 7); for (let i = 0; i < burst; i++) spawnOut(); /* a different handful every time, two to eight */ }
  function leave() { hovered = false; for (const an of ants) if (an.kind === 'out' && an.state === 'roam') { an.state = 'return'; an.stateAge = 0; an.door = doorNear(an); an.panic = Math.max(an.panic, 0.4); } }
  function spawnOut() { if (ants.filter((a) => a.kind === 'out').length >= MAX_OUT) return; makeAnt('out'); }

  function step(dt) {
    t += dt;
    // is the pointer on the pear? test in pear space against the unrocked outline, with a little margin
    let on = false;
    if (pointer && pearPath) { const [lx, ly] = toLocal(pointer[0], pointer[1]); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); on = ctx.isPointInPath(pearPath, lx, ly) || ctx.isPointInStroke(pearPath, lx, ly); ctx.restore(); }
    if (on && !hovered) enter(); else if (!on && hovered) leave();
    // movement over the pear keeps it agitated; stillness lets it settle
    if (on && lastPointer && pointer) { const mv = Math.hypot(pointer[0] - lastPointer[0], pointer[1] - lastPointer[1]); agitation = clamp(agitation + mv * 0.03, 0, 1); rock.v += clamp((pointer[0] - lastPointer[0]) * 0.036, -1.5, 1.5); }
    lastPointer = pointer ? pointer.slice() : null;
    agitation = Math.max(0, agitation - dt * (on ? 0.4 : 1.4));
    rock.step(dt); dip.step(dt);
    if (hovered) { emit += dt * (0.6 + Math.random() * 1.4 + agitation * 2.5); /* the trickle wanders too */ while (emit > 1) { emit -= 1; spawnOut(); } }
    // the residents: when the crowd thins, another comes out after a little while
    if (ants.filter((a) => a.kind === 'resident').length < RESIDENTS && t > nextResident) { makeAnt('resident'); nextResident = t + rnd(0.4, 2.2); }
    for (const an of ants) stepAnt(an, dt, t, hovered);
    for (let i = ants.length - 1; i >= 0; i--) if (ants[i].dead) ants.splice(i, 1);
  }

  function draw() {
    const f = Math.floor(t * 12);
    if (f !== lastF || Math.abs(agitation - lastPaintAg) > 0.08) { pad = paintPear(f, t, agitation); lastF = f; lastPaintAg = agitation; pearPath = Pear.path2d(Pear.curve(pearShape.outline)); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    // the pear, rocked around its belly by the spring and trembling while agitated
    const [cx, cy] = CENTRE;
    const tremor = agitation > 0.02 ? (Math.sin(t * 46) * 0.014 + Math.sin(t * 71) * 0.007) * agitation : 0;
    const ang = rock.x * 0.034 + tremor;
    ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
    // the ants still under the rim go down first, so the pear covers them as they come and go
    for (const an of ants) if (under(an)) drawAnt(ctx, an, 1.05, f);
    ctx.translate(cx + (agitation > 0.02 ? (vnoise(t * 30, 0, 61) - 0.5) * 2.5 * agitation : 0), cy + dip.x * 0.09); ctx.rotate(ang); ctx.translate(-cx, -cy);
    ctx.drawImage(paint, -pad, -pad, paint.width / Math.min(2, devicePixelRatio || 1), paint.height / Math.min(2, devicePixelRatio || 1));
    // the ants, in pear space, not rocked with it
    ctx.restore(); ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
    for (const an of ants) if (!under(an)) drawAnt(ctx, an, 1.05, f);
    ctx.restore();
  }

  /* a still for checking: ?hover=1&t=2 pre-runs the hover for that long before the first draw */
  const q = new URLSearchParams(location.search);
  if (q.get('hover')) { resize(); pointer = [ox + CENTRE[0] * scale, oy + CENTRE[1] * scale]; draw(); const secs = parseFloat(q.get('t') || '1.5'); for (let i = 0; i < secs * 60; i++) step(1 / 60); }
  else { for (let i = 0; i < 420; i++) step(1 / 60); }  // let the first residents come out before the first frame

  let last = null;
  function tick(now) { const dt = last == null ? 0 : clamp((now - last) / 1000, 0, 0.05); last = now; step(dt); draw(); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
})();
