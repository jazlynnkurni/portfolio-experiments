import { IMPERFECTIONS } from "../config";
import type { HeightLayer } from "./compose";
import { fbm } from "./noise";

// Slow, uneven surface waviness from hand pressing. Faded out over the rim so
// the bevel keeps a clean molded edge.
export const imperfectionLayer: HeightLayer = {
  name: "imperfections",
  height: (x, y, d) => {
    const p = IMPERFECTIONS;
    const fade = Math.min(1, Math.max(0, (d - 10) / 20));
    return p.waviness * fade * fbm(x / p.wavinessScale, y / p.wavinessScale, 3, p.seed);
  },
};
