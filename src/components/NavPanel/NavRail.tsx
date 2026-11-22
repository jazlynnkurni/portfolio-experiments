"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  Brand,
  CloseGlyph,
  EASE_OUT,
  MenuGlyph,
  SkipLink,
  cx,
  linkClick,
  shared,
  useDismiss,
  useFocusTrap,
  type NavLink,
  type NavPanelProps,
} from "./shared";
import s from "./NavRail.module.css";

function RailList({
  links,
  current,
  onNavigate,
  group,
  after,
}: {
  links: NavLink[];
  current: string;
  onNavigate?: (slug: string) => void;
  group: string;
  after?: () => void;
}) {
  return (
    <LayoutGroup id={group}>
      <ul className={s.list}>
        {links.map((l) => {
          const on = l.slug === current;
          return (
            <li key={l.slug}>
              <a
                href={l.href}
                className={cx(s.row, shared.ring)}
                aria-current={on ? "page" : undefined}
                onClick={linkClick(onNavigate, l.slug, after)}
              >
                {on && (
                  <motion.span
                    layoutId="bar"
                    className={s.marker}
                    aria-hidden="true"
                    transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                  />
                )}
                <span className={s.rowLabel}>{l.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </LayoutGroup>
  );
}

/**
 * 5 · Rail. On desktop the pages stand in a vertical rail down the left side,
 * and an orange bar on the rail's edge slides to the page you are on. On phone
 * the rail becomes a drawer that slides in from the left, the side it lives on.
 */
export default function NavRail({
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
  const drawerRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const id = useId();
  const mainId = `${id}-main`;
  const drawerId = `${id}-drawer`;
  const full = variant === "full";

  useDismiss(open, close, triggerRef, drawerRef);
  useFocusTrap(open, drawerRef);

  const closeAndReturn = () => close();

  // focus lands on the page you are on; the page behind stops scrolling.
  // On close, focus goes back to the trigger once it is no longer inert,
  // unless something else (a navigation) has already taken it.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        const a = document.activeElement;
        if (!a || a === document.body || drawerRef.current?.contains(a)) triggerRef.current?.focus();
      }
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const el = drawerRef.current;
    const target = el?.querySelector<HTMLElement>('[aria-current="page"]') ?? el?.querySelector<HTMLElement>("a[href]");
    target?.focus();
    if (!full) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open, full]);

  const drawerFrom = reduce ? { opacity: 0 } : { x: "-100%" };
  const drawerTo = reduce ? { opacity: 1 } : { x: 0 };

  return (
    <MotionConfig reducedMotion="user">
      <div className={cx(shared.rhythm, s.root, !full && s.embed)}>
        <SkipLink target={mainId} />

        <aside className={s.rail}>
          <div className={s.railBrand}>
            <Brand label={brand} href={brandHref} current={current} onNavigate={onNavigate} />
          </div>
          <nav aria-label="Main">
            <RailList links={links} current={current} onNavigate={onNavigate} group={`${id}-rail`} />
          </nav>
        </aside>

        <header className={s.top} inert={open}>
          <button
            ref={triggerRef}
            type="button"
            className={cx(shared.iconBtn, shared.ring, s.menuBtn)}
            aria-label="Menu"
            aria-expanded={open}
            aria-controls={drawerId}
            onClick={() => setOpen((o) => !o)}
          >
            <MenuGlyph open={open} />
          </button>
          <Brand label={brand} href={brandHref} current={current} onNavigate={onNavigate} />
        </header>

        <main id={mainId} tabIndex={-1} className={cx(shared.main, s.main)} inert={open}>
          {children}
        </main>

        <AnimatePresence>
          {open && (
            <>
              <motion.div
                key="scrim"
                className={s.scrim}
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.24, ease: EASE_OUT } }}
                exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE_OUT } }}
                onClick={closeAndReturn}
              />
              <motion.div
                key="drawer"
                ref={drawerRef}
                id={drawerId}
                role="dialog"
                aria-modal="true"
                aria-label="Main menu"
                className={s.drawer}
                initial={drawerFrom}
                animate={{ ...drawerTo, transition: { duration: 0.24, ease: EASE_OUT } }}
                exit={{ ...drawerFrom, transition: { duration: 0.18, ease: EASE_OUT } }}
              >
                <div className={s.drawerHead}>
                  <Brand label={brand} href={brandHref} current={current} onNavigate={onNavigate} after={close} />
                  <button
                    type="button"
                    className={cx(shared.iconBtn, shared.ring, s.closeBtn)}
                    aria-label="Close menu"
                    onClick={closeAndReturn}
                  >
                    <CloseGlyph />
                  </button>
                </div>
                <nav aria-label="Main">
                  <RailList links={links} current={current} onNavigate={onNavigate} group={`${id}-drawer`} after={close} />
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
