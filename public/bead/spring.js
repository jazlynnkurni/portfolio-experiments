/* spring.js: springs, not easings. Every motion in the lab is a damped
 * spring solved analytically, so a value overshoots and settles the way a
 * physical thing does, and can be retargeted mid-flight without a jump.
 *
 *   const s = new Spring(0, { stiffness: 180, damping: 18 });
 *   s.to(1);                     // retarget any time
 *   s.update(dt);                // advance; s.v is the value, s.done when still
 *
 *   stagger(i, n, ms)            // a delay per item, in seconds
 *   loop(fn)                     // a rAF loop that hands fn the dt in seconds
 */
class Spring {
  constructor(value = 0, opts = {}) {
    this.v = value; this.vel = 0; this.target = value;
    this.k = opts.stiffness ?? 170; this.c = opts.damping ?? 20; this.m = opts.mass ?? 1;
    this.rest = opts.rest ?? 0.001;
  }
  to(t) { this.target = t; return this; }
  set(v) { this.v = v; this.target = v; this.vel = 0; return this; }
  get done() { return Math.abs(this.v - this.target) < this.rest && Math.abs(this.vel) < this.rest * 10; }
  update(dt) {
    // semi-implicit Euler in small steps keeps stiff springs stable at any frame rate
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-this.k * (this.v - this.target) - this.c * this.vel) / this.m;
      this.vel += a * h; this.v += this.vel * h;
    }
    if (this.done) { this.v = this.target; this.vel = 0; }
    return this.v;
  }
}
const stagger = (i, n, ms = 40) => (i * ms) / 1000;
function loop(fn) {
  let last = null;
  const tick = (now) => { const dt = last == null ? 0 : Math.min(0.05, (now - last) / 1000); last = now; fn(dt, now / 1000); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
/* a cubic bezier evaluated by t, for paths (not for timing) */
function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
}
window.Spring = Spring; window.stagger = stagger; window.loop = loop; window.bez = bez;
