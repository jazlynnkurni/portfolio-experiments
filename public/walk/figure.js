/* figure.js: how the businessman is drawn from a pose. One drawing, every
 * style reuses it: a cut-out man, far limbs first, then the trunk and head,
 * then the near limbs and the case. Jacket to the hip, trousers, shoes, the
 * head bowed. Limbs are thick round strokes so the silhouette reads at any
 * size; the styles decide colour and alpha.
 *
 *   drawFigure(ctx, P, { ink, case: colour, skin, far: tint, scale })
 *   drawSkeleton(ctx, P, { stroke, width, joints })
 *   silhouette(ctx, P, colour)   the whole man in one flat colour
 */

(function () {
  function stroke(ctx, pts, w, col) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function shoe(ctx, L, H, col) {
    // a low shoe: heel to toe along the sole, a little height at the ankle
    const a = L.ankle, h = L.heel, b = L.ball, t = L.toe;
    const up = { x: a.x - (h.x + b.x) / 2, y: a.y - (h.y + b.y) / 2 };
    const n = Math.hypot(up.x, up.y) || 1; up.x /= n; up.y /= n;
    const lift = 0.035 * H;
    ctx.beginPath();
    ctx.moveTo(h.x + up.x * lift * 1.6, h.y + up.y * lift * 1.6);
    ctx.lineTo(h.x, h.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(t.x, t.y);
    ctx.lineTo(t.x + up.x * lift * 0.5, t.y + up.y * lift * 0.5);
    ctx.lineTo(b.x + up.x * lift * 0.8, b.y + up.y * lift * 0.8);
    ctx.lineTo(a.x + up.x * lift * 0.2, a.y + up.y * lift * 0.2);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 0.02 * H; ctx.strokeStyle = col; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function leg(ctx, L, H, col, trouser, shoeCol) {
    stroke(ctx, [L.hip, L.knee, L.ankle], trouser, col);
    shoe(ctx, L, H, shoeCol);
  }

  function arm(ctx, A, H, col, w) {
    stroke(ctx, [A.shoulder, A.elbow, A.wrist], w, col);
    // the hand, a touch narrower
    stroke(ctx, [A.wrist, A.hand], w * 0.8, col);
  }

  function trunk(ctx, P, H, col) {
    // the jacket: shoulders wide, hip narrower, a rounded back from the lean
    const s = P.shoulder, h = P.hip;
    const dx = s.x - h.x, dy = s.y - h.y;
    const n = Math.hypot(dx, dy) || 1;
    const nx = -dy / n, ny = dx / n;          // perpendicular (points toward -x for an upright trunk)
    const sw = 0.105 * H, hw = 0.085 * H;
    const back = 0.035 * H;
    ctx.beginPath();
    ctx.moveTo(h.x + nx * hw, h.y + ny * hw);
    ctx.lineTo(s.x + nx * sw, s.y + ny * sw);
    // rounded shoulder cap
    ctx.quadraticCurveTo(s.x + nx * sw * 0.2 - dx * 0.08, s.y + ny * sw * 0.2 - dy * 0.08 - back, s.x - nx * sw * 0.9, s.y - ny * sw * 0.9);
    ctx.lineTo(h.x - nx * hw, h.y - ny * hw);
    // jacket hem, slightly below the hip
    ctx.quadraticCurveTo(h.x - dx * 0.12, h.y - dy * 0.12 + 0.02 * H, h.x + nx * hw, h.y + ny * hw);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    // the hip block under the jacket, so the legs do not cut a notch
    ctx.beginPath(); ctx.arc(h.x, h.y, hw * 0.95, 0, Math.PI * 2); ctx.fill();
  }

  function head(ctx, P, H, skin, hair) {
    const hd = P.head;
    ctx.save();
    ctx.translate(hd.x, hd.y);
    ctx.rotate(hd.angle);
    // neck
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(0, hd.r * 0.95, hd.r * 0.42, hd.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    // face: an egg, chin forward and down
    ctx.beginPath(); ctx.ellipse(0, 0, hd.r * 0.86, hd.r, 0, 0, Math.PI * 2); ctx.fill();
    // nose, a small wedge forward
    ctx.beginPath(); ctx.moveTo(hd.r * 0.8, hd.r * 0.05); ctx.lineTo(hd.r * 1.02, hd.r * 0.25); ctx.lineTo(hd.r * 0.72, hd.r * 0.32); ctx.closePath(); ctx.fill();
    // hair: the back and top of the skull
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.ellipse(-hd.r * 0.12, -hd.r * 0.22, hd.r * 0.82, hd.r * 0.72, 0, Math.PI * 0.98, Math.PI * 2.12);
    ctx.lineTo(-hd.r * 0.9, hd.r * 0.35);
    ctx.lineTo(-hd.r * 0.7, hd.r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function briefcase(ctx, C, H, col, handleCol) {
    if (!C) return;
    ctx.save();
    ctx.translate(C.top.x, C.top.y);
    ctx.rotate(-C.theta);
    // handle
    ctx.beginPath();
    ctx.moveTo(-C.w * 0.14, 0); ctx.lineTo(-C.w * 0.14, -0.035 * H);
    ctx.moveTo(C.w * 0.14, 0); ctx.lineTo(C.w * 0.14, -0.035 * H);
    ctx.arc(0, -0.035 * H, C.w * 0.14, Math.PI, 0);
    ctx.lineWidth = 0.012 * H; ctx.strokeStyle = handleCol; ctx.lineCap = 'round'; ctx.stroke();
    // the body of the case
    const r = 0.014 * H;
    ctx.beginPath();
    ctx.roundRect(-C.w / 2, 0, C.w, C.h, r);
    ctx.fillStyle = col; ctx.fill();
    ctx.restore();
  }

  const DEFAULT = {
    ink: '#1C1A17', far: '#3B3733', skin: '#C9A88E', hair: '#2A2420', case: '#D08A3C', shoe: '#1C1A17',
  };

  function drawFigure(ctx, P, st = {}) {
    if (window.Shade) return window.Shade.draw(ctx, P, st);
    const s = Object.assign({}, DEFAULT, st);
    const H = P.H;
    const trouser = 0.075 * H, sleeve = 0.058 * H;
    // far side first: left arm (unless it is in front of the trunk), left leg
    leg(ctx, P.legL, H, s.far, trouser, s.far);
    arm(ctx, P.armL, H, s.far, sleeve);
    trunk(ctx, P, H, s.ink);
    head(ctx, P, H, s.skin, s.hair);
    leg(ctx, P.legR, H, s.ink, trouser, s.shoe);
    arm(ctx, P.armR, H, s.ink, sleeve);
    briefcase(ctx, P.case, H, s.case, s.ink);
  }

  /* everything in one colour, for masks, stamps and shadows */
  function silhouette(ctx, P, col, withCase = true) {
    drawFigure(ctx, P, { ink: col, far: col, skin: col, hair: col, case: withCase ? col : 'transparent', shoe: col });
  }

  function drawSkeleton(ctx, P, st = {}) {
    const col = st.stroke || '#4c5be4', w = st.width || 1, jr = st.joints == null ? 2.5 : st.joints;
    const ch = window.Gait.chains(P);
    const all = [...ch.far, ...ch.trunk, ...ch.near];
    for (const c of all) stroke(ctx, c, w, col);
    if (P.case) stroke(ctx, [P.case.pivot, P.case.top, P.case.centre], w, col);
    if (jr > 0) {
      ctx.fillStyle = col;
      for (const c of all) for (const p of c) { ctx.beginPath(); ctx.arc(p.x, p.y, jr, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.beginPath(); ctx.arc(P.head.x, P.head.y, P.head.r, 0, Math.PI * 2); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
  }

  window.Figure = { drawFigure, silhouette, drawSkeleton, stroke, briefcase, DEFAULT };
})();
