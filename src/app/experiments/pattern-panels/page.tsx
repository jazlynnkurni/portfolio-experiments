import PatternPanels from "@/components/PatternPanels/PatternPanels";

export const metadata = {
  title: "Pattern panels / portfolio experiments",
};

export default function PatternPanelsPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6">
      <PatternPanels variant="full" drape={0.5} />
    </main>
  );
}
