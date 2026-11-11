import { RIM } from "../config";
import type { HeightLayer } from "./compose";

export type RimParams = typeof RIM;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Rim height as a function of distance d (px) inward from the outline.
// 0 .. peak         quarter-round bullnose, vertical at the very edge
// peak .. bead      falls to the groove floor
// bead .. +1.5      climbs out of the groove onto the fillet
// fillet            settles down onto the flat field (height 0)
export function rimProfile(d: number, p: RimParams = RIM): number {
  const dd = Math.max(0, d);
  const peak = p.beadWidth * 0.45;
  const groove = p.filletHeight - p.grooveDepth;
  const grooveEnd = p.beadWidth + 1.5;

  if (dd < peak) {
    const t = (peak - dd) / peak; // 1 at the edge, 0 at the peak
    return -p.edgeDrop + (p.beadHeight + p.edgeDrop) * Math.sqrt(1 - t * t);
  }
  if (dd < p.beadWidth) {
    const t = smooth((dd - peak) / (p.beadWidth - peak));
    return p.beadHeight + (groove - p.beadHeight) * t;
  }
  if (dd < grooveEnd) {
    const t = smooth((dd - p.beadWidth) / (grooveEnd - p.beadWidth));
    return groove + (p.filletHeight - groove) * t;
  }
  if (dd < grooveEnd + p.filletWidth) {
    const t = smooth((dd - grooveEnd) / p.filletWidth);
    return p.filletHeight * (1 - t);
  }
  return 0;
}

export const rimLayer: HeightLayer = {
  name: "rim",
  height: (_x, _y, d) => rimProfile(d),
};
