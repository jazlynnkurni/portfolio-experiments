import SnookerScene from "@/components/snooker/ChromeSnookerScene";

export const metadata = {
  title: "Billiards / portfolio experiments",
};

/* The scene sizes itself to its container, so the card just gives it the frame and
   stays out of the way. */
export default function BilliardsPage() {
  return (
    <main style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center" }}>
      <SnookerScene />
    </main>
  );
}
