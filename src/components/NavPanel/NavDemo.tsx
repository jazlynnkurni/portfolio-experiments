"use client";

import { useEffect, useRef, useState } from "react";
import NavBar from "./NavBar";
import NavDock from "./NavDock";
import NavHide from "./NavHide";
import NavIndex from "./NavIndex";
import NavRail from "./NavRail";
import { HOME, type NavLink } from "./shared";
import d from "./demo.module.css";

export const DEMO_LINKS: NavLink[] = [
  { slug: "work", label: "Work", href: "#work" },
  { slug: "about", label: "About", href: "#about" },
  { slug: "lab", label: "Lab", href: "#lab" },
  { slug: "contact", label: "Contact", href: "#contact" },
];

const NAVS = [NavBar, NavDock, NavHide, NavIndex, NavRail];

/** a stand-in page so each nav has something to sit on and scroll over */
function DemoPage({ title, headingRef }: { title: string; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className={d.page}>
      <p className={d.eyebrow}>Placeholder page</p>
      <h1 ref={headingRef} tabIndex={-1} className={d.title}>
        {title}
      </h1>
      <p className={d.lede}>This page stands in for real content, so the navigation has something to sit on and scroll over.</p>
      <div className={d.grid} aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className={d.block} />
        ))}
      </div>
    </div>
  );
}

export default function NavDemo({ direction }: { direction: 1 | 2 | 3 | 4 | 5 }) {
  const [current, setCurrent] = useState<string>(DEMO_LINKS[0].slug);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const Nav = NAVS[direction - 1];
  const title = current === HOME ? "Home" : DEMO_LINKS.find((l) => l.slug === current)?.label ?? "";

  // a navigation lands like a page load: back to the top, focus on the new heading
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [current]);

  return (
    <Nav links={DEMO_LINKS} current={current} onNavigate={setCurrent} variant="full">
      <DemoPage title={title} headingRef={headingRef} />
    </Nav>
  );
}
