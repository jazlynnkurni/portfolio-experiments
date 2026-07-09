"use client";

import { Plus_Jakarta_Sans } from "next/font/google";
import styles from "@/components/BlueDance/LoadingDance.module.css";
import type { CSSProperties } from "react";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "600"] });

const WHOLE = [
  ["sway", "leans side to side, swaying to the music"],
  ["bounce", "bops up and down on the beat"],
  ["beat", "pulses on the downbeat"],
  ["wiggle", "quick playful shimmy"],
  ["shimmer", "disco-blue light sweeps across"],
] as const;

const PER_LETTER = [
  ["wave", "a Mexican wave rolls down the letters"],
  ["lift", "letters jump up in sequence — hover me (interactive)"],
] as const;

function Letters() {
  return (
    <>
      {"Friday".split("").map((c, i) => (
        <span key={i} style={{ "--i": i } as CSSProperties}>
          {c}
        </span>
      ))}
    </>
  );
}

function Row({
  name,
  desc,
  letters,
}: {
  name: string;
  desc: string;
  letters?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 24,
        padding: "18px 0",
        borderBottom: "1px solid #eee",
      }}
    >
      <div style={{ width: 96, flexShrink: 0 }}>
        <div
          style={{
            font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: 1,
            color: "#0a2fb7",
            textTransform: "uppercase",
          }}
        >
          {name}
        </div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: "#0b0b0c", flex: 1 }}>
        loading your{" "}
        <span className={`${styles.friday} ${styles[name]}`}>
          {letters ? <Letters /> : "Friday"}
        </span>{" "}
        night
      </div>
      <div style={{ fontSize: 13, color: "#888", width: 300, flexShrink: 0 }}>{desc}</div>
    </div>
  );
}

export default function AnimGalleryPage() {
  return (
    <main
      className={jakarta.className}
      style={{ minHeight: "100dvh", background: "#fff", padding: "56px 40px" }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1
          style={{
            font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: 2,
            color: "#888",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Friday &mdash; animation options
        </h1>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>
          Watch each one, then tell me the name that resonates and I&apos;ll lock it into the loader.
        </p>
        {WHOLE.map(([n, d]) => (
          <Row key={n} name={n} desc={d} />
        ))}
        {PER_LETTER.map(([n, d]) => (
          <Row key={n} name={n} desc={d} letters />
        ))}
      </div>
    </main>
  );
}
