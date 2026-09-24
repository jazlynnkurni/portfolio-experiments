/**
 * The blade.
 *
 * THE ONE THING THAT MATTERS HERE: a stroke is drawn WHOLE, every frame, never
 * accumulated segment by segment.
 *
 * The obvious way to do this is to deposit a quad per pointer event as the
 * hand moves. It does not work, and it fails in a way that took a while to
 * see. Two quads that abut exactly still share a row of antialiased pixels, so
 * the seam receives about three quarters of the deposit its neighbours got.
 * In colour that is invisible. In a HEIGHT FIELD it is a groove, and once a
 * light rakes across it every one of those grooves is a lit line running
 * square across the direction of travel. A drag comes out as a grid of tiles.
 * No amount of tuning the light or the profile touches it, because the grid is
 * in the geometry.
 *
 * So the caller keeps the whole spine of the stroke in progress and hands it
 * over each frame, and this file redraws the entire thing from scratch. There
 * are no seams because there are no joins.
 *
 * The cross section is the second thing that matters. Butter that has been
 * spread is broad and SMOOTH across nearly its whole width, with a thin sharp
 * CREST down each side of every pass where the edge lifted and the butter it
 * was pushing stood up. Those crests catch the light as bright hairlines and
 * are most of what reads as butter. Everything else is a quiet surface.
 *
 * Nothing here shades anything. The knife writes pigment onto one canvas and
 * thickness onto another, and impasto.ts turns thickness into light.
 */

export type Knife = {
  /** length of the edge, across the direction of travel, in css px */
  width: number;
  /** how far the blade can drag before it is dry, in css px */
  range: number;
  /** thickness of the broad smooth body of the pass, 0..1 */
  body: number;
  /** the raised lines down each side, where the edge lifted */
  crests: { off: number; w: number; h: number }[];
  /** the odd groove the edge drags through the body */
  furrows: { off: number; w: number; d: number }[];
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** "#rrggbb" to "r,g,b", so a pigment can be given a per stop alpha */
function rgbOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/**
 * Charge the blade.
 *
 * The cross section is ONE BROAD BODY, two thin crests, and a couple of
 * furrows. Not a row of equal ribbons: cutting the edge into fifteen strips of
 * similar thickness makes fifteen visible tubes and the pass comes out as
 * combed noodles. Real spread butter is smooth across almost its whole width,
 * and everything you actually see in it happens at the two sharp lines down
 * the sides and in the occasional groove.
 */
export function loadKnife(width: number, range: number): Knife {
  const half = width / 2;
  const crests = [-1, 1].map((sign) => ({
    off: sign * half * (0.86 + Math.random() * 0.1),
    w: width * (0.05 + Math.random() * 0.035),
    h: 0.5 + Math.random() * 0.28,
  }));
  const furrows: { off: number; w: number; d: number }[] = [];
  const count = Math.random() < 0.55 ? 1 : Math.random() < 0.7 ? 2 : 0;
  for (let i = 0; i < count; i++) {
    furrows.push({
      off: (Math.random() - 0.5) * width * 1.3,
      w: width * (0.04 + Math.random() * 0.07),
      d: 0.2 + Math.random() * 0.3,
    });
  }
  return {
    width,
    range,
    body: 0.42 + Math.random() * 0.1,
    crests,
    furrows,
  };
}

export type StrokeOpts = {
  /** the transparent sheet the knife spreads onto */
  paint: CanvasRenderingContext2D;
  /** the greyscale sheet the knife builds thickness onto */
  height: CanvasRenderingContext2D;
  knife: Knife;
  /** the spine of the stroke so far, as flat x,y pairs */
  pts: number[];
  /** css colour of whatever the blade is carrying */
  pigment: string;
  /** true to take butter back off instead of laying it down */
  scrape: boolean;
};

/** arc length at every point of the spine */
function lengths(pts: number[]): number[] {
  const out = [0];
  for (let i = 2; i < pts.length; i += 2) {
    out.push(
      out[out.length - 1] +
        Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]),
    );
  }
  return out;
}

/**
 * The spine pushed sideways by `off`, following the local direction, so an
 * offset ribbon tracks a curve instead of shearing off it.
 */
