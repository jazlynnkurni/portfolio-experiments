export const metadata = {
  title: "Pear",
};

/**
 * Pear. The watercolour pear from the pear lab, a self-contained page in
 * public/pear (the paint, the ants and their saved shapes), framed here.
 */
export default function PearPage() {
  return (
    <iframe
      src="/pear/index.html"
      title="Pear"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, display: "block" }}
    />
  );
}
