"use client";

import { useId } from "react";
import { LayoutGroup, MotionConfig, motion } from "framer-motion";
import { Brand, SkipLink, cx, linkClick, shared, type NavPanelProps } from "./shared";
import s from "./NavDock.module.css";

/**
 * 2 · Dock. A floating capsule at the bottom of the screen, under the thumb.
 * The current page is marked by a dot that slides under its label. There is
 * no menu on phone: the dock stretches to the gutters and the pages share its
 * width equally, while the brand stays at the top of the page.
 */
export default function NavDock({
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

  return (
    <MotionConfig reducedMotion="user">
      <div className={cx(shared.rhythm, s.root, variant === "embed" && s.embed)}>
        <SkipLink target={mainId} />

        <nav aria-label="Main" className={s.dock}>
          <Brand label={brand} href={brandHref} current={current} onNavigate={onNavigate} className={s.dockBrand} />
          <span className={s.divider} aria-hidden="true" />
          <LayoutGroup id={`${id}-dock`}>
            <ul className={s.links}>
              {links.map((l) => {
                const on = l.slug === current;
                return (
                  <li key={l.slug} className={s.item}>
                    <a
                      href={l.href}
                      className={cx(s.link, shared.ring)}
                      aria-current={on ? "page" : undefined}
                      onClick={linkClick(onNavigate, l.slug)}
                    >
                      <span className={s.label}>{l.label}</span>
                      {on && (
                        <motion.span
                          layoutId="dot"
                          className={s.dot}
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
        </nav>

        <main id={mainId} tabIndex={-1} className={cx(shared.main, s.main)}>
          <div className={s.top}>
            <Brand label={brand} href={brandHref} current={current} onNavigate={onNavigate} />
          </div>
          {children}
        </main>
      </div>
    </MotionConfig>
  );
}
