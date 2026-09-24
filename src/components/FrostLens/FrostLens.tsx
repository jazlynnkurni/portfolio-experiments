"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./FrostLens.module.css";

/*
  FROST LENS
  ----------
  Not a liquid-glass refraction lens. Liquid glass is *smooth* refraction: it
  bends light and moves detail around while keeping it. This is *rough*
  refraction (rough transmission / satin glass), which destroys detail in
  proportion to how far the light travelled through the medium.

  Three things make the reference images read as real frosted glass:

  1. Depth-graded scatter. Blur radius tracks optical thickness, not a constant.
     Where the glass is thin the plate is nearly sharp; where it is thick the
     plate collapses into a colour field. Implemented as a mip pyramid sampled
     at a per-pixel LOD, which is how glTF KHR_materials_transmission does its
     roughness blur too.
  2. A turbid medium, not a clean one. Short wavelengths scatter harder, so blue
     is sampled at a higher LOD than red, transmitted light warms as it goes
     deep, and a cool white haze builds up on the way. That split is what stops
     it looking like a Gaussian blur in Photoshop.
  3. Everything on the surface stays sharp: the printed labels, the specular
     glints, the etched grain. Only what is *behind* the glass dissolves.

  Everything runs off one specimen texture, so this ports anywhere: pass `src`
  for a photo, or leave it out for the procedural Apple-style plate.

  Two shapes share the whole pipeline, because the height field is derived from
  distance to the surface rather than from any particular silhouette. A sphere
  magnifies in both axes; a capsule is a cylindrical lens and only bends across
  its short axis, so it smears a line of text instead of blowing it up.
*/

type FrostLensProps = {
  /** Optional image to scan. Relative paths only, so this stays portable. */
  src?: string;
  /**
   * "full" and "embed" are the framed card. "playground" is the full-bleed dark
   * build: the plate fills the viewport and the controls become floating panels
   * over it, so the droplet reads as an instrument held over the whole page.
   */
  variant?: "full" | "embed" | "playground";
  /** Hide the tuning panel even in the full variant. */
  controls?: boolean;
};

const MAX_BEADS = 16;
const MAX_LEVELS = 9;

/*
  Dialled in by hand against a photographic plate. A photo carries its own
  detail and its own contrast, so it wants a much lighter touch than the
  procedural target did: less scatter and far less turbidity, or the droplet
  turns into an opaque pebble. The slack gets spent on wavelength split and
  sheen instead, which is what keeps it reading as glass rather than as fog.
*/
const DEFAULTS = {
  radius: 81, // droplet radius in css px
  frost: 0.26, // how far up the mip pyramid the thickest point reaches
  chroma: 0.74, // wavelength split between the r/g/b sample LODs
  grain: 0.35, // etched micro-roughness on the droplet surface
  refract: 0.25, // meniscus bend at the rim
  zoom: 1.55, // lens magnification, the "microscope" half of the instrument
  milk: 0.29, // turbidity: warm transmission plus cool scattered haze
  spec: 1.15, // specular sheen strength
  curve: 1.15, // thickness response, close to a true spherical cap
};

type Params = typeof DEFAULTS;

// ---------------------------------------------------------------------------
// specimen plate
// ---------------------------------------------------------------------------

/*
  A mock Apple-style surface, drawn at a fixed reference size and scaled to fit.
  The point is variety of media under one droplet: saturated icon gradients,
  translucent widget glass, a photographic tile, and type running from a 54px
  numeral down to 11px captions. Each of those fails differently under scatter,
  which is the whole reason to scan across them rather than sit on one texture.
*/

const REF_W = 1000;
const REF_H = 750;

const UI_FONT =
  'system-ui, -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';

const INK = "#1C1C1E";
const INK_DIM = "rgba(28, 28, 30, 0.55)";

type IconSpec = { from: string; to: string; glyph: string; label: string };

const ICONS: IconSpec[] = [
  { from: "#5EC26A", to: "#2E9E4A", glyph: "chat", label: "Messages" },
  { from: "#7AC0F5", to: "#2F80D8", glyph: "compass", label: "Safari" },
  { from: "#FF8B7B", to: "#E8453C", glyph: "note", label: "Notes" },
  { from: "#FFC65C", to: "#F09B24", glyph: "clock", label: "Clock" },
  { from: "#C89BF0", to: "#8E5BD0", glyph: "wave", label: "Podcasts" },
  { from: "#F58BB0", to: "#D9457E", glyph: "heart", label: "Health" },
  { from: "#8CD6C8", to: "#3FA394", glyph: "leaf", label: "Weather" },
  { from: "#AEB9C7", to: "#6C7A8C", glyph: "gear", label: "Settings" },
];

function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/* Translucent widget plate. Deliberately low contrast: it is the hardest thing
   on the plate for the droplet to hold on to, and the first to vanish. */
function glassCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 26
) {
  ctx.save();
  ctx.shadowColor = "rgba(40, 30, 60, 0.16)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "rgba(255, 255, 255, 0.66)";
  rrect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1;
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
  ctx.restore();
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  cx: number,
  cy: number,
  r: number
) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
  ctx.lineWidth = r * 0.15;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (glyph === "chat") {
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.06, r * 0.6, r * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.3, cy + r * 0.3);
    ctx.lineTo(cx - r * 0.12, cy + r * 0.62);
    ctx.lineTo(cx + r * 0.04, cy + r * 0.3);
    ctx.closePath();
    ctx.fill();
  } else if (glyph === "compass") {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.3, cy - r * 0.3);
    ctx.lineTo(cx - r * 0.06, cy + r * 0.06);
    ctx.lineTo(cx - r * 0.3, cy + r * 0.3);
    ctx.lineTo(cx + r * 0.06, cy - r * 0.06);
    ctx.closePath();
    ctx.fill();
  } else if (glyph === "note") {
    rrect(ctx, cx - r * 0.44, cy - r * 0.54, r * 0.88, r * 1.08, r * 0.14);
    ctx.fill();
    ctx.strokeStyle = "rgba(200, 120, 40, 0.5)";
    ctx.lineWidth = r * 0.09;
    for (let i = 0; i < 3; i += 1) {
      const ly = cy - r * 0.22 + i * r * 0.26;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.26, ly);
      ctx.lineTo(cx + r * 0.26, ly);
      ctx.stroke();
    }
  } else if (glyph === "clock") {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - r * 0.36);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * 0.26, cy + r * 0.1);
    ctx.stroke();
  } else if (glyph === "wave") {
    for (let i = -2; i <= 2; i += 1) {
      const hh = r * (0.52 - Math.abs(i) * 0.12);
      ctx.beginPath();
      ctx.moveTo(cx + i * r * 0.24, cy - hh);
      ctx.lineTo(cx + i * r * 0.24, cy + hh);
      ctx.stroke();
    }
  } else if (glyph === "heart") {
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.44);
    ctx.bezierCurveTo(cx - r * 0.84, cy - r * 0.12, cx - r * 0.34, cy - r * 0.64, cx, cy - r * 0.2);
    ctx.bezierCurveTo(cx + r * 0.34, cy - r * 0.64, cx + r * 0.84, cy - r * 0.12, cx, cy + r * 0.44);
    ctx.fill();
  } else if (glyph === "leaf") {
    ctx.beginPath();
    ctx.arc(cx - r * 0.14, cy - r * 0.12, r * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + r * 0.22, cy + r * 0.16, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.46, cy + Math.sin(a) * r * 0.46);
      ctx.lineTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function appIcon(
  ctx: CanvasRenderingContext2D,
  spec: IconSpec,
  x: number,
  y: number,
  size: number,
  withLabel: boolean
) {
  ctx.save();
  ctx.shadowColor = "rgba(40, 30, 60, 0.22)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, spec.from);
  g.addColorStop(1, spec.to);
  ctx.fillStyle = g;
  rrect(ctx, x, y, size, size, size * 0.26);
  ctx.fill();
  ctx.restore();

  drawGlyph(ctx, spec.glyph, x + size / 2, y + size / 2, size * 0.4);

  if (withLabel) {
    ctx.save();
    ctx.fillStyle = INK_DIM;
    ctx.font = `500 12px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(spec.label, x + size / 2, y + size + 18);
    ctx.restore();
  }
}

/* A synthetic photograph. Under heavy scatter a real photo collapses to its
   broad colour masses, and so does this, which is the behaviour being shown. */
function photoTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.save();
  rrect(ctx, x, y, w, h, r);
  ctx.clip();

  const sky = ctx.createLinearGradient(x, y, x, y + h);
  sky.addColorStop(0, "#6FB8EE");
  sky.addColorStop(0.5, "#C6E4F7");
  sky.addColorStop(1, "#F7E4C6");
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);

  const sun = ctx.createRadialGradient(
    x + w * 0.74,
    y + h * 0.28,
    0,
    x + w * 0.74,
    y + h * 0.28,
    w * 0.3
  );
  sun.addColorStop(0, "rgba(255, 248, 220, 0.98)");
  sun.addColorStop(1, "rgba(255, 240, 200, 0)");
  ctx.fillStyle = sun;
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = "#68A96C";
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.7);
  ctx.quadraticCurveTo(x + w * 0.3, y + h * 0.52, x + w * 0.62, y + h * 0.68);
  ctx.quadraticCurveTo(x + w * 0.86, y + h * 0.79, x + w, y + h * 0.64);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#417C4A";
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.85);
  ctx.quadraticCurveTo(x + w * 0.42, y + h * 0.7, x + w, y + h * 0.87);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function statusBar(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = `600 15px ${UI_FONT}`;
  ctx.fillText("9:41", 44, 30);

  // signal bars
  for (let i = 0; i < 4; i += 1) {
    const bh = 4 + i * 2.6;
    ctx.fillRect(880 + i * 7, 28 - bh, 4, bh);
  }
  // wifi arcs
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  for (let i = 1; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.arc(921, 30, i * 4.4, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();
  }
  // battery
  ctx.lineWidth = 1.6;
  rrect(ctx, 936, 19, 22, 11, 3.4);
  ctx.stroke();
  ctx.fillStyle = INK;
  rrect(ctx, 938, 21, 14, 7, 2);
  ctx.fill();
  ctx.fillRect(959, 22, 2, 5);
  ctx.restore();
}

function weatherCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  glassCard(ctx, x, y, w, h);
  ctx.save();
  ctx.fillStyle = INK_DIM;
  ctx.font = `600 13px ${UI_FONT}`;
  ctx.fillText("CUPERTINO", x + 24, y + 34);

  ctx.fillStyle = INK;
  ctx.font = `200 54px ${UI_FONT}`;
  ctx.fillText("72°", x + 20, y + 92);

  ctx.font = `500 14px ${UI_FONT}`;
  ctx.fillText("Mostly Sunny", x + 24, y + 118);

  ctx.fillStyle = INK_DIM;
  ctx.font = `400 12px ${UI_FONT}`;
  ctx.fillText("H:78°  L:61°", x + 24, y + 140);
  ctx.restore();
}

function musicCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  glassCard(ctx, x, y, w, h);
  ctx.save();

  const art = ctx.createLinearGradient(x + 22, y + 24, x + 92, y + 94);
  art.addColorStop(0, "#F0708A");
  art.addColorStop(0.5, "#A16BD8");
  art.addColorStop(1, "#4E7FE0");
  ctx.fillStyle = art;
  rrect(ctx, x + 22, y + 24, 70, 70, 12);
  ctx.fill();

  ctx.fillStyle = INK;
  ctx.font = `600 15px ${UI_FONT}`;
  ctx.fillText("Midnight City", x + 106, y + 50);
  ctx.fillStyle = INK_DIM;
  ctx.font = `400 13px ${UI_FONT}`;
  ctx.fillText("M83", x + 106, y + 72);

  // scrubber
  ctx.fillStyle = "rgba(28, 28, 30, 0.16)";
  rrect(ctx, x + 22, y + 118, w - 44, 4, 2);
  ctx.fill();
  ctx.fillStyle = "rgba(28, 28, 30, 0.62)";
  rrect(ctx, x + 22, y + 118, (w - 44) * 0.42, 4, 2);
  ctx.fill();

  ctx.fillStyle = INK_DIM;
  ctx.font = `400 11px ${UI_FONT}`;
  ctx.fillText("1:47", x + 22, y + 142);
  ctx.textAlign = "right";
  ctx.fillText("-2:31", x + w - 22, y + 142);
  ctx.restore();
}

/* The fine-text end of the plate. These 13px preview rows are the first thing
   to become unreadable, which is what makes the dissolve legible as a gradient. */
function messagesCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  glassCard(ctx, x, y, w, h);
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = `600 17px ${UI_FONT}`;
  ctx.fillText("Messages", x + 24, y + 36);

  const rows: Array<[string, string, string, string]> = [
    ["Mom", "Did you eat yet", "9:32", "#F0A0B4"],
    ["Ravi", "pushed the shader fix", "9:18", "#8FC4E8"],
    ["Studio", "call moved to 3pm", "8:54", "#C0AEE8"],
    ["Yuki", "the plate looks unreal", "8:41", "#A8D8C0"],
  ];

  let ry = y + 68;
  for (const [name, preview, time, tint] of rows) {
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(x + 42, ry + 12, 17, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = INK;
    ctx.font = `600 14px ${UI_FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(name, x + 70, ry + 8);

    ctx.fillStyle = INK_DIM;
    ctx.font = `400 13px ${UI_FONT}`;
    ctx.fillText(preview, x + 70, ry + 27);

    ctx.font = `400 11px ${UI_FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(time, x + w - 24, ry + 8);
    ctx.textAlign = "left";

    ry += 46;
  }
  ctx.restore();
}

function drawAppleEnvironment(ctx: CanvasRenderingContext2D) {
  // wallpaper: a soft mesh gradient, the kind that survives scatter as pure hue
  const bg = ctx.createLinearGradient(0, 0, REF_W, REF_H);
  bg.addColorStop(0, "#FDE7D6");
  bg.addColorStop(0.45, "#E9DAF3");
  bg.addColorStop(1, "#D2E7F3");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, REF_W, REF_H);

  const blobs: Array<[number, number, number, string]> = [
    [180, 110, 330, "rgba(255, 188, 148, 0.55)"],
    [830, 190, 300, "rgba(168, 190, 255, 0.5)"],
    [520, 640, 400, "rgba(186, 236, 214, 0.5)"],
    [920, 660, 270, "rgba(255, 202, 224, 0.5)"],
  ];
  for (const [bx, by, br, color] of blobs) {
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, REF_W, REF_H);
  }

  statusBar(ctx);

  ctx.save();
  ctx.fillStyle = INK_DIM;
  ctx.font = `600 12px ${UI_FONT}`;
  ctx.fillText("SUNDAY 23 AUGUST", 44, 76);
  ctx.fillStyle = INK;
  ctx.font = `600 34px ${UI_FONT}`;
  ctx.fillText("Good morning", 44, 116);
  ctx.restore();

  weatherCard(ctx, 44, 142, 270, 170);
  musicCard(ctx, 336, 142, 270, 170);
  photoTile(ctx, 628, 142, 328, 170, 26);

  // icon grid, two rows of four
  for (let i = 0; i < 4; i += 1) {
    appIcon(ctx, ICONS[i], 44 + i * 124, 352, 88, true);
  }
  for (let i = 4; i < 8; i += 1) {
    appIcon(ctx, ICONS[i], 44 + (i - 4) * 124, 486, 88, true);
  }

  messagesCard(ctx, 540, 352, 416, 222);

  // dock
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.shadowColor = "rgba(40, 30, 60, 0.14)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  rrect(ctx, 270, 630, 460, 96, 32);
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < 4; i += 1) {
    appIcon(ctx, ICONS[i], 316 + i * 100, 644, 68, false);
  }
}

// ---------------------------------------------------------------------------
// playground plate
// ---------------------------------------------------------------------------

/*
  The full-bleed dark plate: a row of tilted photo cards, a headline, the blurb
  and an install pill. All of it painted rather than laid out in DOM, because the
  droplet can only dissolve what lives in the texture it samples. The panels and
  nav stay real HTML on top, which is why they remain crisp and clickable.
*/

type SceneKind = "pier" | "gorge" | "hills" | "canyon" | "berries";

const PHOTO_ROW: Array<{ kind: SceneKind; tilt: number; lift: number }> = [
  { kind: "pier", tilt: -7, lift: 16 },
  { kind: "gorge", tilt: 5, lift: -14 },
  { kind: "hills", tilt: -3, lift: 8 },
  { kind: "canyon", tilt: 6, lift: -10 },
  { kind: "berries", tilt: -5, lift: 14 },
];

function photoScene(
  ctx: CanvasRenderingContext2D,
  kind: SceneKind,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.save();
  rrect(ctx, x, y, w, h, r);
  ctx.clip();

  if (kind === "pier") {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#9FC6DE");
    g.addColorStop(0.42, "#DCEAF0");
    g.addColorStop(0.44, "#6E9DB8");
    g.addColorStop(1, "#3E6C87");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#C6A079";
    ctx.beginPath();
    ctx.moveTo(x + w * 0.26, y + h);
    ctx.lineTo(x + w * 0.43, y + h * 0.46);
    ctx.lineTo(x + w * 0.58, y + h * 0.46);
    ctx.lineTo(x + w * 0.8, y + h);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "gorge") {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#8CC0E0");
    g.addColorStop(0.26, "#D6E8F0");
    g.addColorStop(0.3, "#2E7FB8");
    g.addColorStop(1, "#144E7C");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#3C6B42";
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.2);
    ctx.lineTo(x + w * 0.36, y + h * 0.34);
    ctx.lineTo(x + w * 0.3, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#2F5637";
    ctx.beginPath();
    ctx.moveTo(x + w, y + h * 0.24);
    ctx.lineTo(x + w * 0.66, y + h * 0.4);
    ctx.lineTo(x + w * 0.74, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "hills") {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#E8D9A8");
    g.addColorStop(0.4, "#C8CE86");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const bands = ["#9CB45E", "#75954A", "#4E6E38", "#33502A"];
    bands.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, y + h * (0.42 + i * 0.15));
      ctx.quadraticCurveTo(
        x + w * 0.5,
        y + h * (0.32 + i * 0.15),
        x + w,
        y + h * (0.46 + i * 0.15)
      );
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();
    });
  } else if (kind === "canyon") {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#8C2F14");
    g.addColorStop(0.45, "#E0701E");
    g.addColorStop(0.7, "#F0A83C");
    g.addColorStop(1, "#5E1E10");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(90, 26, 12, 0.5)";
    ctx.lineWidth = w * 0.06;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + w * (0.1 + i * 0.2), y);
      ctx.quadraticCurveTo(
        x + w * (0.3 + i * 0.16),
        y + h * 0.5,
        x + w * (0.05 + i * 0.22),
        y + h
      );
      ctx.stroke();
    }
    const shaft = ctx.createLinearGradient(x + w * 0.5, y, x + w * 0.74, y + h);
    shaft.addColorStop(0, "rgba(255, 246, 214, 0.85)");
    shaft.addColorStop(1, "rgba(255, 220, 150, 0)");
    ctx.fillStyle = shaft;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.46, y);
    ctx.lineTo(x + w * 0.66, y);
    ctx.lineTo(x + w * 0.9, y + h);
    ctx.lineTo(x + w * 0.62, y + h);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = "#2E5230";
    ctx.fillRect(x, y, w, h);
    const seed = [0.2, 0.55, 0.82, 0.34, 0.68, 0.15, 0.9, 0.46];
    for (let i = 0; i < 8; i += 1) {
      const bx = x + w * seed[i];
      const by = y + h * seed[(i * 3) % 8];
      const br = w * 0.19;
      const bg = ctx.createRadialGradient(
        bx - br * 0.3,
        by - br * 0.3,
        0,
        bx,
        by,
        br
      );
      bg.addColorStop(0, "#F0645E");
      bg.addColorStop(1, "#B01F26");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPlayground(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
  // ground
  ctx.fillStyle = "#0A0A0B";
  ctx.fillRect(0, 0, cw, ch);

  // the faint dot grid the reference uses, which doubles as a scatter gauge:
  // the dots are the first thing the droplet erases
  ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
  const step = 22;
  for (let gx = step; gx < cw; gx += step) {
    for (let gy = step; gy < ch; gy += step) {
      ctx.fillRect(gx, gy, 1.4, 1.4);
    }
  }

  const k = Math.max(0.62, Math.min(cw / 1500, ch / 950));

  // photo row
  const cardW = 150 * k;
  const cardH = 208 * k;
  const gap = 12 * k;
  const rowW = PHOTO_ROW.length * cardW + (PHOTO_ROW.length - 1) * gap;
  const rowX = (cw - rowW) / 2;
  const rowY = ch * 0.3 - cardH / 2;

  PHOTO_ROW.forEach((card, i) => {
    const x = rowX + i * (cardW + gap);
    const y = rowY + card.lift * k;
    ctx.save();
    ctx.translate(x + cardW / 2, y + cardH / 2);
    ctx.rotate((card.tilt * Math.PI) / 180);
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 26 * k;
    ctx.shadowOffsetY = 10 * k;
    ctx.fillStyle = "#000";
    rrect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, 12 * k);
    ctx.fill();
    ctx.shadowColor = "transparent";
    photoScene(ctx, card.kind, -cardW / 2, -cardH / 2, cardW, cardH, 12 * k);
    ctx.restore();
  });

  // headline
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `600 ${96 * k}px ${UI_FONT}`;
  ctx.fillText("Frost lens.", cw / 2, ch * 0.58);

  // blurb, two lines like the reference
  ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
  ctx.font = `400 ${20 * k}px ${UI_FONT}`;
  ctx.fillText(
    "Rough transmission, not refraction. Scatter tracks optical path length,",
    cw / 2,
    ch * 0.645
  );
  ctx.fillText(
    "so it magnifies at the thin rim and dissolves at the thick centre.",
    cw / 2,
    ch * 0.645 + 32 * k
  );
  ctx.restore();

  // install pill
  const pillW = 560 * k;
  const pillH = 62 * k;
  const pillX = (cw - pillW) / 2;
  const pillY = ch * 0.76;
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  rrect(ctx, pillX, pillY, pillW, pillH, 14 * k);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  rrect(ctx, pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1, 14 * k);
  ctx.stroke();
  ctx.font = `400 ${17 * k}px ${MONO_FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillText("$", pillX + 26 * k, pillY + pillH / 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillText(
    'import FrostLens from "@/components/FrostLens"',
    pillX + 48 * k,
    pillY + pillH / 2
  );
  ctx.restore();
}

/*
  With no `img` this draws one of the two procedural plates. Pass an `img` and it
  cover-fits that instead, so the same component works over a photograph.
*/
function drawSpecimen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  img: HTMLImageElement | null,
  plate: "apple" | "playground",
  dpr: number
) {
  if (img) {
    const r = Math.max(w / img.width, h / img.height);
    const dw = img.width * r;
    const dh = img.height * r;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return;
  }

  if (plate === "playground") {
    // authored in css pixels so type sizes mean what they say at any dpr
    ctx.save();
    ctx.scale(dpr, dpr);
    drawPlayground(ctx, w / dpr, h / dpr);
    ctx.restore();
    return;
  }

  // the apple plate is authored against a fixed reference box and scaled to
  // whatever the canvas actually is, so the layout never has to be responsive
  ctx.save();
  ctx.scale(w / REF_W, h / REF_H);
  drawAppleEnvironment(ctx);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------

// Fullscreen triangle from gl_VertexID, so no vertex buffers anywhere.
const VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/*
  Pyramid build. Thirteen-tap tent downsample rather than a plain box: after six
  or seven levels a box filter shows its square kernel as blocky banding, and the
  whole illusion depends on the blur reading as a smooth scattering cone.
*/
const DOWN_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;

vec3 T(vec2 o) { return texture(uSrc, vUv + uTexel * o).rgb; }

void main() {
  vec3 a = T(vec2(-2.0,  2.0)), b = T(vec2( 0.0,  2.0)), c = T(vec2( 2.0,  2.0));
  vec3 d = T(vec2(-2.0,  0.0)), e = T(vec2( 0.0,  0.0)), f = T(vec2( 2.0,  0.0));
  vec3 g = T(vec2(-2.0, -2.0)), h = T(vec2( 0.0, -2.0)), i = T(vec2( 2.0, -2.0));
  vec3 j = T(vec2(-1.0,  1.0)), k = T(vec2( 1.0,  1.0));
  vec3 l = T(vec2(-1.0, -1.0)), m = T(vec2( 1.0, -1.0));
  vec3 r = e * 0.125
         + (a + c + g + i) * 0.03125
         + (b + d + f + h) * 0.0625
         + (j + k + l + m) * 0.125;
  fragColor = vec4(r, 1.0);
}`;

const MAIN_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uMaxLod;
uniform vec4  uBeads[${MAX_BEADS}];   // xy = centre in gl pixels, z = radius, w = unused
uniform int   uCount;
uniform float uFrost;
uniform float uChroma;
uniform float uGrain;
uniform float uRefract;
uniform float uZoom;
uniform float uMilk;
uniform float uSpec;
uniform float uCurve;
uniform float uInvert;   // 1.0 = frost the page, keep the droplet clear
uniform int   uShape;    // 0 = droplet, 1 = pill
uniform float uPillLen;  // half-length of the pill spine in pixels

float sdCircle(vec2 p, vec2 c, float r) { return length(p - c) - r; }

// polynomial smooth min, so beads merge the way water beads merge
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float scene(vec2 p) {
  // Pill: a capsule, which is a segment thickened by the same radius the
  // droplet uses. Because the height field downstream is derived purely from
  // the distance to the surface, it domes across the short axis and runs flat
  // along the spine on its own, with no shape-specific code. A lozenge of
  // glass, and the Dynamic Island silhouette for free.
  if (uShape == 1) {
    vec2 q = p - uBeads[0].xy;
    q.x -= clamp(q.x, -uPillLen, uPillLen);
    return length(q) - uBeads[0].z;
  }

  float d = sdCircle(p, uBeads[0].xy, uBeads[0].z);
  float k = max(uBeads[0].z * 0.55, 1.0);
  for (int i = 1; i < ${MAX_BEADS}; i++) {
    if (i >= uCount) break;
    d = smin(d, sdCircle(p, uBeads[i].xy, uBeads[i].z), k);
  }
  return d;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i),               hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 p  = gl_FragCoord.xy;
  vec2 uv = p / uRes;

  float d = scene(p);
  float R = max(uBeads[0].z, 1.0);
  vec3 bg = textureLod(uTex, uv, 0.0).rgb;

  // inverted mode: the page is the frosted body and the droplet is the clear
  // window cut through it. Same medium, opposite side of the glass.
  if (uInvert > 0.5) {
    float pageLod = uFrost * uMaxLod * 0.62;
    bg.r = textureLod(uTex, uv, pageLod * 0.9).r;
    bg.g = textureLod(uTex, uv, pageLod).g;
    bg.b = textureLod(uTex, uv, pageLod * 1.16).b;
    bg *= exp(-vec3(0.10, 0.16, 0.26) * uMilk * 1.4);
    bg += vec3(0.80, 0.86, 0.96) * uMilk * 0.24;
  }

  // contact shadow: the droplet is sitting on the plate, not floating over it
  float sd = scene(p + vec2(-5.0, 7.0));
  vec3 outCol = bg * (1.0 - 0.20 * smoothstep(R * 0.7, 0.0, sd));

  float inside = 1.0 - smoothstep(-1.2, 1.2, d);
  if (inside <= 0.001) {
    fragColor = vec4(outCol, 1.0);
    return;
  }

  // Spherical cap height field. u runs 1 at the contact line to 0 at the apex,
  // so h = sqrt(1 - u*u) gives the correct near-vertical wall at the rim, which
  // is where all the Fresnel and dispersion behaviour lives.
  float k = clamp(-d / R, 0.0, 1.0);
  float u = 1.0 - k;
  float h = sqrt(max(1.0 - u * u, 0.0));
  float slope = min(u / sqrt(max(1.0 - u * u, 1e-4)), 6.0);

  // outward gradient of the merged field, by central difference
  vec2 e = vec2(1.5, 0.0);
  vec2 grad = vec2(scene(p + e.xy) - scene(p - e.xy),
                   scene(p + e.yx) - scene(p - e.yx));
  grad = length(grad) > 1e-5 ? normalize(grad) : vec2(0.0);

  vec3 N = normalize(vec3(grad * slope, 1.0));

  // Etched micro-roughness, anchored in droplet space so the frost travels with
  // the droplet instead of crawling across it like screen-space noise. Two
  // octaves, both low frequency: push this near pixel rate and the tight
  // specular starts firing on random texels and the droplet grows a crust.
  vec2 lp = (p - uBeads[0].xy) / R;
  float n1 = (vnoise(lp * 7.0)        - 0.5) + (vnoise(lp * 19.0)         - 0.5) * 0.5;
  float n2 = (vnoise(lp * 7.0 + 31.7) - 0.5) + (vnoise(lp * 19.0 + 11.3)  - 0.5) * 0.5;

  vec3 Nb = N;                                             // macro cap, drives the glint
  N = normalize(N + vec3(n1, n2, 0.0) * uGrain * 0.30);    // etched surface

  float t = pow(h, uCurve);   // optical path length through the cap

  // the microscope half: magnify about the droplet centre, then bend at the rim
  // A sphere magnifies in both axes. A capsule is a cylindrical lens: it only
  // bends across its short axis and leaves the spine direction untouched, which
  // is why a real glass lozenge smears a line rather than blowing it up.
  vec2 c = uBeads[0].xy / uRes;
  vec2 luv = uShape == 1
    ? vec2(uv.x, c.y + (uv.y - c.y) / uZoom)
    : c + (uv - c) / uZoom;
  luv -= N.xy * uRefract * h * (R / uRes.y) * 2.0;
  // Per-sample scatter jitter, on its own fine-grained noise. Reusing the coarse
  // surface noise here smears the plate in big wobbles instead of scattering it.
  luv += vec2(vnoise(lp * 90.0) - 0.5, vnoise(lp * 90.0 + 53.1) - 0.5)
       * uGrain * 0.014 * t;

  // The frost half. Magnifying stretches the plate, so drop the LOD to keep the rim as sharp as
  // the optics allow. A cylindrical lens only stretches one axis, so it earns
  // half the compensation a spherical one does.
  float zoomComp = log2(max(uZoom, 1.0)) * (uShape == 1 ? 0.5 : 1.0);
  float lod = clamp(uFrost * t * uMaxLod - zoomComp, 0.0, uMaxLod);
  float sp  = uChroma * lod * 0.35;

  vec3 col;
  col.r = textureLod(uTex, luv, clamp(lod - sp, 0.0, uMaxLod)).r;
  col.g = textureLod(uTex, luv, lod).g;
  col.b = textureLod(uTex, luv, clamp(lod + sp, 0.0, uMaxLod)).b;

  // Turbid medium. Three things happen over path length, and all three matter:
  // multiple scattering washes saturation out, Beer-Lambert absorption weighted
  // to the blue end warms what still gets through, and the light that scattered
  // back out adds a cool white veil. Blur alone leaves it looking like plastic.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum), t * uMilk * 0.45);
  col *= exp(-vec3(0.06, 0.11, 0.19) * uMilk * t * 2.2);

  // Energy conserving, and this part matters: scattering does not pile light on
  // top of the transmitted image, it takes its place. The deeper the path, the
  // more of what you see is medium and the less is plate. Adding the veil
  // instead of mixing it clips straight to white over any light-toned plate,
  // which wipes out the very detail the gradient is supposed to be dissolving.
  float scatter = uMilk * (1.0 - exp(-2.6 * t)) * 0.55;
  col = mix(col, vec3(0.88, 0.91, 0.97), scatter);

  // Caustic: the cap focuses light into a bright patch offset toward the source.
  // Deliberately faint. It peaks in the same place as the haze and the sheen, so
  // anything louder and the three of them stack into a blown-out white lobe.
  vec2 lightDir = normalize(vec2(-0.55, 0.62));
  float cd = length(lp + lightDir * 0.34);
  col += vec3(1.0, 0.97, 0.90) * smoothstep(0.30, 0.0, cd) * 0.06 * h;

  // Fresnel: at grazing angles the rim stops transmitting and starts mirroring.
  // Off the macro cap, so the etch does not chew the rim into noise.
  //
  // What it mirrors is a cheap two-tone environment, bright above and dark
  // below, plus a hot spot toward the light. Mixing toward flat grey instead
  // reads as a matte ball the moment the plate goes dark, because over black
  // there is nothing behind the glass to refract and the rim is the only thing
  // left carrying the material. A little of the surround is folded back in so
  // the rim still picks up a bright plate.
  vec3 L = normalize(vec3(-0.55, 0.62, 0.62));
  vec3 Rv = reflect(vec3(0.0, 0.0, -1.0), Nb);
  float envY = Rv.y * 0.5 + 0.5;
  vec3 env = mix(vec3(0.05, 0.06, 0.08), vec3(0.82, 0.88, 1.0), pow(envY, 1.5));
  env += vec3(1.0) * pow(max(dot(Rv, L), 0.0), 6.0) * 0.45;
  env = mix(env, bg, 0.25);

  float fres = pow(1.0 - Nb.z, 3.0);
  col = mix(col, env, fres * 0.7);

  // Tight glint off the macro cap, broad sheen off the rough one. Splitting the
  // two is what separates "etched glass" from "salt and pepper".
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  col += uSpec * pow(max(dot(Nb, H), 0.0), 120.0) * 0.55;
  col += uSpec * pow(max(dot(N,  H), 0.0),  10.0) * 0.09;

  // meniscus: the thin dark contact ring every real droplet has
  col *= 1.0 - smoothstep(2.5, 0.0, abs(d + 1.6)) * 0.16;

  fragColor = vec4(mix(outCol, col, inside), 1.0);
}`;

// ---------------------------------------------------------------------------
// gl helpers
// ---------------------------------------------------------------------------

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader alloc failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) {
  const prog = gl.createProgram();
  if (!prog) throw new Error("program alloc failed");
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link failed: ${log}`);
  }
  return prog;
}

type Bead = { x: number; y: number; r: number; born: number };

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

export default function FrostLens({
  src,
  variant = "full",
  controls = true,
}: FrostLensProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [invert, setInvert] = useState(false);
  const [shape, setShape] = useState<"droplet" | "pill">("droplet");
  const [failed, setFailed] = useState(false);
  const [readout, setReadout] = useState("lod 0.0");

  // Live mirrors, so the render loop reads current values without the gl setup
  // effect tearing down and rebuilding the pyramid every time a slider moves.
  // Synced in an effect rather than during render: writing a ref mid-render is
  // a tear waiting to happen under concurrent rendering.
  const paramsRef = useRef(params);
  const invertRef = useRef(invert);
  const shapeRef = useRef(shape);

  useEffect(() => {
    paramsRef.current = params;
    invertRef.current = invert;
    shapeRef.current = shape;
  }, [params, invert, shape]);

  const showPanel = controls && variant === "full";

  const set = useCallback(<K extends keyof Params>(key: K, value: Params[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    const frameEl = frameRef.current;
    const canvasEl = canvasRef.current;
    if (!frameEl || !canvasEl) return;
    // rebind as non-null consts, otherwise the narrowing is lost inside the
    // render closures below and every gl call reads as possibly-null
    const frame = frameEl;
    const canvas = canvasEl;

    // Deferred, so a capability bail-out does not fire setState synchronously
    // inside the effect and cascade a second render during mount.
    const reportFailure = () => queueMicrotask(() => setFailed(true));

    const ctx = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
    });
    if (!ctx) {
      reportFailure();
      return;
    }
    const gl = ctx;

    let disposed = false;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let mainProg: WebGLProgram | null = null;
    let downProg: WebGLProgram | null = null;
    let tex: WebGLTexture | null = null;
    let fbo: WebGLFramebuffer | null = null;
    let levels = 1;
    let raf = 0;

    try {
      mainProg = link(gl, VERT, MAIN_FRAG);
      downProg = link(gl, VERT, DOWN_FRAG);
    } catch (err) {
      console.error("[FrostLens]", err);
      reportFailure();
      return;
    }

    const vao = gl.createVertexArray();
    fbo = gl.createFramebuffer();

    const uni = (prog: WebGLProgram, name: string) =>
      gl.getUniformLocation(prog, name);

    const U = {
      tex: uni(mainProg, "uTex"),
      res: uni(mainProg, "uRes"),
      maxLod: uni(mainProg, "uMaxLod"),
      beads: uni(mainProg, "uBeads"),
      count: uni(mainProg, "uCount"),
      frost: uni(mainProg, "uFrost"),
      chroma: uni(mainProg, "uChroma"),
      grain: uni(mainProg, "uGrain"),
      refract: uni(mainProg, "uRefract"),
      zoom: uni(mainProg, "uZoom"),
      milk: uni(mainProg, "uMilk"),
      spec: uni(mainProg, "uSpec"),
      curve: uni(mainProg, "uCurve"),
      invert: uni(mainProg, "uInvert"),
      shape: uni(mainProg, "uShape"),
      pillLen: uni(mainProg, "uPillLen"),
    };
    const DU = {
      src: uni(downProg, "uSrc"),
      texel: uni(downProg, "uTexel"),
    };

    // the plate is drawn once per resize into a 2d canvas, then uploaded
    const plate = document.createElement("canvas");
    const plateCtx = plate.getContext("2d");

    let image: HTMLImageElement | null = null;
    let width = 1;
    let height = 1;

    /* Build the whole pyramid: level 0 is the plate, every level after is a
       tent-filtered halving of the one below. Base/max level are pinned during
       the build so we never sample the level we are drawing into. */
    function buildPyramid() {
      if (!plateCtx || !mainProg || !downProg) return;

      plate.width = width;
      plate.height = height;
      drawSpecimen(
        plateCtx,
        width,
        height,
        image,
        variant === "playground" ? "playground" : "apple",
        Math.min(window.devicePixelRatio || 1, 2)
      );

      if (tex) gl.deleteTexture(tex);
      levels = Math.min(
        MAX_LEVELS,
        Math.max(1, Math.floor(Math.log2(Math.max(width, height))) + 1)
      );

      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        plate
      );
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      gl.useProgram(downProg);
      gl.uniform1i(DU.src, 0);
      gl.bindVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

      for (let i = 1; i < levels; i += 1) {
        const sw = Math.max(1, width >> (i - 1));
        const sh = Math.max(1, height >> (i - 1));
        const dw = Math.max(1, width >> i);
        const dh = Math.max(1, height >> i);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, i - 1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, i - 1);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          tex,
          i
        );
        gl.viewport(0, 0, dw, dh);
        gl.uniform2f(DU.texel, 1 / sw, 1 / sh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR
      );
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(frame.clientWidth * dpr));
      const h = Math.max(1, Math.round(frame.clientHeight * dpr));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      buildPyramid();
    }

    // --- pointer state -------------------------------------------------------

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
    let px = 0.5;
    let py = 0.45; // normalised pointer target
    let cx = 0.5;
    let cy = 0.45; // smoothed droplet centre
    let vx = 0;
    let vy = 0;
    let engaged = false;
    const trail: Bead[] = [];
    let lastDrop = 0;

    function onPointer(ev: PointerEvent) {
      const rect = frame.getBoundingClientRect();
      px = (ev.clientX - rect.left) / rect.width;
      py = (ev.clientY - rect.top) / rect.height;
      engaged = true;
    }
    function onLeave() {
      engaged = false;
    }

    frame.addEventListener("pointermove", onPointer);
    frame.addEventListener("pointerdown", onPointer);
    frame.addEventListener("pointerleave", onLeave);

    const ro = new ResizeObserver(() => resize());
    ro.observe(frame);
    resize();

    // --- loop ---------------------------------------------------------------

    const beadData = new Float32Array(MAX_BEADS * 4);
    const start = performance.now();
    let lastReadout = 0;

    function frameLoop(now: number) {
      if (disposed || !mainProg || !tex) return;
      raf = requestAnimationFrame(frameLoop);

      const p = paramsRef.current;
      const time = (now - start) / 1000;

      // idle drift, so the instrument is alive before anyone touches it
      if (!engaged && !reduced) {
        px = 0.5 + Math.cos(time * 0.31) * 0.26;
        py = 0.46 + Math.sin(time * 0.44) * 0.2;
      }

      const ease = reduced ? 1 : 0.16;
      const nx = cx + (px - cx) * ease;
      const ny = cy + (py - cy) * ease;
      vx = nx - cx;
      vy = ny - cy;
      cx = nx;
      cy = ny;

      const isPill = shapeRef.current === "pill";
      const scale = dpr();
      // the pill reads as UI chrome rather than liquid, so it sits shallower
      const R = (isPill ? p.radius * 0.46 : p.radius) * scale;
      const pillLen = R * 2.4; // half-spine, so the capsule runs about 3.4:1
      const gx = cx * width;
      const gy = height - cy * height; // gl origin is bottom-left
      const speed = Math.hypot(vx * width, vy * height);

      // lay a bead down every so often while moving, so the scan leaves a track
      if (!isPill && speed > 1.5 && now - lastDrop > 90 && !reduced) {
        trail.push({ x: gx, y: gy, r: R * (0.16 + Math.random() * 0.12), born: now });
        lastDrop = now;
      }
      while (trail.length && now - trail[0].born > 1500) trail.shift();

      // bead 0 is the head. Bead 1 is a tail lobe pulled backwards along the
      // velocity, which the smooth min turns into a teardrop for free.
      beadData.fill(0);
      beadData[0] = gx;
      beadData[1] = gy;
      beadData[2] = R;

      // kept short and small: overshoot here and the tail stops reading as a
      // stretch and starts reading as a second droplet stuck to the first.
      // A pill skips it entirely: the capsule SDF is the whole silhouette, and
      // chrome that stretches and sheds beads would read as liquid, not glass.
      const stretch = isPill ? 0 : Math.min(speed * 0.55, R * 0.7);
      const dirLen = Math.hypot(vx * width, vy * height) || 1;
      beadData[4] = gx - (vx * width / dirLen) * stretch;
      beadData[5] = gy + (vy * height / dirLen) * stretch;
      beadData[6] = isPill ? 0 : R * (0.48 - Math.min(speed / 300, 0.18));

      let count = isPill ? 1 : 2;
      const maxTrail = isPill ? 0 : Math.min(trail.length, MAX_BEADS - 2);
      for (let i = trail.length - maxTrail; i < trail.length; i += 1) {
        const b = trail[i];
        const age = (now - b.born) / 1500;
        const o = count * 4;
        beadData[o] = b.x;
        beadData[o + 1] = b.y;
        beadData[o + 2] = b.r * (1 - age) * (1 - age);
        count += 1;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(mainProg);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);

      gl.uniform1i(U.tex, 0);
      gl.uniform2f(U.res, width, height);
      gl.uniform1f(U.maxLod, levels - 1);
      gl.uniform4fv(U.beads, beadData);
      gl.uniform1i(U.count, count);
      gl.uniform1f(U.frost, p.frost);
      gl.uniform1f(U.chroma, p.chroma);
      gl.uniform1f(U.grain, p.grain);
      gl.uniform1f(U.refract, p.refract);
      gl.uniform1f(U.zoom, p.zoom);
      gl.uniform1f(U.milk, p.milk);
      gl.uniform1f(U.spec, p.spec);
      gl.uniform1f(U.curve, p.curve);
      gl.uniform1f(U.invert, invertRef.current ? 1 : 0);
      gl.uniform1i(U.shape, isPill ? 1 : 0);
      gl.uniform1f(U.pillLen, pillLen);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (now - lastReadout > 180) {
        lastReadout = now;
        const peak = Math.max(
          0,
          p.frost * (levels - 1) - Math.log2(Math.max(p.zoom, 1))
        );
        setReadout(`peak lod ${peak.toFixed(1)} / ${levels - 1}`);
      }
    }

    if (src) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (disposed) return;
        image = img;
        buildPyramid();
      };
      // Warn, never error: a missing photo is a recoverable condition with a
      // working fallback, and console.error trips the Next dev overlay, which
      // blanks the whole page over an asset the component does not require.
      img.onerror = () => {
        console.warn(`[FrostLens] could not load "${src}", showing the procedural plate instead`);
      };
      img.src = src;
    }

    raf = requestAnimationFrame(frameLoop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      frame.removeEventListener("pointermove", onPointer);
      frame.removeEventListener("pointerdown", onPointer);
      frame.removeEventListener("pointerleave", onLeave);
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      if (vao) gl.deleteVertexArray(vao);
      if (mainProg) gl.deleteProgram(mainProg);
      if (downProg) gl.deleteProgram(downProg);
    };
  }, [src, variant]);

  const sliders: Array<[keyof Params, string, number, number, number]> = [
    ["frost", "scatter", 0, 1, 0.01],
    ["curve", "depth curve", 0.4, 3, 0.05],
    ["zoom", "magnification", 1, 3, 0.01],
    ["milk", "turbidity", 0, 1.4, 0.01],
    ["chroma", "wavelength split", 0, 1.5, 0.01],
    ["grain", "etch grain", 0, 1, 0.01],
    ["refract", "meniscus bend", 0, 3, 0.01],
    ["spec", "sheen", 0, 2, 0.01],
    ["radius", "droplet radius", 40, 200, 1],
  ];

  if (variant === "playground") {
    // fill for the slider track, since a range input cannot show "filled to the
    // thumb" without being told where the thumb is
    const track = (value: number, min: number, max: number) => {
      const pct = ((value - min) / (max - min)) * 100;
      return {
        background: `linear-gradient(90deg, #C97836 0%, #C97836 ${pct}%, rgba(255,255,255,0.14) ${pct}%, rgba(255,255,255,0.14) 100%)`,
      };
    };

    const control = (
      key: keyof Params,
      label: string,
      min: number,
      max: number,
      step: number
    ) => (
      <label className={styles.pgCtl} key={key}>
        <span className={styles.pgCtlHead}>
          {label}
          <b className={styles.pgVal}>
            {params[key].toFixed(step < 1 ? 2 : 0)}
          </b>
        </span>
        <input
          className={styles.pgSlider}
          style={track(params[key], min, max)}
          type="range"
          min={min}
          max={max}
          step={step}
          value={params[key]}
          onChange={(e) => set(key, Number(e.target.value))}
        />
      </label>
    );

    return (
      <div className={styles.pg} ref={frameRef}>
        <canvas className={styles.pgCanvas} ref={canvasRef} />

        {failed ? (
          <p className={styles.pgFallback}>
            This one needs WebGL2. It&apos;s a per-pixel variable blur driven by
            a mip pyramid, so there isn&apos;t a CSS fallback that keeps the
            point.
          </p>
        ) : (
          <>
            <nav className={styles.pgNav}>
              <span className={styles.pgBrand}>
                @jaz/<b>frost-lens</b>
              </span>
              <span className={styles.pgLinks}>
                <a className={styles.pgLink} data-on="true" href="/experiments/frost-lens">
                  Playground
                </a>
                <a className={styles.pgLink} href="/sandbox">
                  Experiments
                </a>
              </span>
              <span className={styles.pgNavRight}>
                <a className={styles.pgGhost} href="/sandbox">
                  All experiments
                </a>
              </span>
            </nav>

            <section className={`${styles.pgPanel} ${styles.pgLeft}`}>
              <header className={styles.pgPanelHead}>
                <i className={styles.pgDot} style={{ background: "#FF5F57" }} />
                <i className={styles.pgDot} style={{ background: "#FEBC2E" }} />
                <i className={styles.pgDot} style={{ background: "#28C840" }} />
                <h2 className={styles.pgPanelTitle}>Lens</h2>
              </header>
              <div className={styles.pgBody}>
                <p className={styles.pgGroup}>Lens</p>
                {control("radius", "Radius", 40, 200, 1)}
                {control("zoom", "Magnification", 1, 3, 0.01)}
                <p className={styles.pgGroup}>Shape</p>
                <div className={styles.pgRow}>
                  <button
                    type="button"
                    className={styles.pgChip}
                    data-on={shape === "droplet"}
                    onClick={() => setShape("droplet")}
                  >
                    Droplet
                  </button>
                  <button
                    type="button"
                    className={styles.pgChip}
                    data-on={shape === "pill"}
                    onClick={() => setShape("pill")}
                  >
                    Pill
                  </button>
                </div>
              </div>
            </section>

            <section className={`${styles.pgPanel} ${styles.pgRight}`}>
              <header className={styles.pgPanelHead}>
                <i className={styles.pgDot} style={{ background: "#FF5F57" }} />
                <i className={styles.pgDot} style={{ background: "#FEBC2E" }} />
                <i className={styles.pgDot} style={{ background: "#28C840" }} />
                <h2 className={styles.pgPanelTitle}>Settings</h2>
              </header>
              <div className={styles.pgBody}>
                <p className={styles.pgGroup}>Scatter</p>
                {control("frost", "Amount", 0, 1, 0.01)}
                {control("curve", "Depth curve", 0.4, 3, 0.05)}
                {control("milk", "Turbidity", 0, 1.4, 0.01)}

                <p className={styles.pgGroup}>Edge</p>
                {control("refract", "Meniscus bend", 0, 3, 0.01)}
                {control("chroma", "Wavelength split", 0, 1.5, 0.01)}

                <p className={styles.pgGroup}>Sheen</p>
                {control("grain", "Etch grain", 0, 1, 0.01)}
                {control("spec", "Specular", 0, 2, 0.01)}

                <div className={styles.pgRow}>
                  <button
                    type="button"
                    className={styles.pgChip}
                    data-on={invert}
                    onClick={() => setInvert((v) => !v)}
                  >
                    Invert
                  </button>
                  <button
                    type="button"
                    className={styles.pgChip}
                    onClick={() => setParams(DEFAULTS)}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </section>

            <p className={styles.pgVersion}>v0.1.0 &middot; WebGL2</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.wrap} ${variant === "embed" ? styles.embed : ""}`}>
      <div className={styles.frame} ref={frameRef}>
        <canvas className={styles.canvas} ref={canvasRef} />
        {failed ? (
          <p className={styles.fallback}>
            This one needs WebGL2. It&apos;s a per-pixel variable blur driven by a
            mip pyramid, so there isn&apos;t a CSS fallback that keeps the point.
          </p>
        ) : (
          <>
            <p className={styles.plateLabel} data-onphoto={!!src}>
              {src ? "rough transmission / photographic plate" : "rough transmission / specimen plate"}
            </p>
            <p className={styles.readout} data-onphoto={!!src}>
              {readout}
            </p>
          </>
        )}
      </div>

      {showPanel && !failed && (
        <div className={styles.panel}>
          {sliders.map(([key, label, min, max, step]) => (
            <label className={styles.control} key={key}>
              <span className={styles.controlHead}>
                {label}
                <b>{params[key].toFixed(step < 1 ? 2 : 0)}</b>
              </span>
              <input
                className={styles.slider}
                type="range"
                min={min}
                max={max}
                step={step}
                value={params[key]}
                onChange={(e) => set(key, Number(e.target.value))}
              />
            </label>
          ))}
          <div className={styles.row}>
            <button
              type="button"
              className={styles.chip}
              data-on={shape === "droplet"}
              onClick={() => setShape("droplet")}
            >
              droplet
            </button>
            <button
              type="button"
              className={styles.chip}
              data-on={shape === "pill"}
              onClick={() => setShape("pill")}
            >
              pill
            </button>
            <button
              type="button"
              className={styles.chip}
              data-on={invert}
              onClick={() => setInvert((v) => !v)}
            >
              invert
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => setParams(DEFAULTS)}
            >
              reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
