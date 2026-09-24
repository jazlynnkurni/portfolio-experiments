import FabricClock from "@/components/FabricClock/FabricClock";

export const metadata = {
  title: "Fabric clock / portfolio experiments",
};

export default function FabricClockPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6">
      <FabricClock variant="full" word="BROKEN" give={0.9} timeScale={1} />
    </main>
  );
}
