export const metadata = {
  title: "Porcelain",
};

/**
 * Porcelain. The live three.js piece is a self-contained page in
 * public/porcelain (an import map to three on jsdelivr, her saved shapes
 * baked in), so it is framed here rather than rebuilt as components. The
 * sandbox frames this route in turn; pointer events reach the inner page.
 */
export default function PorcelainPage() {
  return (
    <iframe
      src="/porcelain/index.html"
      title="Porcelain"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, display: "block" }}
    />
  );
}