function ribbon(c: CanvasRenderingContext2D, pts: number[], off: number) {
  const n = pts.length / 2;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const p = Math.max(0, i - 1);
    const q = Math.min(n - 1, i + 1);
    let tx = pts[q * 2] - pts[p * 2];
    let ty = pts[q * 2 + 1] - pts[p * 2 + 1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const x = pts[i * 2] - ty * off;
    const y = pts[i * 2 + 1] + tx * off;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
}

/** how loaded the blade still is that far along the drag */
const loadAt = (dist: number, range: number) =>
  clamp(1 - dist / range, 0, 1);

/**
 * Lay the whole stroke. Call it every frame with the spine so far, having
 * first restored the sheets to how they looked when the stroke began.
 */
export function layStroke(o: StrokeOpts) {
  const { knife, pts } = o;
  const n = pts.length / 2;
  if (n < 2) return;

  const dist = lengths(pts);
  const total = dist[dist.length - 1];
  if (total < 0.6) return;

  const rgb = rgbOf(o.pigment);
  const hc = o.height;
  const pc = o.paint;

  // the taper runs ALONG the stroke, so it is a gradient from the first point
  // to the last rather than anything per segment
  const gx0 = pts[0];
  const gy0 = pts[1];
  const gx1 = pts[(n - 1) * 2];
  const gy1 = pts[(n - 1) * 2 + 1];
  const STOPS = 10;
  const ramp = (
    c: CanvasRenderingContext2D,
    colour: string,
    gain: number,
  ) => {
    const g = c.createLinearGradient(gx0, gy0, gx1, gy1);
    for (let s2 = 0; s2 <= STOPS; s2++) {
      const t = s2 / STOPS;
      const a = clamp(loadAt(t * total, knife.range) * gain, 0, 1);
      g.addColorStop(t, `rgba(${colour},${a.toFixed(3)})`);
    }
    return g;
  };

  hc.save();
  pc.save();
  hc.lineCap = "round";
  pc.lineCap = "round";
  hc.lineJoin = "round";
  pc.lineJoin = "round";

  if (o.scrape) {
    hc.globalCompositeOperation = "destination-out";
    pc.globalCompositeOperation = "destination-out";
    hc.strokeStyle = "rgba(0,0,0,0.55)";
    pc.strokeStyle = "rgba(0,0,0,0.6)";
    hc.lineWidth = knife.width;
    pc.lineWidth = knife.width;
    ribbon(hc, pts, 0);
    hc.stroke();
    ribbon(pc, pts, 0);
    pc.stroke();
    hc.restore();
    pc.restore();
    return;
  }

  // thickness saturates rather than adding, so going over the same butter
  // twice evens it out instead of piling it up, which is what spreading is
  hc.globalCompositeOperation = "source-over";
  pc.globalCompositeOperation = "source-over";

  // 1. the body: one wide smooth pass, and the pigment that goes with it
  pc.strokeStyle = ramp(pc, rgb, 2.4);
  pc.lineWidth = knife.width;
  ribbon(pc, pts, 0);
  pc.stroke();

  hc.strokeStyle = ramp(hc, "255,255,255", knife.body);
  hc.lineWidth = knife.width * 0.94;
  ribbon(hc, pts, 0);
  hc.stroke();

  // 2. the furrows, taken back out of the body rather than added to it
  hc.globalCompositeOperation = "destination-out";
  for (const f of knife.furrows) {
    hc.strokeStyle = ramp(hc, "0,0,0", f.d);
    hc.lineWidth = f.w;
    ribbon(hc, pts, f.off);
    hc.stroke();
  }

  // 3. the crests. thin, high, and the reason any of this reads as butter
  hc.globalCompositeOperation = "source-over";
  for (const c of knife.crests) {
    hc.strokeStyle = ramp(hc, "255,255,255", c.h);
    hc.lineWidth = c.w;
    ribbon(hc, pts, c.off);
    hc.stroke();
  }

  hc.restore();
  pc.restore();
}

/** how far the blade has been dragged, so the caller can show what is left */
export function strokeLoad(knife: Knife, pts: number[]): number {
  if (pts.length < 4) return 1;
  const d = lengths(pts);
  return loadAt(d[d.length - 1], knife.range);
}
