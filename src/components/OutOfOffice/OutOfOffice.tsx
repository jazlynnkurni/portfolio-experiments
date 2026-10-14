"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./OutOfOffice.module.css";

/**
 * Out of Office. A footer for a social app about never being off work, with
 * the line of men walking through it.
 *
 * The walk itself is the walk lab engine, served as plain scripts from
 * public/walk: gait.js (joint curves from gait-lab data, the planted foot
 * held still in the world), figure.js and shade.js (the man as outlines in
 * each bone's frame, her traced shape in shade.json), lab.js (the canvas
 * chassis, mounted bare into the band here) and dream.js (the soft style:
 * bloom, echoes, the line, the three colourways). They are loaded in order
 * on mount and told where to live through a few window globals, the same
 * way footer.html in the lab does it.
 */

const SCRIPTS = ["gait.js", "figure.js", "shade.js", "lab.js", "dream.js"];
const COLOURWAYS = [1, 3, 4]; // riso red, nocturne, jade, by index in dream.js

type Palette = { name: string; paper: string; ink: string };
type WalkWindow = Window & {
  LAB_MOUNT?: string;
  DREAM_SET?: number[];
  DREAM_FIT?: number;
  DREAM_FLAT?: boolean;
  DREAM_HEIGHT?: number;
  LAB_GROUND?: number;
  LAB_DPR?: number;
  SHADE_URL?: string;
  dreamPick?: (i: number) => void;
  dreamPalettes?: Palette[];
  __oooBooted?: boolean;
};

function load(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(src));
    document.head.appendChild(s);
  });
}

