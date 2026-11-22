"use client";

import { useCallback, useId, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  Brand,
  Check,
  ChevronGlyph,
  EASE_OUT,
  SkipLink,
  cx,
  linkClick,
  shared,
  useDismiss,
  useTriggerOrigin,
  type NavPanelProps,
} from "./shared";
import s from "./NavIndex.module.css";

/**
 * 4 · Index. The bar holds only the brand and a Menu button, at every width.
 * The button drops an index of the pages in large numbered rows, grown from
 * the button; the page you are on carries a check at the end of its row.
 */
export default function NavIndex({
  links,
  current,
  brand = "Brand",
  brandHref = "#",
  variant = "full",
  onNavigate,
  children,
}: NavPanelProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const id = useId();
  const mainId = `${id}-main`;
  const panelId = `${id}-panel`;

  useDismiss(open, close, triggerRef, panelRef);
  useTriggerOrigin(open, triggerRef, panelRef);

  const rowIn = (i: number) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.18, ease: EASE_OUT, delay: reduce ? 0 : 0.03 * i },
  });
  const rowFrom = reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(8px)" };

  return (
    <MotionConfig reducedMotion="user">
      <div className={cx(shared.rhythm, s.root, variant === "embed" && s.embed)}>
        <SkipLink target={mainId} />
        <header className={s.bar}>
          <div className={s.inner}>
            <Brand label={brand} href={brandHref} current={current} onNavigate={onNavigate} after={close} />
            <button
              ref={triggerRef}
              type="button"
              className={cx(s.menu, shared.ring)}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((o) => !o)}
            >
              <span>Menu</span>
              <ChevronGlyph open={open} />
            </button>
          </div>

          <AnimatePresence>
            {open && (
              <motion.nav
                ref={panelRef}
                id={panelId}
                aria-label="Main"
                className={s.panel}
                initial={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
                animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: EASE_OUT } }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: { duration: 0.12, ease: EASE_OUT } }}
              >
                <ol className={s.list}>
                  {links.map((l, i) => {
                    const on = l.slug === current;
                    return (
                      <motion.li key={l.slug} initial={rowFrom} animate={rowIn(i)}>
                        <a
                          href={l.href}
                          className={s.row}
                          aria-current={on ? "page" : undefined}
                          onClick={linkClick(onNavigate, l.slug, close)}
                        >
                          <span className={s.num} aria-hidden="true">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className={s.big}>{l.label}</span>
                          <span className={s.mark}>{on && <Check size={24} stroke={2} />}</span>
                        </a>
                      </motion.li>
                    );
                  })}
                </ol>
              </motion.nav>
            )}
          </AnimatePresence>
        </header>

        <main id={mainId} tabIndex={-1} className={cx(shared.main, s.main)}>
          {children}
        </main>
      </div>
    </MotionConfig>
  );
}
