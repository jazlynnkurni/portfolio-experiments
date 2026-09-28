"use client";

import { useEffect } from "react";

/**
 * The revamp's nav and footer, on the sandbox. The two apps live on different
 * ports, so nothing is shared by reference: this is the chassis rebuilt here
 * with the same numbers, and the links carry the colour mode across in the
 * URL because localStorage does not cross an origin.
 */
const HOME = "http://localhost:5330";

export function themeParam() {
  if (typeof document === "undefined") return "";
  const t = document.documentElement.getAttribute("data-theme");
  return t ? `?theme=${t}` : "";
}

export function Nav() {
  useEffect(() => {
    /* the drop of ink under the glass: travels to whatever the pointer is over */
    const pill = document.querySelector<HTMLElement>(".rv nav .links");
    if (!pill) return;
    const drop = document.createElement("span");
    drop.className = "drop";
    pill.prepend(drop);
    const items = Array.from(pill.querySelectorAll<HTMLElement>(":scope > a, :scope > button"));
    let seeded = false, cx = 0;
    const set = (x: number, w: number) => { drop.style.transform = `translateX(${x.toFixed(1)}px)`; drop.style.width = w.toFixed(1) + "px"; };
    const go = (el: HTMLElement) => {
      const r = el.getBoundingClientRect(), p = pill.getBoundingClientRect();
      const x = r.left - p.left, w = r.width;
      if (!seeded) { drop.style.transition = "none"; set(x + w / 2, 0); void drop.offsetWidth; drop.style.transition = ""; seeded = true; }
      cx = x + w / 2; drop.classList.remove("out"); set(x, w); drop.classList.add("on");
    };
    const leave = () => { drop.classList.add("out"); set(cx, 0); drop.classList.remove("on"); };
    const offs = items.map((el) => { const f = () => go(el); el.addEventListener("pointerenter", f); el.addEventListener("focus", f); return () => { el.removeEventListener("pointerenter", f); el.removeEventListener("focus", f); }; });
    pill.addEventListener("pointerleave", leave);

    /* the cursor */
    let cur: HTMLDivElement | null = null;
    const offCursor: Array<() => void> = [];
    if (matchMedia("(hover: hover) and (pointer:fine)").matches) {
      cur = document.createElement("div"); cur.id = "cur"; cur.appendChild(document.createElement("i")); document.body.appendChild(cur);
      let tx = -100, ty = -100, x = -100, y = -100, raf = 0, shown = false;
      const c = cur;
      const loop = () => { x += (tx - x) * 0.42; y += (ty - y) * 0.42; c.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`; if (Math.abs(tx - x) + Math.abs(ty - y) > 0.05) raf = requestAnimationFrame(loop); else raf = 0; };
      const move = (e: PointerEvent) => {
        tx = e.clientX; ty = e.clientY;
        if (!shown) { x = tx; y = ty; shown = true; c.classList.add("on"); }
        const t = e.target as HTMLElement | null;
        const hot = t && t.closest ? t.closest("a,button,[role=button]") : null;
        c.classList.toggle("hot", !!hot);
        /* over a live plate the frame owns the pointer, so the bead steps aside */
        c.classList.toggle("off", !!(t && t.closest && t.closest("iframe,[data-live='true']")));
        if (!raf) raf = requestAnimationFrame(loop);
      };
      const dn = () => c.classList.add("down"), upf = () => c.classList.remove("down");
      addEventListener("pointermove", move, { passive: true }); addEventListener("pointerdown", dn); addEventListener("pointerup", upf);
      offCursor.push(() => { removeEventListener("pointermove", move); removeEventListener("pointerdown", dn); removeEventListener("pointerup", upf); });
    }
    return () => { offs.forEach((f) => f()); pill.removeEventListener("pointerleave", leave); drop.remove(); offCursor.forEach((f) => f()); cur?.remove(); };
  }, []);

  const toggle = () => {
    const html = document.documentElement;
    const t = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.classList.add("theming");
    setTimeout(() => html.classList.remove("theming"), 560);
    html.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch {}
  };
  /* the links carry the mode across the origin boundary */
  const carry = (e: React.MouseEvent<HTMLAnchorElement>) => { const a = e.currentTarget; const base = a.getAttribute("data-href") || a.href; a.href = base + themeParam(); };

  return (
    <nav><div className="wrap in">
      <span className="markwrap"><a className="mark" href={HOME + "/"} data-href={HOME + "/"} onClick={carry} aria-label="Home, Jazlynn">
        <img className="sm-ink" src={HOME + "/jaz-signature.svg?v=green1"} alt="" aria-hidden="true" draggable={false} />
        <img className="sm-paper" src={HOME + "/jaz-signature-paper.svg?v=green1"} alt="" aria-hidden="true" draggable={false} />
      </a>
      <p className="sm-blurb"><b>Design engineer who creates charming products.</b><span>Prev @ Manus AI.</span><span>HCI @ Columbia University {"\u2019"}27.</span></p></span>
      <span className="links">
        <button id="theme" aria-label="Switch colour mode" title="Colour mode" onClick={toggle}>
          <svg className="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg className="moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        </button>
        <a className="l" href={HOME + "/#work"} data-href={HOME + "/#work"} onClick={carry}>Projects</a>
        <a className="l" href="/sandbox" aria-current="page">Sandbox</a>
        <a className="l" href={HOME + "/art-gallery.html"} data-href={HOME + "/art-gallery.html"} onClick={carry}>Art Gallery</a>
        <a className="l" href={HOME + "/about.html"} data-href={HOME + "/about.html"} onClick={carry}>About</a>
      </span>
    </div></nav>
  );
}

export function Footer() {
  useEffect(() => {
    const el = document.getElementById("clock"); if (!el) return;
    const f = () => { el.textContent = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }); };
    f(); const id = setInterval(f, 1000); return () => clearInterval(id);
  }, []);
  return (
    <footer><div className="wrap"><div className="rule" /><div className="in">
      <span className="t">My local time <b id="clock" /></span>
      <span style={{ display: "flex", gap: 20 }}><a href="mailto:jazkurnz06@gmail.com">Email</a><a href="#">LinkedIn</a><a href="#">X</a></span>
      <span className="t">© 2026 Jazlynn Kurniandra</span>
    </div></div></footer>
  );
}

/* runs before the page paints, so the first frame is already the right mode */
export const THEME_INIT = `(function(){var q=new URLSearchParams(location.search).get('theme');var t=q;try{t=t||localStorage.getItem('theme');}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);if(q){try{localStorage.setItem('theme',q);}catch(e){}}})();`;
