"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./Sandbox.module.css";
import { EXPERIMENTS, type ExperimentEntry } from "./experiments";
import { Nav, Footer } from "./Chrome";

/**
 * Sandbox index. Every experiment route is embedded live in an iframe sized to
 * a real desktop viewport and CSS-scaled into its card, so what you see is the
 * component at its intended width rather than a squeezed one. Pointer events
 * map correctly through the transform, so hovering a plate is enough to start
 * interacting with it.
 *
 * The card is the gallop plate's chrome: white paper, hairline border, the
 * stage inset with a soft rounded corner, caption underneath. One column,
 * read like a feed.
 *
 * WHAT KEEPS IT FAST
 *
 * The page is a budget, not a preload. Every plate mounted at once meant 24
 * animation loops and ten live WebGL contexts running forever, all of them
 * competing for the same GPU while you looked at one. Browsers also cap WebGL
 * contexts near sixteen and silently kill the oldest past that, so the plates
 * you scrolled by first went blank.
 *
 * So:
 *   1. only the [LIVE_BUDGET] plates nearest the viewport are mounted. The rest
 *      are torn down, which stops their loops dead and frees their context;
 *   2. a handful further out are warmed -- the route is fetched so it is
 *      compiled and in the HTTP cache, but nothing renders yet;
 *   3. a plate you scroll back to remounts from cache, so it is a repaint
 *      rather than a cold boot;
 *   4. the frame only fades in on load, so nothing pops in half-painted.
 */

// the viewport each experiment is rendered at inside its iframe. 1280x800 is
// 16:10, the same plate proportion the gallop card uses.
const FRAME_W = 1280;
const FRAME_H = 800;

/** how many plates may be rendering at once. Four covers the one you are
 *  reading plus its neighbours in both directions, which is every plate you
 *  can actually see mid-scroll. */
const LIVE_BUDGET = 4;

/** how many more get their route fetched, ahead of the scroll, without
 *  rendering. Cheap: one HTML response each, no GPU. */
const WARM_AHEAD = 4;

/** how long the scroll must rest before the budget is recomputed. Debounced,
 *  not throttled: during a fling you are not reading anything, and booting
 *  every plate you fly past is exactly the churn this budget exists to stop. */
const SETTLE_MS = 120;

type CardProps = {
  entry: ExperimentEntry;
  live: boolean;
  isLive: boolean;
  onEnter: () => void;
  onLeave: () => void;
  register: (slug: string, node: HTMLElement | null) => void;
};

function ExperimentCard({
  entry,
  live,
  isLive,
  onEnter,
  onLeave,
  register,
}: CardProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.7);
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // keep the scale locked to the card width
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const ro = new ResizeObserver(([box]) => {
      const width = box.contentRect.width;
      if (width > 0) setScale(width / FRAME_W);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // the parent ranks cards by distance from the viewport, so it needs the node
  useEffect(() => {
    register(entry.slug, stageRef.current);
    return () => register(entry.slug, null);
  }, [entry.slug, register]);

  // a plate that has been evicted must show its skeleton again when it returns
  useEffect(() => {
    if (!live) setReady(false);
  }, [live]);

  const reload = () => {
    setReady(false);
    setReloadKey((k) => k + 1);
  };

  return (
    <article
      className={styles.card}
      data-live={isLive}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        ref={stageRef}
        className={styles.stage}
        style={{ height: FRAME_H * scale }}
      >
        {ready ? null : <p className={styles.skeleton}>{entry.title}</p>}

        {live ? (
          <iframe
            key={reloadKey}
            className={styles.frame}
            src={`/experiments/${entry.slug}`}
            title={entry.title}
            width={FRAME_W}
            height={FRAME_H}
            data-ready={ready}
            onLoad={() => setReady(true)}
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              pointerEvents: isLive ? "auto" : "none",
            }}
          />
        ) : null}
      </div>

      <div className={styles.caption}>
        <span className={styles.cardTitle}>{entry.title}</span>
        <span className={styles.slug}>{entry.slug}</span>
      </div>

      <div className={styles.subcaption}>
        <span className={styles.hint}>{entry.interactions.join(" / ")}</span>
        <span className={styles.links}>
          <a
            className={styles.link}
            href={`/experiments/${entry.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            open
          </a>
          <button type="button" className={styles.link} onClick={reload}>
            reload
          </button>
        </span>
      </div>
    </article>
  );
}

export default function Sandbox() {
  const [liveSlug, setLiveSlug] = useState<string | null>(null);
  const clearLive = useCallback(() => setLiveSlug(null), []);

  // the plates allowed to render right now, nearest the viewport first
  const [budget, setBudget] = useState<string[]>(() =>
    EXPERIMENTS.slice(0, LIVE_BUDGET).map((e) => e.slug),
  );
  const budgetSet = useMemo(() => new Set(budget), [budget]);

  const nodes = useRef(new Map<string, HTMLElement>());
  const warmed = useRef(new Set<string>());

  const register = useCallback((slug: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(slug, node);
    else nodes.current.delete(slug);
  }, []);

  // Rank every card by how far its middle is from the middle of the screen,
  // render the nearest few and fetch the next few. One pass of reads, throttled
  // so a fast scroll does not thrash: eviction does not need to be frame-exact.
  useEffect(() => {
    let timer = 0;

    const rank = () => {
      const middle = window.innerHeight / 2;
      const ordered = [...nodes.current.entries()]
        .map(([slug, node]) => {
          const box = node.getBoundingClientRect();
          return { slug, gap: Math.abs(box.top + box.height / 2 - middle) };
        })
        .sort((a, b) => a.gap - b.gap);

      const next = ordered.slice(0, LIVE_BUDGET).map((e) => e.slug);
      setBudget((prev) =>
        prev.length === next.length && prev.every((s, i) => s === next[i])
          ? prev
          : next,
      );

      // warm what is coming, one request each, never twice
      for (const { slug } of ordered.slice(
        LIVE_BUDGET,
        LIVE_BUDGET + WARM_AHEAD,
      )) {
        if (warmed.current.has(slug)) continue;
        warmed.current.add(slug);
        fetch(`/experiments/${slug}`).catch(() => {
          // a cold route that refuses to warm is not worth failing the page over
        });
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(rank, SETTLE_MS);
    };

    rank();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <div className="rv">
      <Nav />
      <main className={styles.page}>
      <div className="wrap">
        <div className={styles.head}>
          <div>
            <div className="label">Sandbox</div>
            <h1 className={styles.title}>Things I made to see if they<br />could be made.</h1>
            <p className={styles.lede}>Every plate is live. Hover one to hand it your pointer.</p>
          </div>
        </div>
      </div>

      <div className={styles.feed}>
        {EXPERIMENTS.map((entry: ExperimentEntry) => (
          <ExperimentCard
            key={entry.slug}
            entry={entry}
            live={budgetSet.has(entry.slug)}
            isLive={liveSlug === entry.slug}
            onEnter={() => setLiveSlug(entry.slug)}
            onLeave={clearLive}
            register={register}
          />
        ))}
      </div>
      </main>
      <Footer />
    </div>
  );
}
