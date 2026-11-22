"use client";

import { useEffect, useLayoutEffect, type MouseEvent, type RefObject } from "react";
import s from "./shared.module.css";

export type NavLink = { slug: string; label: string; href: string };

export type NavPanelProps = {
  links: NavLink[];
  /** slug of the page you are on; HOME when the brand is the current page */
  current: string;
  brand?: string;
  brandHref?: string;
  /** "full" pins to the viewport, "embed" stays inside its parent box */
  variant?: "full" | "embed";
  /** when given, links call this instead of a full page load */
  onNavigate?: (slug: string) => void;
  children?: React.ReactNode;
};

export const HOME = "home";
export const PHONE_QUERY = "(max-width: 767.98px)";
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

/** a plain click navigates in place; modified clicks keep the browser default */
export function linkClick(onNavigate: NavPanelProps["onNavigate"], slug: string, after?: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    after?.();
    onNavigate(slug);
  };
}

/**
 * Closes an open panel on Escape (focus goes back to the trigger), on a press
 * outside the trigger and the panel, when focus leaves both, and when the
 * window grows past phone width so a phone-only panel never lingers.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (!!panelRef.current?.contains(t) || !!triggerRef.current?.contains(t));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) close();
    };
    const onFocus = (e: FocusEvent) => {
      if (!inside(e.target)) close();
    };
    const mq = window.matchMedia(PHONE_QUERY);
    const onMq = () => {
      if (!mq.matches) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
      mq.removeEventListener("change", onMq);
    };
  }, [open, close, triggerRef, panelRef]);
}

/**
 * Trigger origin: the panel grows from its top edge at the trigger's centre x.
 * Measured from layout boxes (offsetLeft), so the panel's own enter scale
 * does not skew the reading.
 */
export function useTriggerOrigin(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current;
    const p = panelRef.current;
    const parent = p?.offsetParent;
    if (!t || !p || !parent) return;
    const tr = t.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    const x = tr.left + tr.width / 2 - pr.left - p.offsetLeft;
    p.style.transformOrigin = `${x.toFixed(1)}px 0px`;
  }, [open, triggerRef, panelRef]);
}

/** keeps Tab inside an open modal panel */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key !== "Tab" || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, ref]);
}

export function SkipLink({ target }: { target: string }) {
  return (
    <a className={cx(s.skip, s.ring)} href={`#${target}`}>
      Skip to content
    </a>
  );
}

export function Brand({
  label,
  href,
  current,
  onNavigate,
  markOnly = false,
  className,
  after,
}: {
  label: string;
  href: string;
  current: string;
  onNavigate?: (slug: string) => void;
  markOnly?: boolean;
  className?: string;
  after?: () => void;
}) {
  return (
    <a
      className={cx(s.brand, s.ring, className)}
      href={href}
      aria-current={current === HOME ? "page" : undefined}
      aria-label={markOnly ? label : undefined}
      onClick={linkClick(onNavigate, HOME, after)}
    >
      <span className={s.brandMark} aria-hidden="true" />
      {!markOnly && <span className={s.brandLabel}>{label}</span>}
    </a>
  );
}

/** two-line menu glyph that swaps to a close glyph in the same 20px cell */
export function MenuGlyph({ open }: { open: boolean }) {
  return (
    <span className={s.swap} aria-hidden="true">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" data-on={!open}>
        <path d="M4 7h12M4 13h12" />
      </svg>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" data-on={open}>
        <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
      </svg>
    </span>
  );
}

export function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </svg>
  );
}

/** down at rest, up while open, as a swap in a 12px cell */
export function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <span className={s.swap} style={{ ["--swap" as string]: "12px" }} aria-hidden="true">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" data-on={!open}>
        <path d="M3 4.5l3 3 3-3" />
      </svg>
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" data-on={open}>
        <path d="M3 7.5l3-3 3 3" />
      </svg>
    </span>
  );
}

export function Check({ size = 16, stroke = 1.5 }: { size?: number; stroke?: number }) {
  return (
    <svg className={s.check} viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export { s as shared };
