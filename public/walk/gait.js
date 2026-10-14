/* gait.js: a man walking, side on, left to right.
 *
 * The pose is not drawn by hand. Each joint follows the normal walking curves
 * from gait-lab data (Winter, Biomechanics and Motor Control of Human Movement;
 * Perry, Gait Analysis), keyed at the gait events and interpolated smoothly:
 *
 *   0%    right heel strike      hip flexed ~25, knee nearly straight, ankle neutral
 *   0-10  loading response       knee gives to ~15 (the recoil), ankle plantarflexes
 *   10-30 mid stance             the body passes over a straightening leg, highest here
 *   30-50 terminal stance        hip extends to ~-10, heel lifts, ankle dorsiflexes
 *   50-60 pre swing (push off)   ankle plantarflexes hard to ~-15, knee bends to ~40
 *   60-73 initial swing          knee peaks ~62, the foot clears the ground
 *   73-87 mid swing              hip flexes forward, shank swings through
 *   87-100 terminal swing        knee extends for the next heel strike
 *
 * The left leg is the same curve half a cycle later. The arms swing against
 * the legs. The body's forward travel is not a constant we chose: each frame
 * the foot that is on the ground is held still in the world and the body
 * moves by whatever the leg geometry demands, so the planted foot never
 * slides. Height comes from the same place: the hips sit wherever the stance
 * leg puts them, which gives the two-per-cycle bob for free.
 *
 * The briefcase is a pendulum hung from the wrist and driven by its motion.
 *
 * Units: body height H in pixels, canvas y down. Facing +x.
 */

