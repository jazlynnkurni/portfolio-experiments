/**
 * The slice, and the room it sits in.
 *
 * Everything soft. No hard cuts anywhere, because the whole point of the plate
 * is the one hard-edged thing on it, which is the butter you drag across it.
 * The bread has to read as a warm, slightly out of focus object sitting in a
 * bright empty room, so it is built from broad fills and long soft shadows and
 * nothing is outlined.
 *
 * The crumb carries its own pores. That matters more than it sounds: the
 * lighting shader takes its ground relief from the luminance gradient of this
 * canvas, so every pore becomes a real dimple that catches the same raking
 * light as the butter, and butter dragged over it fills them in. The bread
 * gets its texture and its response to the knife from the same drawing.
 *
 * Laid out at a fixed reference size and scaled, so a resize cannot re-roll it
 * into a different loaf.
 */

export const PALETTE = {
  air: "#ffffff",
  crust: "#cf9553",
  crustDark: "#ab6f34",
  crumb: "#f7ead2",
};

/** what the knife can be loaded with */
export const PIGMENTS = [
  { key: "butter", css: "#f0d88c" },
  { key: "browned butter", css: "#dfb45f" },
  { key: "cultured", css: "#f9edcd" },
  { key: "jam", css: "#e78ba2" },
  { key: "matcha", css: "#c2d9a3" },
];

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REF_W = 1600;
const REF_H = 1000;

/** the slice, as one closed path: straight sides, soft shoulders, domed top */
function sliceOutline(ctx: CanvasRenderingContext2D) {
  const L = 425;
  const R = 1175;
  const TOP = 100;
  const SHOULDER = 380;
  const BOT = 900;
  ctx.beginPath();
  ctx.moveTo(L, BOT - 40);
  ctx.quadraticCurveTo(L, BOT, L + 52, BOT);
  ctx.lineTo(R - 52, BOT);
  ctx.quadraticCurveTo(R, BOT, R, BOT - 40);
  ctx.lineTo(R, SHOULDER);
  // the dome bulges a little past the sides, the way a tin loaf rises
  ctx.bezierCurveTo(R + 38, SHOULDER - 140, R - 66, TOP, 800, TOP);
  ctx.bezierCurveTo(L + 66, TOP, L - 38, SHOULDER - 140, L, SHOULDER);
  ctx.closePath();
}

export function paintLoaf(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  const rnd = mulberry(0xb0774e);
  ctx.save();
  /*
    scale, NOT setTransform. The caller has already put a device pixel ratio
    transform on this context, and replacing it outright drew the whole loaf at
    css scale into a canvas sized in device pixels, so on any retina display
    the bread covered the top left corner and the rest of the ground stayed
    unpainted. The ground canvas is opaque, so unpainted came out black.
  */
  ctx.scale(w / REF_W, h / REF_H);
  const W = REF_W;
  const H = REF_H;

  // 1. the room: white, and nothing else in it
  ctx.fillStyle = PALETTE.air;
  ctx.fillRect(0, 0, W, H);

  // 2. the shadow it casts, long and very soft, thrown away from the light
  const shade = ctx.createRadialGradient(800, 918, 20, 800, 918, 430);
  shade.addColorStop(0, "rgba(163,146,124,0.3)");
  shade.addColorStop(0.55, "rgba(163,146,124,0.1)");
  shade.addColorStop(1, "rgba(163,146,124,0)");
  ctx.fillStyle = shade;
  ctx.save();
  ctx.translate(0, 0);
  ctx.scale(1, 0.3);
  ctx.beginPath();
  ctx.arc(800, 918 / 0.3, 430, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 3. the crust, drawn as the whole silhouette so the crumb can sit inside it
  ctx.fillStyle = PALETTE.crust;
  sliceOutline(ctx);
  ctx.fill();
  // the crust is darker where it turned away from the oven roof
  const bake = ctx.createLinearGradient(0, 100, 0, 900);
  bake.addColorStop(0, "rgba(171,111,52,0.62)");
  bake.addColorStop(0.3, "rgba(171,111,52,0.05)");
  bake.addColorStop(1, "rgba(171,111,52,0.42)");
  ctx.fillStyle = bake;
  sliceOutline(ctx);
  ctx.fill();

  // 4. the crumb, inset from the crust by the thickness of the bake
  ctx.save();
  sliceOutline(ctx);
  ctx.clip();
  ctx.fillStyle = PALETTE.crumb;
  ctx.save();
  ctx.translate(800, 500);
  ctx.scale(0.962, 0.955);
  ctx.translate(-800, -500);
  sliceOutline(ctx);
  ctx.fill();
  ctx.restore();

  // 5. the pores. clipped to the crumb, denser toward the middle, and each one
  // a soft dimple rather than a dot, because the shader will read them as
  // relief and a hard dot would come back as a crater
  // many more, much smaller, much paler. The earlier pass used a few big dark
  // blobs and the slice read as mould rather than as crumb: real bread is a
  // fine even sponge, and its pores are barely a shade under the surface
  for (let i = 0; i < 1400; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.55);
    const px = 800 + Math.cos(a) * r * 358;
    const py = 500 + Math.sin(a) * r * 378;
    const rad = 2 + Math.pow(rnd(), 2.8) * 11;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, "rgba(214,190,152,0.3)");
    g.addColorStop(0.6, "rgba(222,201,166,0.14)");
    g.addColorStop(1, "rgba(230,212,183,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, py, rad, rad * (0.6 + rnd() * 0.6), rnd() * 3.1, 0, 6.3);
    ctx.fill();
  }
  // a broad shading across the crumb so the slice is not flat
  const crumbLight = ctx.createLinearGradient(480, 180, 1150, 880);
  crumbLight.addColorStop(0, "rgba(255,251,240,0.7)");
  crumbLight.addColorStop(0.5, "rgba(255,249,233,0)");
  crumbLight.addColorStop(1, "rgba(198,168,124,0.4)");
  ctx.fillStyle = crumbLight;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.restore();
}
