/**
 * FabricSkin - the shared look for the sewn-cloth prototypes.
 *
 * The first pass of these drew line only, at nine percent alpha, on white
 * paper. Structurally right and visually nothing like the reference, because
 * the reference is not a wireframe. Three things were missing and they are all
 * in here.
 *
 * 1. THE PANEL HAS A BODY. Organza is a surface, not an outline. Every cell of
 *    every panel gets a wash of colour, and because the canvas is in multiply,
 *    two panels overlapping in the picture read as two layers of dyed cloth and
 *    go deeper. That accumulation is the whole effect and lines alone cannot
 *    make it: a rim needs to be dark because the cloth doubles back there, not
 *    because four strokes crossed.
 *
 *    Cells are filled one panel at a time in a single path. Cells inside one
 *    panel tile, they do not overlap, so a panel must not darken against
 *    itself. Only cloth in front of other cloth darkens.
 *
 * 2. THE WEAVE IS DRAWN, NOT SUGGESTED. The simulated mesh is coarse, because
 *    solving fabric is expensive, but the drawn thread count is four or five
 *    times finer, interpolated across each simulated cell. Two layers of that
 *    at different projected pitches interfere and throw moire, exactly as two
 *    layers of real organza do, and moire is the single most recognisable thing
 *    about photographs of this work. It cannot be faked with a texture in
 *    screen space, because a screen space grid over a screen space grid lines
 *    up perfectly and stays silent. It has to follow the cloth.
 *
 * 3. THE ROOM TAKES THE COLOUR. In the reference the ceiling and the walls
 *    around the red staircase are pink. A saturated translucent object in a
 *    white room throws its own hue everywhere, so the paper is tinted and there
 *    is a broad soft bounce behind the piece. A neutral white ground is what
 *    was making the object look like a diagram printed on a page.
 */

export type Palette = {
  /** threads, as "r, g, b" */
  line: string;
  /** the body of a panel, as "r, g, b" */
  wash: string;
  /** the room, unlit by the piece */
  paper: [number, number, number];
  /** what the piece throws back onto the room, as "r, g, b" */
  bounce: string;
};

/** Suh red. the hung staircase, and the velvet shade at night. */
export const RED: Palette = {
  line: "212, 32, 30",
  wash: "236, 74, 62",
  paper: [253, 243, 241],
  bounce: "232, 96, 86",
};

/** the cerulean of the sewn cistern. */
export const BLUE: Palette = {
  line: "34, 108, 186",
  wash: "96, 164, 218",
  paper: [242, 247, 252],
  bounce: "110, 172, 220",
};

/** the acid yellow bathroom, which is nearly green where it doubles. */
export const ACID: Palette = {
  line: "176, 168, 18",
  wash: "222, 214, 54",
  paper: [252, 250, 232],
  bounce: "226, 218, 80",
};

/** jade, for the piece that has no reference photograph to answer to. */
export const JADE: Palette = {
  line: "18, 122, 104",
  wash: "76, 170, 148",
  paper: [240, 249, 245],
  bounce: "96, 180, 158",
};

/**
 * The room. A tinted ground plus a broad wash of the piece's own colour behind
 * where it stands, which is the bounce off a saturated translucent object, and
 * a cooler floor so the piece has something to stand on.
 */
export function paintRoom(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: Palette,
  focusX: number,
  focusY: number,
  strength = 1,
) {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgb(${p.paper[0]}, ${p.paper[1]}, ${p.paper[2]})`;
  ctx.fillRect(0, 0, W, H);

  const r = Math.max(W, H) * 0.95;
  const g = ctx.createRadialGradient(focusX, focusY, 0, focusX, focusY, r);
  g.addColorStop(0, `rgba(${p.bounce}, ${0.2 * strength})`);
  g.addColorStop(0.45, `rgba(${p.bounce}, ${0.085 * strength})`);
  g.addColorStop(1, `rgba(${p.bounce}, 0)`);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // the corners of an empty room fall off. no horizon line, nothing to compare
  // the object against, which is what makes it float
  const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.8);
  v.addColorStop(0, "rgba(0, 0, 0, 0)");
  v.addColorStop(1, `rgba(${p.bounce}, 0.1)`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
}

/**
 * The threads inside one simulated cell, bilinear across its four corners.
 * Adds to the current path, so a whole panel goes down as one stroke.
 *
 * Corners run round the cell: a, b, c, d.
 *
 * Pass `kv` when the cell is not square on screen. Real cloth has a fixed
 * thread count per inch: it does not grow a coarser weave where it happens to
 * be stretched, and a simulated cell is not the same size as its neighbours, so
 * a fixed number of threads per cell reads as a diagram of a mesh rather than
 * as a mesh. Deciding the count from the cell's size on screen is what makes it
 * a fabric with a gauge.
 */
export function weaveCell(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  k: number,
  kv?: number,
) {
  const ku = k;
  const kw = kv ?? k;
  for (let s = 1; s < kw; s++) {
    const t = s / kw;
    // warp: from the a-d edge across to the b-c edge
    ctx.moveTo(ax + (dx - ax) * t, ay + (dy - ay) * t);
    ctx.lineTo(bx + (cx - bx) * t, by + (cy - by) * t);
  }
  for (let s = 1; s < ku; s++) {
    const t = s / ku;
    // weft: from the a-b edge across to the d-c edge
    ctx.moveTo(ax + (bx - ax) * t, ay + (by - ay) * t);
    ctx.lineTo(dx + (cx - dx) * t, dy + (cy - dy) * t);
  }
}

/** A cell outline, added to the current path for filling. */
export function washCell(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
) {
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.lineTo(dx, dy);
  ctx.closePath();
}
