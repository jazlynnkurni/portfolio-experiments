"use client";

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useMotionTemplate,
} from "framer-motion";
import { useRef, type ReactNode, type PointerEvent } from "react";

type TiltCardProps = {
  children: ReactNode;
  maxTilt?: number;
  glare?: number;
  scale?: number;
  holo?: boolean;
  aspect?: string;
  className?: string;
};

export function TiltCard({
  children,
  maxTilt = 14,
  glare = 0.45,
  scale = 1.04,
  holo = true,
  aspect = "1.58 / 1",
  className = "",
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);
  const active = useMotionValue(0);

  const spring = { stiffness: 220, damping: 26, mass: 0.6 };
  const rxS = useSpring(rx, spring);
  const ryS = useSpring(ry, spring);
  const gxS = useSpring(gx, spring);
  const gyS = useSpring(gy, spring);
  const activeS = useSpring(active, { stiffness: 180, damping: 24 });

  const scaleV = useTransform(activeS, [0, 1], [1, scale]);

  const glareOpacity = useTransform(activeS, (a) => a * glare);
  const glareBg = useMotionTemplate`radial-gradient(circle at ${gxS}% ${gyS}%, rgba(255,255,255,${glareOpacity}), rgba(255,255,255,0) 45%)`;

  const sweep = useTransform(ryS, [-maxTilt, maxTilt], [110, -10]);
  const sweepLo = useTransform(sweep, (s) => s - 22);
  const sweepHi = useTransform(sweep, (s) => s + 22);
  const sheenA = useTransform(activeS, (a) => a * 0.22);
  const sheenBg = useMotionTemplate`linear-gradient(105deg, rgba(255,255,255,0) ${sweepLo}%, rgba(255,255,255,${sheenA}) ${sweep}%, rgba(255,255,255,0) ${sweepHi}%)`;

  const holoOpacity = useTransform(activeS, (a) => (holo ? a * 0.22 : 0));
  const holoHue = useTransform(gxS, [0, 100], [0, 90]);
  const holoFilter = useMotionTemplate`hue-rotate(${holoHue}deg)`;
  const holoPos = useMotionTemplate`${gxS}% ${gyS}%`;

  function handleMove(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    ry.set((px - 0.5) * 2 * maxTilt);
    rx.set(-(py - 0.5) * 2 * maxTilt);
    gx.set(px * 100);
    gy.set(py * 100);
    active.set(1);
  }

  function handleLeave() {
    rx.set(0);
    ry.set(0);
    gx.set(50);
    gy.set(50);
    active.set(0);
  }

  return (
    <div ref={ref} className="[perspective:1100px]" onPointerMove={handleMove} onPointerLeave={handleLeave}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        style={{
          rotateX: rxS,
          rotateY: ryS,
          scale: scaleV,
          transformStyle: "preserve-3d",
          aspectRatio: aspect,
        }}
        className={`relative w-full cursor-pointer overflow-hidden rounded-[8.17%_/_12.91%] shadow-[0_24px_50px_-28px_rgba(0,0,0,0.45)] ${className}`}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[8.17%_/_12.91%] [backface-visibility:hidden]">
          {children}
        </div>

        {/* constant gleam: a diagonal specular sweep (bright core + soft halo and a
            faint trailing glint) looping bottom-left -> top-right, like real light
            travelling across a glossy laminated card */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[8.17%_/_12.91%] mix-blend-screen"
          style={{
            background:
              "linear-gradient(57deg, transparent 34%, rgba(255,255,255,0.12) 42%, rgba(255,255,255,0.95) 47%, rgba(255,255,255,0.12) 52%, transparent 56%, rgba(255,255,255,0.4) 60%, transparent 66%)",
            backgroundSize: "230% 230%",
          }}
          animate={{ backgroundPosition: ["0% 100%", "100% 0%"] }}
          transition={{ duration: 3, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.2 }}
        />

        <motion.div
          aria-hidden
          style={{ opacity: holoOpacity, filter: holoFilter, backgroundPosition: holoPos }}
          className="pointer-events-none absolute inset-0 rounded-[8.17%_/_12.91%] bg-[conic-gradient(from_0deg,#ff2cdf,#2cffd6,#ffe92c,#2c6bff,#ff2cdf)] [background-size:300%_300%] mix-blend-color-dodge"
        />
        <motion.div
          aria-hidden
          style={{ background: sheenBg }}
          className="pointer-events-none absolute inset-0 rounded-[8.17%_/_12.91%] mix-blend-soft-light"
        />
        <motion.div
          aria-hidden
          style={{ background: glareBg }}
          className="pointer-events-none absolute inset-0 rounded-[8.17%_/_12.91%] mix-blend-overlay"
        />
      </motion.div>
    </div>
  );
}

type LicenseCardFaceProps = {
  photoSrc?: string;
  parallax?: boolean;
};

export function LicenseCardFace({ photoSrc, parallax = true }: LicenseCardFaceProps) {
  const z = (depth: number) => (parallax ? `translateZ(${depth}px)` : undefined);

  // handwriting overlays placed over the printed lines (percentages of the card)
  const fields = [
    { src: "/tilt-card/name.png", left: 60, top: 7, h: 20, rot: -2 },
    { src: "/tilt-card/birthdate.png", left: 64, top: 26, h: 6, rot: 0 },
    { src: "/tilt-card/city.png", left: 65, top: 32, h: 8, rot: -1 },
    { src: "/tilt-card/issued-date.png", left: 64, top: 38, h: 6, rot: 1.5 },
  ];

  return (
    <div className="relative h-full w-full select-none">
      {/* the provided card artwork (tight-trimmed to fill the frame, so the card
          edge IS the card edge - no doubled corner) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/tilt-card/card.png"
        alt="Permanent License of Travel"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* optional traveler photo into the empty box */}
      {photoSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoSrc}
          alt="Authorized traveler"
          draggable={false}
          className="pointer-events-none absolute object-cover"
          style={{ left: "4.2%", top: "9%", width: "33.2%", height: "75.5%", transform: z(20) }}
        />
      )}

      {/* handwritten field values, lifted on Z so they parallax over the card */}
      {fields.map((f) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={f.src}
          src={f.src}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute w-auto max-w-none"
          style={{
            left: `${f.left}%`,
            top: `${f.top}%`,
            height: `${f.h}%`,
            transform: `${z(34) ? z(34) + " " : ""}rotate(${f.rot}deg)`,
            transformOrigin: "left top",
          }}
        />
      ))}
    </div>
  );
}
