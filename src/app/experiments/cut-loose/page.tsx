import CutLoose from "@/components/CutLoose/CutLoose";

export const metadata = {
  title: "Cut loose / portfolio experiments",
};

export default function CutLoosePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff5ef] p-6">
      <CutLoose variant="full" drape={0.45} stitchTime={2.4} />
    </main>
  );
}
