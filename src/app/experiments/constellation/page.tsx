import Constellation, { DEFAULT_CONSTELLATION } from "@/components/Constellation/Constellation";

export const metadata = {
  title: "Constellation / portfolio experiments",
};

/* The field fills the frame, so the card shows it the way the page behind a case study
   does: nothing in front of it, and the pointer free to pull the nodes around. */
export default function ConstellationPage() {
  return (
    <main style={{ position: "fixed", inset: 0, background: "#0b0d10" }}>
      <Constellation config={DEFAULT_CONSTELLATION} />
    </main>
  );
}
