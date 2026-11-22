"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LayoutGroup, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { Brand, SkipLink, cx, linkClick, shared, type NavPanelProps } from "./shared";
import s from "./NavHide.module.css";

/**
 * 3 · Steps aside. A header that slides away while you read down the page and
 * comes back the moment you scroll up. The current page carries an orange
 * underline that slides between links. On phone the links drop to a second
 * row that scrolls sideways, so no page is ever hidden behind a menu.
 */
export default function NavHide({
  links,
  current,
  brand = "Brand",
  brandHref = "#",
  variant = "full",
  onNavigate,
  children,
}: NavPanelProps) {
  const id = useId();
  const mainId = `${id}-main`;
  const reduce = useReducedMotion();
  const mainRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);

  // hide on the way down, return on the way up; always shown near the top
  useEffect(() => {
    if (reduce) return;
    const el = variant === "embed" ? mainRef.current : null;
    const target: HTMLElement | Window = el ?? window;
    const read = () => (el ? el.scrollTop : window.scrollY);
    let last = read();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = read();
        if (y < 64) {
          setHidden(false);
          last = y;
          return;
        }
        const d = y - last;
        if (Math.abs(d) < 8) return;
        setHidden(d > 0);
        last = y;
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduce, variant]);

  // on phone, bring the current page into view in the sideways row
  useEffect(() => {
    const sc = scrollerRef.current;
    const a = sc?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!sc || !a || sc.scrollWidth <= sc.clientWidth) return;
    const left = a.offsetLeft - (sc.clientWidth - a.offsetWidth) / 2;
    sc.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
  }, [current, reduce]);

  const isHidden = hidden && !focusWithin && !reduce;

  return (
    <MotionConfig reducedMotion="user">
      <div className={cx(shared.rhythm, s.root, variant === "embed" && s.embed)}>
        <SkipLink target={mainId} />
        <header
          className={s.bar}
          data-hidden={isHidden}
          onFocus={() => setFocusWithin(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
          }}
        >
          <div className={s.inner}>
            <div className={s.brandRow}>
              <Brand label={brand} href={brandHref} current={current} onNavigate={onNavigate} />
            </div>
            <nav aria-label="Main" className={s.nav}>
              <div ref={scrollerRef} className={s.scroller}>
                <LayoutGroup id={`${id}-line`}>
                  <ul className={s.links}>
                    {links.map((l) => {
                      const on = l.slug === current;
                      return (
                        <li key={l.slug}>
                          <a
                            href={l.href}
                            className={cx(s.link, shared.ring)}
                            aria-current={on ? "page" : undefined}
                            onClick={linkClick(onNavigate, l.slug)}
                          >
                            {l.label}
                            {on && (
                              <motion.span
                                layoutId="line"
                                className={s.line}
                                aria-hidden="true"
                                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                              />
                            )}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </LayoutGroup>
              </div>
            </nav>
          </div>
        </header>

        <main ref={mainRef} id={mainId} tabIndex={-1} className={cx(shared.main, s.main)}>
          {children}
        </main>
      </div>
    </MotionConfig>
  );
}
