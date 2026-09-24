"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./ButterSideUp.module.css";
import { createImpastoLayer } from "./impasto";
import type { ImpastoLayer } from "./impasto";
import { layStroke, loadKnife, strokeLoad } from "./knife";
import type { Knife } from "./knife";
import { paintLoaf, PIGMENTS } from "./loaf";

/**
 * BUTTER SIDE UP
 * --------------
 * A slice of bread and a butter knife, and nothing else to do.
 *
 * The whole plate is one material question: why does butter look like butter?
 * Not the colour. A flat yellow shape reads as paper. It is that butter is
 * THICK and slightly translucent, so a spread carries ridges that catch the
 * window on one side and shadow on the other, the furrows between them go
 * dull, and the thin places at the edge of a smear glow because light gets
 * through them.
 *
 * So nothing here is shaded by hand. Three flat canvases hold the facts, the
 * bread, the butter and a greyscale height field, and one fragment shader
 * rakes a soft light across the height field and lets the relief fall out of
 * the gradient. See impasto.ts.
 *
 * WHY IT IS SEPARATE LAYERS
 *
 * Bread, butter, height, then the knife itself on top. Keeping the butter on
 * its own transparent sheet is what makes the blade reversible: scraping is a
 * destination-out pass and the bread underneath is uncovered rather than
 * repainted, because it was never touched.
 *
 * WHY IT FEELS LIKE A KNIFE AND NOT A BRUSH
 *
 * See knife.ts. It is an edge held square to the travel, cut into strips that
 * each carry their own charge, and it RUNS OUT. Lifting and pressing again
 * reloads. That last rule is what stops the bread turning into a flat yellow
 * rectangle, because it makes every smear have a beginning and an end.
 *
 * The slice arrives bare. Every mark on it is one you made.
  */

type ButterSideUpProps = {
  variant?: "full" | "embed";
  className?: string;
};

/** blade length as a fraction of plate height */
const BLADE = 0.17;
/** how far a loaded blade drags before it is dry, in blade lengths */
const RANGE = 3.4;
/** relief strength handed to the shader */
const RELIEF = 4.6;

type Pointer = { x: number; y: number; down: boolean; seen: boolean };

