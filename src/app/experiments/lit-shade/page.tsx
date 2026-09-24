import LitShade from "@/components/LitShade/LitShade";

export const metadata = {
  title: "Lit shade / portfolio experiments",
};

export default function LitShadePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6">
      <LitShade variant="full" strands={56} lit />
    </main>
  );
}
