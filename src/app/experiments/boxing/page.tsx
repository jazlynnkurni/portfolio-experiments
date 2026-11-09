export const metadata = {
  title: "Boxing",
};

/**
 * Boxing. The boxing GIF in code from the boxing lab, a self-contained page in
 * public/boxing (the paper-puppet rig and the glass view), framed here.
 */
export default function BoxingPage() {
  return (
    <iframe
      src="/boxing/index.html"
      title="Boxing"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, display: "block" }}
    />
  );
}