export default function ButterSideUp({
  variant = "full",
  className,
}: ButterSideUpProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const groundRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const heightRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const overRef = useRef<HTMLCanvasElement | null>(null);

  const pigmentRef = useRef(0);
  const scrapeRef = useRef(false);
  const clearRef = useRef(false);

  const [lit, setLit] = useState(false);
  const [pigment, setPigment] = useState(0);
  const [scrape, setScrape] = useState(false);

  useEffect(() => {
    pigmentRef.current = pigment;
  }, [pigment]);
  useEffect(() => {
    scrapeRef.current = scrape;
  }, [scrape]);

  const fresh = useCallback(() => {
    clearRef.current = true;
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const groundCv = groundRef.current;
    const paintCv = paintRef.current;
    const heightCv = heightRef.current;
    const gl = glRef.current;
    const over = overRef.current;
    if (!stage || !groundCv || !paintCv || !heightCv || !gl || !over) return;

    const gctx = groundCv.getContext("2d", { alpha: false });
    const pctx = paintCv.getContext("2d");
    const hctx = heightCv.getContext("2d", { alpha: false });
    const octx = over.getContext("2d");
    if (!gctx || !pctx || !hctx || !octx) return;

    let layer: ImpastoLayer | null = null;
    let dpr = 1;
    let w = 0;
    let h = 0;
    let raf = 0;
    let start = 0;
    let disposed = false;
    let painted = false;

    const ptr: Pointer = { x: 0, y: 0, down: false, seen: false };
    let lastX = 0;
    let lastY = 0;
    let knife: Knife = loadKnife(80, 260);
    /* the spine of the stroke in progress, redrawn whole every frame */
    let spine: number[] = [];
    /* how the sheets looked before this stroke started, so it can be redrawn */
    const snapPaint = document.createElement("canvas");
    const snapHeight = document.createElement("canvas");
    const snapPCtx = snapPaint.getContext("2d");
    const snapHCtx = snapHeight.getContext("2d", { alpha: false });

    const keep = () => {
      if (!snapPCtx || !snapHCtx) return;
      snapPCtx.setTransform(1, 0, 0, 1, 0, 0);
      snapHCtx.setTransform(1, 0, 0, 1, 0, 0);
      snapPCtx.clearRect(0, 0, snapPaint.width, snapPaint.height);
      snapPCtx.drawImage(paintCv, 0, 0);
      snapHCtx.drawImage(heightCv, 0, 0);
    };

    const rewind = () => {
      if (!snapPCtx || !snapHCtx) return;
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      hctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, paintCv.width, paintCv.height);
      pctx.drawImage(snapPaint, 0, 0);
      hctx.drawImage(snapHeight, 0, 0);
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** the height sheet is black where there is no paint at all */
    const wipe = () => {
      hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hctx.fillStyle = "#000";
      hctx.fillRect(0, 0, w, h);
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pctx.clearRect(0, 0, w, h);
    };

    /**
     * A few marks laid before anyone arrives. Scripted rather than random, so
     * the plate always opens on the same worked surface, and aimed at the
     * bone slab and the right hand figure the way a painter would build them.
     */
    const layout = () => {
      const cw = stage.clientWidth;
      const ch = stage.clientHeight;
      if (cw === 0 || ch === 0) return;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const pw = Math.round(cw * dpr);
      const ph = Math.round(ch * dpr);
      w = cw;
      h = ch;
      for (const cv of [groundCv, paintCv, heightCv, over, snapPaint, snapHeight]) {
        cv.width = pw;
        cv.height = ph;
      }
      if (layer) layer.resize(pw, ph);
      else {
        gl.width = pw;
        gl.height = ph;
      }

      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintLoaf(gctx, w, h);
      wipe();
      layer?.touchGround();
      layer?.touchPaint();
    };

    layout();
    layer = createImpastoLayer(gl, groundCv, paintCv, heightCv);
    setLit(layer !== null);
    layer?.touchGround();
    layer?.touchPaint();

    const drawOverlay = () => {
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, w, h);
      if (!ptr.seen) return;
      // the blade, held square to the last direction of travel
      const dx = ptr.x - lastX;
      const dy = ptr.y - lastY;
      const len = Math.hypot(dx, dy);
      const ux = len > 1 ? dx / len : 1;
      const uy = len > 1 ? dy / len : 0;
      const half = (h * BLADE) / 2;
      octx.save();
      octx.strokeStyle = scrapeRef.current ? "#9c3a22" : "#16140f";
      const left = ptr.down ? strokeLoad(knife, spine) : 1;
      octx.globalAlpha = 0.55 + left * 0.35;
      octx.lineWidth = 2;
      octx.lineCap = "round";
      octx.beginPath();
      octx.moveTo(ptr.x + uy * half, ptr.y - ux * half);
      octx.lineTo(ptr.x - uy * half, ptr.y + ux * half);
      octx.stroke();
      // how much paint is left on it
      octx.globalAlpha = 0.9;
      octx.lineWidth = 4;
      octx.beginPath();
      octx.moveTo(ptr.x + uy * half, ptr.y - ux * half);
      octx.lineTo(
        ptr.x + uy * half - uy * half * 2 * left,
        ptr.y - ux * half + ux * half * 2 * left,
      );
      octx.stroke();
      octx.restore();
    };

    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (start === 0) start = now;
      const t = (now - start) / 1000;

      if (clearRef.current) {
        clearRef.current = false;
        wipe();
        layer?.touchPaint();
      }

      if (painted) {
        painted = false;
        layer?.touchPaint();
      }

      layer?.render({ time: t, grain: 1, relief: RELIEF });
      drawOverlay();
    };

    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(() => {
      layout();
      layer?.touchGround();
      layer?.touchPaint();
    });
    ro.observe(stage);

    const at = (e: PointerEvent) => {
      const box = stage.getBoundingClientRect();
      ptr.x = e.clientX - box.left;
      ptr.y = e.clientY - box.top;
      ptr.seen = true;
    };

    const onDown = (e: PointerEvent) => {
      at(e);
      lastX = ptr.x;
      lastY = ptr.y;
      ptr.down = true;
      // lifting and pressing again is how you reload a knife
      knife = loadKnife(h * BLADE, h * BLADE * RANGE);
      spine = [ptr.x, ptr.y];
      keep();
      stage.setPointerCapture(e.pointerId);
      stage.focus({ preventScroll: true });
    };

    const onMove = (e: PointerEvent) => {
      const wasX = ptr.x;
      const wasY = ptr.y;
      at(e);
      lastX = wasX;
      lastY = wasY;
      if (!ptr.down) return;
      const n = spine.length;
      if (Math.hypot(ptr.x - spine[n - 2], ptr.y - spine[n - 1]) < 1.5) return;
      spine.push(ptr.x, ptr.y);
      // put the sheets back how they were and lay the whole stroke again.
      // depositing only the new segment would leave a seam at every join
      rewind();
      layStroke({
        paint: pctx,
        height: hctx,
        knife,
        pts: spine,
        pigment: PIGMENTS[pigmentRef.current].css,
        scrape: scrapeRef.current,
      });
      painted = true;
    };

    const onUp = (e: PointerEvent) => {
      if (!ptr.down) return;
      ptr.down = false;
      // the sheets already hold the finished stroke, so there is nothing to
      // commit. the next press snapshots them again
      spine = [];
      if (stage.hasPointerCapture(e.pointerId)) {
        stage.releasePointerCapture(e.pointerId);
      }
    };

    const onLeave = () => {
      ptr.seen = false;
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("pointerleave", onLeave);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", onLeave);
      layer?.dispose();
    };
  }, []);

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-variant={variant}
    >
      <div
        ref={stageRef}
        className={styles.stage}
        tabIndex={0}
        role="img"
        aria-label="A slice of bread you spread butter across with a knife. The butter is thick and catches a soft raking light."
      >
        <canvas ref={groundRef} className={styles.source} />
        <canvas
          ref={paintRef}
          className={styles.source}
          data-fallback={!lit}
        />
        <canvas ref={heightRef} className={styles.source} />
        <canvas ref={glRef} className={styles.gl} />
        <canvas ref={overRef} className={styles.over} />
      </div>

      <div className={styles.hud}>
        <div className={styles.pigments}>
          {PIGMENTS.map((p, i) => (
            <button
              key={p.key}
              type="button"
              className={styles.swatch}
              style={{ background: p.css }}
              data-on={i === pigment && !scrape}
              aria-label={p.key}
              title={p.key}
              onClick={() => {
                setPigment(i);
                setScrape(false);
              }}
            />
          ))}
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.btn}
            data-on={scrape}
            onClick={() => setScrape((v) => !v)}
          >
            scrape it off
          </button>
          <button type="button" className={styles.btn} onClick={fresh}>
            fresh slice
          </button>
        </div>
      </div>

      <div className={styles.caption}>
        <span className={styles.title}>Butter side up</span>
        <span className={styles.hint}>
          drag to spread, press again to load the knife
        </span>
      </div>
    </div>
  );
}
