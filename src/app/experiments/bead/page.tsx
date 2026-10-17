export const metadata = {
  title: "Bead",
};

/**
 * Bead. The liquid-glass menu from the menu lab, a self-contained page in
 * public/bead (its springs, the goo filter and the shader orb), framed here.
 */
export default function BeadPage() {
  return (
    <iframe
      src="/bead/bead.html"
      title="Bead"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, display: "block" }}
    />
  );
}