export default function OutOfOffice() {
  const band = useRef<HTMLDivElement | null>(null);
  const [palettes, setPalettes] = useState<Palette[]>([]);
  const [current, setCurrent] = useState<number>(COLOURWAYS[0]);

  useEffect(() => {
    const w = window as WalkWindow;
    // dev strict mode runs effects twice; the engine must boot once
    if (w.__oooBooted) return;
    w.__oooBooted = true;
    w.LAB_MOUNT = "#ooo-band";
    w.DREAM_SET = COLOURWAYS;
    w.DREAM_FIT = 6;
    w.DREAM_FLAT = true;
    w.DREAM_HEIGHT = 0.5;
    w.LAB_GROUND = 0.8;
    w.LAB_DPR = 1;
    w.SHADE_URL = "/walk/shade.json";
    let cancelled = false;
    (async () => {
      for (const f of SCRIPTS) await load(`/walk/${f}`);
      if (cancelled) return;
      // the engine exposes its palettes once dream.js has run
      if (w.dreamPalettes) setPalettes(w.dreamPalettes);
      // the colourway it woke with, read back off the body
      const paper = document.body.style.getPropertyValue("--paper");
      const i = COLOURWAYS.find((k) => w.dreamPalettes?.[k]?.paper === paper);
      if (i != null) setCurrent(i);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = (i: number) => {
    (window as WalkWindow).dreamPick?.(i);
    setCurrent(i);
  };

  return (
    <footer className={styles.footer}>
      <div className={styles.band} id="ooo-band" ref={band} aria-hidden="true" />

      <div className={styles.cols}>
        <div className={styles.brand}>
          <div className={styles.mark}>Out of Office</div>
          <p>
            A social app for people who are never actually out of office. Keep in touch with
            everyone who&rsquo;s also still working.
          </p>
        </div>
        <div className={styles.col}>
          <h4>Product</h4>
          <a href="#">Feed</a>
          <a href="#">Jobs</a>
          <a href="#">Endorsements</a>
          <a href="#">Burnout tracker</a>
          <a href="#">Premium</a>
        </div>
        <div className={styles.col}>
          <h4>Company</h4>
          <a href="#">About</a>
          <a href="#">Careers, obviously</a>
          <a href="#">Press</a>
          <a href="#">Brand</a>
          <a href="#">Contact</a>
        </div>
        <div className={styles.col}>
          <h4>Resources</h4>
          <a href="#">Help centre</a>
          <a href="#">Community guidelines</a>
          <a href="#">Status: still working</a>
          <a href="#">Developers</a>
          <a href="#">Changelog</a>
        </div>
        <div className={styles.col}>
          <h4>Legal</h4>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Cookies</a>
          <a href="#">Accessibility</a>
          <a href="#">Do not sell my data</a>
        </div>
      </div>

      <div className={styles.bottom}>
        <div className={styles.legal}>
          <span>&copy; 2026 Out of Office, Inc.</span>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Sitemap</a>
        </div>
        <div className={styles.right}>
          <div className={styles.social} aria-label="Social">
            <a href="#" aria-label="X">
              <svg viewBox="0 0 24 24"><path d="M17.5 3h3l-7.1 8.1L21.7 21h-6.3l-4.9-6.4L4.8 21h-3l7.6-8.7L1.5 3H8l4.5 5.9L17.5 3zm-1.1 16.2h1.7L7 4.7H5.2l11.2 14.5z" /></svg>
            </a>
            <a href="#" aria-label="LinkedIn">
              <svg viewBox="0 0 24 24"><path d="M6.5 8.5H3V21h3.5V8.5zM4.8 3a2 2 0 100 4 2 2 0 000-4zM21 13.4c0-3.6-2-5.3-4.7-5.3-2 0-3 1.1-3.5 1.9V8.5H9.3V21h3.5v-6.6c0-1.7.6-2.9 2.2-2.9 1.5 0 2.2 1 2.2 2.9V21H21v-7.6z" /></svg>
            </a>
            <a href="#" aria-label="Instagram">
              <svg viewBox="0 0 24 24"><path d="M12 7.3a4.7 4.7 0 100 9.4 4.7 4.7 0 000-9.4zm0 7.7a3 3 0 110-6 3 3 0 010 6zm6-7.9a1.1 1.1 0 11-2.2 0 1.1 1.1 0 012.2 0zM12 3.7c2.7 0 3 0 4.1.1 2.7.1 4 1.4 4.1 4.1.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c-.1 2.7-1.4 4-4.1 4.1-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-2.7-.1-4-1.4-4.1-4.1C3.7 15 3.7 14.7 3.7 12s0-3 .1-4.1c.1-2.7 1.4-4 4.1-4.1 1.1-.1 1.4-.1 4.1-.1zM12 2C9.3 2 9 2 7.9 2.1 4.2 2.2 2.2 4.2 2.1 7.9 2 9 2 9.3 2 12s0 3 .1 4.1c.1 3.7 2.1 5.7 5.8 5.8 1.1.1 1.4.1 4.1.1s3 0 4.1-.1c3.7-.1 5.7-2.1 5.8-5.8.1-1.1.1-1.4.1-4.1s0-3-.1-4.1c-.1-3.7-2.1-5.7-5.8-5.8C15 2 14.7 2 12 2z" /></svg>
            </a>
            <a href="#" aria-label="TikTok">
              <svg viewBox="0 0 24 24"><path d="M16.6 5.8A4.3 4.3 0 0115.5 3h-3.1v12.4a2.6 2.6 0 11-1.8-2.5V9.7a5.7 5.7 0 104.9 5.7V9.3a7.3 7.3 0 004.3 1.4V7.6a4.3 4.3 0 01-3.2-1.8z" /></svg>
            </a>
            <a href="#" aria-label="YouTube">
              <svg viewBox="0 0 24 24"><path d="M23 7.2a2.9 2.9 0 00-2-2C19.2 4.7 12 4.7 12 4.7s-7.2 0-9 .5a2.9 2.9 0 00-2 2A30 30 0 00.5 12 30 30 0 001 16.8a2.9 2.9 0 002 2c1.8.5 9 .5 9 .5s7.2 0 9-.5a2.9 2.9 0 002-2 30 30 0 00.5-4.8 30 30 0 00-.5-4.8zM9.7 15.1V8.9l6 3.1-6 3.1z" /></svg>
            </a>
          </div>
          <div className={styles.dots} aria-label="Colourway">
            {palettes.length
              ? COLOURWAYS.map((i) => {
                  const p = palettes[i];
                  return (
                    <button
                      key={i}
                      type="button"
                      title={p.name}
                      aria-label={p.name}
                      aria-pressed={current === i}
                      onClick={() => pick(i)}
                    >
                      <s style={{ background: p.paper, outline: `1px solid ${p.ink}22`, outlineOffset: -1 }} />
                      <s style={{ background: p.ink }} />
                    </button>
                  );
                })
              : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
