/* shade.js: the man as a shade, not a stick figure.
 *
 * Every body part is a closed outline authored in its bone's own frame:
 * u runs along the bone from its near joint (0) to its far joint (1), v is
 * across it, positive toward the FRONT of the body (the side he walks
 * toward). Units are fractions of body height H, so the same outlines fit
 * the man at any size. The outline is a control polygon; it is smoothed
 * (Chaikin, twice) before it is filled, so the authored points can be
 * blunt and the result is still a soft, drawn silhouette.
 *
 * The parts were traced against the reference clip: a stocky man, head
 * bowed, shoulders rounded, waist-length jacket over jeans that bunch at
 * the shoe, the case held low by the near hip. Edit them in shape.html,
 * which saves shade.json next to this file; pages load that file if it
 * exists and fall back to the table below.
 */

(function () {
  const DEFAULT_PARTS = {
    // hip -> shoulder. The jacket: rounded back, the collar standing at the
    // nape, the hem falling below the hip so the trouser top never shows.
    // Measured off the clip: chest depth about 0.2 H, hem 0.1 H under the hip
    torso: { bone: 'torso', pts: [
      [-0.1, -0.08], [-0.03, -0.1], [0.25, -0.112], [0.55, -0.125], [0.82, -0.12], [0.98, -0.095],
      [1.08, -0.05], [1.1, 0.01], [1.04, 0.06], [0.9, 0.095], [0.6, 0.105], [0.3, 0.105], [0.02, 0.098], [-0.1, 0.075], [-0.12, -0.01],
    ] },
    // the head frame: u up the skull, v toward the face. About 0.155 H tall,
    // 0.14 H deep: a big head on a stocky man, bowed by the pose
    head: { bone: 'head', pts: [
      [-0.088, 0.016], [-0.082, -0.03], [-0.058, -0.066], [-0.02, -0.08], [0.03, -0.078], [0.068, -0.054], [0.086, -0.012],
      [0.082, 0.034], [0.062, 0.064], [0.04, 0.074], [0.018, 0.08], [-0.002, 0.09], [-0.022, 0.08], [-0.04, 0.078], [-0.062, 0.07], [-0.08, 0.05],
    ] },
    hair: { bone: 'head', pts: [
      [-0.03, -0.084], [0.03, -0.086], [0.07, -0.062], [0.09, -0.016], [0.088, 0.03], [0.074, 0.058], [0.05, 0.066],
      [0.044, 0.04], [0.04, 0.006], [0.028, -0.03], [0.0, -0.05], [-0.03, -0.054], [-0.06, -0.052], [-0.064, -0.07],
    ] },
    neck: { bone: 'neck', pts: [[-0.1, -0.034], [1.0, -0.044], [1.05, 0.034], [-0.1, 0.034]] },
    // shoulder -> elbow: a full sleeve, round at the shoulder
    upperArm: { bone: 'upperArm', pts: [
      [-0.12, -0.036], [-0.05, -0.054], [0.3, -0.05], [0.7, -0.044], [1.02, -0.038], [1.08, 0.0], [1.02, 0.036], [0.7, 0.042], [0.3, 0.046], [-0.04, 0.054], [-0.11, 0.03],
    ] },
    // elbow -> wrist
    forearm: { bone: 'forearm', pts: [
      [-0.08, -0.04], [0.3, -0.038], [0.7, -0.033], [1.0, -0.03], [1.0, 0.03], [0.7, 0.034], [0.3, 0.04], [-0.08, 0.04],
    ] },
    // wrist -> hand tip, skin
    hand: { bone: 'hand', pts: [[-0.1, -0.024], [0.6, -0.028], [1.15, -0.012], [1.2, 0.012], [1.0, 0.028], [0.5, 0.032], [-0.1, 0.024]] },
    // hip -> knee: jeans, thick, the seat at the back top, a knee at the bottom
    thigh: { bone: 'thigh', pts: [
      [-0.05, -0.1], [0.12, -0.098], [0.4, -0.074], [0.75, -0.06], [0.98, -0.054], [1.06, -0.016], [1.04, 0.036], [0.95, 0.056], [0.6, 0.064], [0.25, 0.076], [0.0, 0.088], [-0.07, 0.036],
    ] },
    // knee -> ankle: the calf at the back, the hem bunching over the shoe
    shank: { bone: 'shank', pts: [
      [-0.06, -0.058], [0.15, -0.068], [0.35, -0.066], [0.6, -0.052], [0.85, -0.048], [1.0, -0.054], [1.07, -0.024], [1.07, 0.034], [0.95, 0.046], [0.7, 0.038], [0.4, 0.04], [0.15, 0.048], [-0.06, 0.054],
    ] },
    // ankle, u along the foot toward the toes, v down. A low shoe with a heel, 0.19 H long
    shoe: { bone: 'foot', pts: [
      [-0.07, 0.012], [-0.066, 0.05], [-0.035, 0.056], [0.06, 0.056], [0.15, 0.056], [0.19, 0.042], [0.185, 0.02], [0.14, 0.008], [0.08, -0.004], [0.035, -0.02], [-0.02, -0.025], [-0.056, -0.012],
    ] },
    // the case, hung from the wrist: u down the hang, v forward. 0.25 H wide,
    // 0.19 H tall, the straps 0.09 H long
    caseBody: { bone: 'case', pts: [
      [0.095, -0.12], [0.09, 0.0], [0.095, 0.12], [0.115, 0.13], [0.26, 0.13], [0.28, 0.12], [0.28, -0.12], [0.26, -0.13], [0.115, -0.13],
    ] },
  };

  /* Chaikin corner cutting on a closed polygon */
  function smooth(pts, n = 2) {
    let p = pts;
    for (let k = 0; k < n; k++) {
      const q = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      p = q;
    }
    return p;
  }

  /* bone frames from a pose: origin, u (along), v (front), length in px */
  function frames(P, H) {
    const mk = (a, b, flip = 1) => {
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const u = { x: dx / L, y: dy / L };
      // v = u rotated so that for a bone pointing down, v points forward (+x)
      const v = { x: -u.y * flip, y: u.x * flip };
      return { o: a, u, v, L };
    };
    const f = {};
    f.torso = mk(P.hip, P.shoulder, -1);          // points up: flip so v is forward
    f.neck = mk(P.shoulder, P.neckTop, -1);
    const hd = P.head;
    const up = { x: Math.sin(hd.angle), y: -Math.cos(hd.angle) };
    f.head = { o: hd, u: up, v: { x: -up.y, y: up.x }, L: H };   // v forward
    f.upperArmR = mk(P.armR.shoulder, P.armR.elbow);
    f.forearmR = mk(P.armR.elbow, P.armR.wrist);
    f.handR = mk(P.armR.wrist, P.armR.hand);
    f.upperArmL = mk(P.armL.shoulder, P.armL.elbow);
    f.forearmL = mk(P.armL.elbow, P.armL.wrist);
    f.handL = mk(P.armL.wrist, P.armL.hand);
    f.thighR = mk(P.legR.hip, P.legR.knee);
    f.shankR = mk(P.legR.knee, P.legR.ankle);
    f.thighL = mk(P.legL.hip, P.legL.knee);
    f.shankL = mk(P.legL.knee, P.legL.ankle);
    const foot = (Lg) => { const fd = { x: Lg.ball.x - Lg.heel.x, y: Lg.ball.y - Lg.heel.y }; const n = Math.hypot(fd.x, fd.y) || 1; const u = { x: fd.x / n, y: fd.y / n }; return { o: Lg.ankle, u, v: { x: -u.y, y: u.x }, L: H }; };
    f.footR = foot(P.legR); f.footL = foot(P.legL);
    if (P.case) { const c = P.case; const u = { x: Math.sin(c.theta), y: Math.cos(c.theta) }; f.case = { o: c.pivot, u, v: { x: -u.y, y: u.x }, L: H }; }
    return f;
  }

  /* fill one part in a frame. Bones with a length use u in bone lengths for
   * the along axis; the head, foot and case use H for both */
  function fill(ctx, part, F, H, col, alongIsLength) {
    if (!F) return;
    const P = smooth(part.pts);
    ctx.beginPath();
    for (let i = 0; i < P.length; i++) {
      const [u, v] = P[i];
      const au = alongIsLength ? u * F.L : u * H;
      const x = F.o.x + F.u.x * au + F.v.x * v * H;
      const y = F.o.y + F.u.y * au + F.v.y * v * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
  }

  let PARTS = JSON.parse(JSON.stringify(DEFAULT_PARTS));

  const DEFAULT_STYLE = { ink: '#1C1A17', far: '#3B3733', skin: '#C9A88E', hair: '#2A2420', case: '#D08A3C', shoe: '#1C1A17' };

  function draw(ctx, P, st = {}) {
    const s = Object.assign({}, DEFAULT_STYLE, st);
    const H = P.H;
    const F = frames(P, H);
    const p = PARTS;
    // far side first
    fill(ctx, p.thigh, F.thighL, H, s.far, true);
    fill(ctx, p.shank, F.shankL, H, s.far, true);
    fill(ctx, p.shoe, F.footL, H, s.shoeFar || s.far, false);
    fill(ctx, p.upperArm, F.upperArmL, H, s.far, true);
    fill(ctx, p.forearm, F.forearmL, H, s.far, true);
    fill(ctx, p.hand, F.handL, H, s.skin, true);
    // the body
    fill(ctx, p.neck, F.neck, H, s.skin, true);
    fill(ctx, p.torso, F.torso, H, s.ink, true);
    fill(ctx, p.head, F.head, H, s.skin, false);
    fill(ctx, p.hair, F.head, H, s.hair, false);
    // near side
    fill(ctx, p.thigh, F.thighR, H, s.ink, true);
    fill(ctx, p.shank, F.shankR, H, s.ink, true);
    fill(ctx, p.shoe, F.footR, H, s.shoe, false);
    fill(ctx, p.upperArm, F.upperArmR, H, s.ink, true);
    fill(ctx, p.forearm, F.forearmR, H, s.ink, true);
    fill(ctx, p.hand, F.handR, H, s.skin, true);
    if (F.case && s.case !== 'transparent') {
      // handle: two straps from the hand to the case top
      const c = P.case;
      ctx.beginPath();
      const top = 0.095 * H, w = 0.035 * H;
      ctx.moveTo(c.pivot.x + F.case.v.x * w, c.pivot.y + F.case.v.y * w);
      ctx.lineTo(c.pivot.x + F.case.u.x * top + F.case.v.x * w * 1.6, c.pivot.y + F.case.u.y * top + F.case.v.y * w * 1.6);
      ctx.moveTo(c.pivot.x - F.case.v.x * w, c.pivot.y - F.case.v.y * w);
      ctx.lineTo(c.pivot.x + F.case.u.x * top - F.case.v.x * w * 1.6, c.pivot.y + F.case.u.y * top - F.case.v.y * w * 1.6);
      ctx.lineWidth = 0.012 * H; ctx.strokeStyle = s.ink; ctx.lineCap = 'round'; ctx.stroke();
      fill(ctx, p.caseBody, F.case, H, s.case, false);
    }
  }

  /* the editor needs the frames and the raw parts */
  const Shade = {
    draw, frames, smooth,
    get parts() { return PARTS; },
    set parts(p) { PARTS = p; },
    defaults: () => JSON.parse(JSON.stringify(DEFAULT_PARTS)),
    /* load shade.json next to the page if it exists; silent if not */
    async load() {
      try {
        const r = await fetch((window.SHADE_URL || 'shade.json') + '?' + Date.now(), { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j && j.torso) PARTS = j; }
      } catch (e) { /* no saved shape yet */ }
      return PARTS;
    },
  };
  window.Shade = Shade;
})();