(function () {
  const TAU = Math.PI * 2;
  const rad = (d) => (d * Math.PI) / 180;

  /* periodic Catmull-Rom through [percent, value] keys */
  function curve(keys) {
    const k = keys.map(([p, v]) => [p / 100, v]);
    const n = k.length;
    const val = (i) => k[((i % n) + n) % n][1];
    const pos = (i) => {
      const w = Math.floor(i / n);
      return k[((i % n) + n) % n][0] + w;
    };
    return (t) => {
      t = t - Math.floor(t);
      let i = 0;
      while (i < n - 1 && k[i + 1][0] <= t) i++;
      const t0 = pos(i), t1 = pos(i + 1);
      const u = (t - t0) / (t1 - t0);
      const p0 = val(i - 1), p1 = val(i), p2 = val(i + 1), p3 = val(i + 2);
      // uniform Catmull-Rom; the keys are close to evenly spaced
      const u2 = u * u, u3 = u2 * u;
      return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    };
  }

  /* joint angles in degrees over the cycle, sagittal plane */
  const HIP   = curve([[0, 25], [10, 22], [20, 12], [30, 2], [40, -6], [50, -10], [55, -9], [60, -5], [70, 10], [80, 22], [90, 27]]);
  const KNEE  = curve([[0, 3], [10, 15], [20, 12], [30, 5], [40, 3], [50, 10], [60, 38], [70, 62], [80, 45], [90, 15]]);
  const ANKLE = curve([[0, 0], [10, -5], [20, 2], [30, 6], [40, 9], [50, 8], [55, 0], [60, -15], [65, -12], [75, -3], [85, 0]]);

  /* segment lengths as fractions of body height (Drillis and Contini) */
  const SEG = {
    headR: 0.066, neck: 0.04, torso: 0.288,
    upperArm: 0.172, forearm: 0.146, hand: 0.055,
    thigh: 0.245, shank: 0.246, ankleH: 0.039,
    heel: 0.045, ball: 0.105, toe: 0.05,
    shoulderW: 0.19, hipW: 0.15,
  };

  /* one leg's points relative to the hip joint, for phase t, straight from the
   * joint curves (no ground yet) */
  function legRaw(t, H) {
    const h = rad(HIP(t)), k = rad(KNEE(t)), a = rad(ANKLE(t));
    const phi = h - k;                     // shank angle from vertical, forward +
    const psi = phi + Math.PI / 2 + a;     // foot direction (toes), toes up with dorsiflexion
    const knee = { x: Math.sin(h) * SEG.thigh * H, y: Math.cos(h) * SEG.thigh * H };
    const ankle = { x: knee.x + Math.sin(phi) * SEG.shank * H, y: knee.y + Math.cos(phi) * SEG.shank * H };
    return { knee, ankle, psi, hip: h, kneeA: k, ankleA: a };
  }

  /* the foot hung off an ankle: sole below the joint, heel behind, ball ahead,
   * toes ahead of the ball. Toes bend: the tip never goes below the floor */
  function foot(ankle, psi, H, floorY) {
    const fd = { x: Math.sin(psi), y: Math.cos(psi) };
    const down = { x: -fd.y, y: fd.x };
    const sole = { x: ankle.x + down.x * SEG.ankleH * H, y: ankle.y + down.y * SEG.ankleH * H };
    const heel = { x: sole.x - fd.x * SEG.heel * H, y: sole.y - fd.y * SEG.heel * H };
    const ball = { x: sole.x + fd.x * SEG.ball * H, y: sole.y + fd.y * SEG.ball * H };
    let toe = { x: ball.x + fd.x * SEG.toe * H, y: ball.y + fd.y * SEG.toe * H };
    if (floorY != null && toe.y > floorY) {
      // the toes fold flat along the floor
      toe = { x: ball.x + SEG.toe * H * Math.max(0.6, fd.x), y: Math.min(toe.y, floorY) };
    }
    return { heel, ball, toe, fd };
  }

  /* the lowest point of a foot, the one that would touch the ground */
  function contact(F) { return F.heel.y >= F.ball.y ? F.heel : F.ball; }

  /* two-bone IK: hip at the origin, ankle on target, knee bending forward */
  function solveLeg(target, H) {
    const a = SEG.thigh * H, b = SEG.shank * H;
    let d = Math.hypot(target.x, target.y);
    const dmax = (a + b) * 0.9995;
    let T = target;
    if (d > dmax) { T = { x: target.x * dmax / d, y: target.y * dmax / d }; d = dmax; }
    const theta = Math.atan2(T.x, T.y);
    const alpha = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
    const h = theta + alpha;
    const knee = { x: Math.sin(h) * a, y: Math.cos(h) * a };
    return { knee, ankle: T, hip: h, kneeA: h - Math.atan2(T.x - knee.x, T.y - knee.y) };
  }

  /* Stance schedule: the right foot carries weight from heel strike (0) to
   * toe off (0.62), the left from 0.5 to 1.12. Double support is where both
   * overlap, and the load hands over smoothly across it. */
  const TOE_OFF = 0.62, DS = 0.12;
  const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
  function loadR(t) {
    t = t - Math.floor(t);
    if (t < DS) return smooth(t / DS);                 // taking the load from the left
    if (t < 0.5) return 1;
    if (t < 0.5 + DS) return 1 - smooth((t - 0.5) / DS);  // handing it to the left
    return 0;
  }

  /* Both legs at phase t, relative to the hip, with the ground enforced:
   * the hip sits where the loaded leg puts it, and any foot that would be
   * below the floor, or a loaded foot that would float, is brought to the
   * floor by bending the leg. Returns legs and the hip's height above the floor. */
  function legsAt(t, H) {
    const wR = loadR(t), wL = 1 - wR;
    const rawR = legRaw(t, H), rawL = legRaw(t + 0.5, H);
    const fR = foot(rawR.ankle, rawR.psi, H), fL = foot(rawL.ankle, rawL.psi, H);
    const dR = contact(fR).y, dL = contact(fL).y;
    // the floor, relative to the hip
    const floor = wR * dR + wL * dL;
    const fix = (raw, F, w) => {
      const c = contact(F);
      const err = floor - c.y;            // + means the foot floats above the floor
      const needs = err < -0.001 || (w > 0.001 && err > 0.001);
      if (!needs) return Object.assign({}, raw, foot(raw.ankle, raw.psi, H, floor));
      const target = { x: raw.ankle.x, y: raw.ankle.y + err * (w > 0.001 ? w : 1) };
      const ik = solveLeg(target, H);
      const out = Object.assign({}, raw, { knee: ik.knee, ankle: ik.ankle, hip: ik.hip, kneeA: ik.kneeA });
      return Object.assign(out, foot(ik.ankle, raw.psi, H, floor));
    };
    return { R: fix(rawR, fR, wR), L: fix(rawL, fL, wL), floor, wR, wL };
  }

  /* Precompute the body's path over one cycle at N samples by holding the
   * loaded foot still in the world. The body moves by minus the contact
   * point's movement relative to the hip, blended across double support. */
  function buildPath(H, N) {
    const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1);
    let x = 0, prev = null;
    // the velocity of whichever point is touching, measured on that same
    // point, so the hand-over from heel to ball mid stance is not a jump
    const vel = (F, Fp) => (F.heel.y >= F.ball.y ? F.heel.x - Fp.heel.x : F.ball.x - Fp.ball.x);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const Lg = legsAt(t, H);
      if (prev) x += -(Lg.wR * vel(Lg.R, prev.R) + Lg.wL * vel(Lg.L, prev.L));
      xs[i] = x; ys[i] = -Lg.floor;
      prev = Lg;
    }
    return { xs, ys, stride: xs[N] - xs[0], N };
  }

  function sampleTable(tab, t) {
    t = t - Math.floor(t);
    const f = t * tab.N;
    const i = Math.floor(f), u = f - i;
    const j = Math.min(i + 1, tab.N);
    return [tab.xs[i] * (1 - u) + tab.xs[j] * u, tab.ys[i] * (1 - u) + tab.ys[j] * u];
  }

  /**
   * new Walker({ H, period, lean })
   *   H       body height in px
   *   period  seconds per full cycle (two steps). 1.08 s is the reference clip,
   *           about 111 steps a minute, a brisk commute
   *   lean    forward trunk lean in degrees, the hunch
   */
  class Walker {
    constructor(o = {}) {
      this.H = o.H || 300;
      this.period = o.period || 1.08;
      this.lean = o.lean == null ? 10 : o.lean;
      this.bow = o.bow == null ? 22 : o.bow;    // head bowed forward, chin tucked
      /* life: how much the lean wanders. Nobody holds one angle for a whole
       * street: the trunk drifts a few degrees over several strides, pitches
       * a little with every step, and the head follows it with a lag. 0 is a
       * mannequin, 1 is the default, 2 is restless */
      this.life = o.life == null ? 1 : o.life;
      this.t = o.t || 0;                           // cycle phase 0..1
      this.cycles = 0;
      this.x0 = o.x || 0;                          // world x of the hip at t = 0, cycle 0
      this.ground = o.ground || 0;                 // world y of the ground line
      this.path = buildPath(this.H, 240);
      /* the case: angle from vertical, angular velocity, hung from the right wrist */
      this.caseTheta = 0; this.caseOmega = 0;
      this.prevWrist = null;
      this.prevWristV = { x: 0, y: 0 };
      this.pose = this.poseAt(this.t);
    }

    get stride() { return this.path.stride; }
    get speed() { return this.path.stride / this.period; }   // px per second

    /* advance by dt seconds */
    step(dt) {
      this.t += dt / this.period;
      while (this.t >= 1) { this.t -= 1; this.cycles++; }
      while (this.t < 0) { this.t += 1; this.cycles--; }
      const P = this.poseAt(this.t);
      this.pose = P;
      this.integrateCase(P, dt);
      return P;
    }

    /* reset the walker to the left edge or any x */
    place(x) { this.x0 = x - sampleTable(this.path, this.t)[0] - this.cycles * this.stride; this.prevWrist = null; this.prevWristV = { x: 0, y: 0 }; }

    hipX(t = this.t) { return this.x0 + this.cycles * this.stride + sampleTable(this.path, t)[0]; }

    /* The full pose at phase t: every point in world px. Pure, so the styles
     * can ask for other phases (ghosts, strobes) without disturbing the walk. */
    poseAt(t, cycles = this.cycles) {
      const H = this.H;
      const [px, py] = sampleTable(this.path, t);
      const hip = { x: this.x0 + cycles * this.stride + px, y: this.ground + py };
      const Lg = legsAt(t, H);
      const R = Lg.R, L = Lg.L;
      const off = (P) => ({ x: hip.x + P.x, y: hip.y + P.y });
      const legW = (Lg) => ({ hip, knee: off(Lg.knee), ankle: off(Lg.ankle), heel: off(Lg.heel), ball: off(Lg.ball), toe: off(Lg.toe), angles: { hip: Lg.hip, knee: Lg.kneeA, ankle: Lg.ankleA } });

      /* trunk: hip to shoulder, leaning forward. The lean is alive: a slow
       * wander over strides (two incommensurate periods, so it never loops),
       * a pitch with every step (the trunk dips a touch at each heel strike
       * and rises through mid stance), and the head riding it with a lag */
      const abs = cycles + t;
      const wander = this.life * (2.6 * Math.sin(TAU * abs / 4.7) + 1.4 * Math.sin(TAU * abs / 2.3 + 1.1) + 0.8 * Math.sin(TAU * abs / 7.9 + 2.4));
      const pitch = this.life * 1.8 * Math.cos(TAU * 2 * (t - 0.04));
      const lean = rad(this.lean + wander + pitch);
      const shoulder = { x: hip.x + Math.sin(lean) * SEG.torso * H, y: hip.y - Math.cos(lean) * SEG.torso * H };
      const nod = this.life * (0.5 * wander - 1.2 * Math.cos(TAU * 2 * (t - 0.12)));
      const bow = lean + rad(this.bow + nod);
      const neckTop = { x: shoulder.x + Math.sin(bow) * SEG.neck * H, y: shoulder.y - Math.cos(bow) * SEG.neck * H };
      const head = { x: neckTop.x + Math.sin(bow) * SEG.headR * H, y: neckTop.y - Math.cos(bow) * SEG.headR * H, r: SEG.headR * H, angle: bow };

      /* arms. Right arm (near side) carries the case and swings less, elbow
       * nearly straight. Left arm swings freely against the left leg. Each arm
       * is in phase with the opposite leg: at right heel strike the right arm
       * is back and the left arm forward. */
      const arm = (sw, back, elbowBase, elbowSwing, phase) => {
        const s = rad(back) + rad(sw) * -Math.cos(TAU * (t + phase));
        const e = rad(elbowBase + elbowSwing * (0.5 + 0.5 * -Math.cos(TAU * (t + phase))));
        const sa = s + lean * 0.4;   // the arm hangs from a leaning trunk
        const elbow = { x: shoulder.x + Math.sin(sa) * SEG.upperArm * H, y: shoulder.y + Math.cos(sa) * SEG.upperArm * H };
        const fa = sa + e;
        const wrist = { x: elbow.x + Math.sin(fa) * SEG.forearm * H, y: elbow.y + Math.cos(fa) * SEG.forearm * H };
        const hand = { x: wrist.x + Math.sin(fa) * SEG.hand * H, y: wrist.y + Math.cos(fa) * SEG.hand * H };
        return { shoulder, elbow, wrist, hand, angles: { shoulder: s * 180 / Math.PI, elbow: e * 180 / Math.PI } };
      };
      const armR = arm(9, -4, 8, 6, 0);        // at t=0 right leg forward, right arm back
      const armL = arm(15, 4, 30, 18, 0.5);

      return {
        t, H, hip, shoulder, neckTop, head,
        legR: legW(R), legL: legW(L), armR, armL,
        lean, ground: this.ground,
        loadR: Lg.wR, stanceR: Lg.wR >= 0.5,
      };
    }

    /* the case swings from the right wrist: a damped pendulum driven by the
     * pivot's acceleration, g scaled to pixels through body height (1.75 m) */
    integrateCase(P, dt) {
      const H = this.H;
      const L = 0.11 * H;                    // handle to the case's centre of mass
      const g = 9.81 * (H / 1.75);
      const w = P.armR.wrist;
      let ax = 0;
      if (this.prevWrist && dt > 0) {
        const vx = (w.x - this.prevWrist.x) / dt, vy = (w.y - this.prevWrist.y) / dt;
        ax = (vx - this.prevWristV.x) / dt;
        this.prevWristV = { x: vx, y: vy };
      }
      this.prevWrist = { x: w.x, y: w.y };
      ax = Math.max(-3 * g, Math.min(3 * g, ax)) * 0.6;   // a hand damps its own case
      const n = 4, h = dt / n;
      for (let i = 0; i < n; i++) {
        const th = this.caseTheta;
        const alpha = -(g / L) * Math.sin(th) - (ax / L) * Math.cos(th) - 4.0 * this.caseOmega;
        this.caseOmega += alpha * h;
        this.caseTheta += this.caseOmega * h;
      }
      P.case = this.casePoints(P, this.caseTheta);
      return P.case;
    }

    /* case geometry for a given swing angle (so strobes can draw the case too) */
    casePoints(P, theta) {
      const H = this.H;
      const w = P.armR.wrist;
      const hang = 0.04 * H;                 // handle height
      const cw = 0.17 * H, ch = 0.125 * H;   // the case
      const dir = { x: Math.sin(theta), y: Math.cos(theta) };
      const top = { x: w.x + dir.x * hang, y: w.y + dir.y * hang };
      const centre = { x: top.x + dir.x * ch / 2, y: top.y + dir.y * ch / 2 };
      return { pivot: w, top, centre, theta, w: cw, h: ch };
    }
  }

  /* convenience: the ordered stroke chains of a pose, far side first */
  function chains(P) {
    return {
      far: [
        [P.armL.shoulder, P.armL.elbow, P.armL.wrist, P.armL.hand],
        [P.legL.hip, P.legL.knee, P.legL.ankle],
        [P.legL.heel, P.legL.ankle, P.legL.ball, P.legL.toe],
      ],
      trunk: [[P.hip, P.shoulder, P.neckTop]],
      near: [
        [P.legR.hip, P.legR.knee, P.legR.ankle],
        [P.legR.heel, P.legR.ankle, P.legR.ball, P.legR.toe],
        [P.armR.shoulder, P.armR.elbow, P.armR.wrist, P.armR.hand],
      ],
    };
  }

  window.Gait = { Walker, SEG, HIP, KNEE, ANKLE, chains, curve, loadR, legsAt };
})();
