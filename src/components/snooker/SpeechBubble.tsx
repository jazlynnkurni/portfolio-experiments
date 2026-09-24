"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type Props = {
  text: string;
  visible: boolean;
};

const BUBBLE_BG = "#FFFAF4";
const TYPE_INTERVAL_MS = 40;

export default function SpeechBubble({ text, visible }: Props) {
  const [revealed, setRevealed] = useState(0);
  const [showCursor, setShowCursor] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRevealed(0);
      setShowCursor(false);
      return;
    }

    setRevealed(0);
    setShowCursor(true);

    const interval = setInterval(() => {
      setRevealed((r) => {
        const next = r + 1;
        if (next >= text.length) {
          clearInterval(interval);
          setShowCursor(false);
          return text.length;
        }
        return next;
      });
    }, TYPE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [text, visible]);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.9 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      style={{
        position: "relative",
        width: "100%",
        // Defense-in-depth cap: the parent in SnookerScene also limits this
        // to min(260px, calc(100vw - 32px)) so the bubble can never extend
        // past the viewport edge. width:100% lets the bubble fill that
        // capped parent — combined with normal word wrapping, long taunts
        // wrap to multiple lines rather than overflowing or truncating.
        maxWidth: "100%",
        wordWrap: "break-word",
        overflowWrap: "break-word",
        backgroundColor: BUBBLE_BG,
        borderRadius: "18px",
        padding: "10px 14px",
        boxShadow:
          "0 2px 4px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.04)",
        fontFamily: "var(--font-sans), sans-serif",
        fontSize: "13.5px",
        fontWeight: 400,
        lineHeight: 1.35,
        color: "rgba(30, 30, 30, 0.85)",
        pointerEvents: visible ? "auto" : "none",
        zIndex: 40,
      }}
    >
      <span>{text.slice(0, revealed)}</span>
      {showCursor && (
        <motion.span
          aria-hidden
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{
            duration: 0.5,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "linear",
          }}
          style={{ marginLeft: "1px", display: "inline-block" }}
        >
          |
        </motion.span>
      )}
      <span
        aria-hidden
        style={{
          position: "absolute",
          bottom: "-5px",
          right: "22%",
          width: "12px",
          height: "12px",
          backgroundColor: BUBBLE_BG,
          transform: "rotate(45deg)",
          borderRadius: "2px",
          boxShadow: "2px 2px 4px rgba(0, 0, 0, 0.04)",
          zIndex: -1,
        }}
      />
    </motion.div>
  );
}
