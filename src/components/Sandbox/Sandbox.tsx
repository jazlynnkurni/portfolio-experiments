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
const LIVE_BUDGET = 8;

/** how many more get their route fetched, ahead of the scroll, without
 *  rendering. Cheap: one HTML response each, no GPU. */
const WARM_AHEAD = 12;

/** how long the scroll must rest before the budget is recomputed. Debounced,
 *  not throttled: during a fling you are not reading anything, and booting
 *  every plate you fly past is exactly the churn this budget exists to stop. */
const SETTLE_MS = 40;

type CardProps = {
  entry: ExperimentEntry;
  live: boolean;
  isLive: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
  register: (slug: string, node: HTMLElement | null) => void;
};

function ExperimentCard({
  entry,
  live,
  isLive,
  onEnter,
  onLeave,
  onOpen,
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
        data-plate=""
        className={styles.stage}
        style={{ height: FRAME_H * scale }}
      >
        {/* the still shows from the first frame; the live plate fades in over it once it has loaded */}
        <img className={styles.poster} src={`/sandbox-posters/${entry.slug}.jpg`} alt="" aria-hidden="true" decoding="async" fetchPriority="high"
             onError={(e) => { e.currentTarget.style.display = "none"; }} />
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
          <button type="button" className={styles.link} onClick={onOpen}>
            open
          </button>
          <button type="button" className={styles.link} onClick={reload}>
            reload
          </button>
        </span>
      </div>
    </article>
  );
}

/**
 * The sheet: an experiment held over the feed at its real size, the same card the
 * case studies open in on the main site. It floats inset with the feed blurred
 * behind it, grows to the window's edges on Expand and comes back on Collapse,
 * and closes on the cross, the backdrop, Escape, or the browser's own back, so
 * nobody has to leave the page to leave the piece. The URL carries ?p=slug
 * while it is open, so a sheet can be linked and reloaded.
 */
type SheetProps = {
  entry: ExperimentEntry | null;
  full: boolean;
  onFull: (on: boolean) => void;
  onClose: () => void;
};

function Sheet({ entry, full, onFull, onClose }: SheetProps) {
  // the last piece shown stays on the sheet while it fades out, so it never
  // blinks to blank on its way down (state derived from props, set in render)
  const [piece, setPiece] = useState<ExperimentEntry | null>(entry);
  if (entry && entry !== piece) setPiece(entry);
  const open = !!entry;

  // the page behind must not scroll while the sheet is up
  useEffect(() => {
    document.documentElement.classList.toggle("sheet-open", open);
    return () => document.documentElement.classList.remove("sheet-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open, onClose]);

  // the frame loads the moment a piece is asked for, and is let go a beat after
  // the sheet has left, so its loop stops too
  const [src, setSrc] = useState<string | null>(null);
  const want = entry ? `/experiments/${entry.slug}` : null;
  if (want && src !== want) setSrc(want);
  useEffect(() => {
    if (entry) return;
    const t = window.setTimeout(() => setSrc(null), 400);
    return () => window.clearTimeout(t);
  }, [entry]);

  return (
    <>
      <div
        className={styles.sheetBg}
        data-open={open}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={styles.sheet}
        data-open={open}
        data-full={full}
        role="dialog"
        aria-modal="true"
        aria-label={piece?.title ?? "Experiment"}
      >
        <div className={styles.sheetBar}>
          <span className={styles.sheetTitle}>{piece?.title}</span>
          <span className={styles.sheetAct}>
            {piece ? (
              <a
                href={`/experiments/${piece.slug}`}
                target="_blank"
                rel="noreferrer"
                title="Open in a new tab"
                aria-label="Open in a new tab"
              >
                <svg viewBox="0 0 16 16"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" /></svg>
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => onFull(!full)}
              title={full ? "Collapse" : "Expand"}
              aria-label={full ? "Collapse" : "Expand"}
              aria-pressed={full}
            >
              {full ? (
                <svg viewBox="0 0 16 16"><path d="M7 3v4H3M9 13V9h4M3 3l4 4M13 13 9 9" /></svg>
              ) : (
                <svg viewBox="0 0 16 16"><path d="M3 6.5V3h3.5M13 9.5V13H9.5M13 3 9 7M3 13l4-4M13 3H9.5M13 3v3.5M3 13h3.5M3 13V9.5" /></svg>
              )}
            </button>
            <button type="button" onClick={onClose} title="Close" aria-label="Close">
              <svg viewBox="0 0 16 16"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
            </button>
          </span>
        </div>
        {/* data-plate: the page's cursor bead steps aside once the pointer is in here */}
        <div className={styles.sheetStage} data-plate="">
          {src ? (
            <iframe className={styles.sheetFrame} src={src} title={piece?.title ?? "Experiment"} />
          ) : null}
        </div>
      </div>
    </>
  );
}

export default function Sandbox() {
  const [liveSlug, setLiveSlug] = useState<string | null>(null);
  const clearLive = useCallback(() => setLiveSlug(null), []);

  // the sheet, and the URL that mirrors it
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const openEntry = useMemo(
    () => EXPERIMENTS.find((e) => e.slug === openSlug) ?? null,
    [openSlug],
  );
  const openSheet = useCallback((slug: string) => {
    setOpenSlug(slug);
    setFull(false);
    history.pushState({ sheet: slug }, "", `?p=${slug}`);
  }, []);
  const closeSheet = useCallback(() => {
    setOpenSlug((cur) => {
      if (cur !== null) history.pushState({}, "", location.pathname);
      return null;
    });
    setFull(false);
  }, []);
  useEffect(() => {
    const sync = () => {
      const p = new URLSearchParams(location.search).get("p");
      setOpenSlug(p && EXPERIMENTS.some((e) => e.slug === p) ? p : null);
      setFull(false);
    };
    sync();
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);

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
            onOpen={() => openSheet(entry.slug)}
            register={register}
          />
        ))}
      </div>
      </main>
      <Footer />
      <Sheet entry={openEntry} full={full} onFull={setFull} onClose={closeSheet} />
    </div>
  );
}
