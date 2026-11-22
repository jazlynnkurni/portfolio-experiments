"use client";

import { useCallback, useId, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  Brand,
  Check,
  EASE_OUT,
  MenuGlyph,
  SkipLink,
  cx,
  linkClick,
  shared,
  useDismiss,
  useTriggerOrigin,
  type NavPanelProps,
} from "./shared";
import s from "./NavBar.module.css";

/**
 * 1 · Bar. A top bar whose current page carries a cream pill that slides to
 * the link you press. On phone the links fold into a menu button whose panel
 * grows from the button.
 */
export default function NavBar({
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

  return (
    <MotionConfig reducedMotion="user">
      <div className={cx(shared.rhythm, s.root, variant === "embed" && s.embed)}>
        <SkipLink target={mainId} />
        <header className={s.bar}>
          <div className={s.inner}>
            <Brand label={brand} href={brandHref} current={current} onNavigate={onNavigate} after={close} />

            <nav aria-label="Main" className={s.desk}>
              <LayoutGroup id={`${id}-desk`}>
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
                          {on && (
                            <motion.span
                              layoutId="pill"
                              className={s.pill}
                              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                            />
                          )}
                          <span className={s.label}>{l.label}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </LayoutGroup>
            </nav>

            <button
              ref={triggerRef}
              type="button"
              className={cx(shared.iconBtn, shared.ring, s.menuBtn)}
              aria-label="Menu"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((o) => !o)}
            >
              <MenuGlyph open={open} />
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
                <ul className={s.list}>
                  {links.map((l) => {
                    const on = l.slug === current;
                    return (
                      <li key={l.slug}>
                        <a
                          href={l.href}
                          className={s.row}
                          aria-current={on ? "page" : undefined}
                          onClick={linkClick(onNavigate, l.slug, close)}
                        >
                          <span className={s.rowLabel}>{l.label}</span>
                          {on && <Check />}
                        </a>
                      </li>
                    );
                  })}
                </ul>
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
