export const metadata = {
  title: "Bubbles / portfolio experiments",
};

/* Bubbles is a standalone WebGL page rather than a component, so it runs as itself from
   public/ instead of being rewritten as React. The shader is the piece; porting it would
   only risk changing it. */
export default function BubblesPage() {
  return (
    <iframe
      src="/bubbles/index.html"
      title="Bubbles"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0 }}
    />
  );
}
