import HangingGhost from "@/components/HangingGhost/HangingGhost";

export const metadata = {
  title: "Hanging ghost / portfolio experiments",
};

export default function HangingGhostPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff5ef] p-6">
      <HangingGhost variant="full" drape={0.5} swing={9} />
    </main>
  );
}
