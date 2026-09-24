import TinToggle from "@/components/TinToggle/TinToggle";

export const metadata = {
  title: "Tin toggle / portfolio experiments",
};

/**
 * The switch is a small object on a large page, so it is centred in the
 * viewport rather than parked at the top. Inside a sandbox card that viewport
 * is the 1280x800 frame, which puts the toggle in the middle of the plate.
 */
export default function TinTogglePage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#ffffff",
      }}
    >
      <TinToggle variant="full" />
    </div>
  );
}
