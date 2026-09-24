import VeilParting from "@/components/VeilParting/VeilParting";

export const metadata = {
  title: "Veil parting / portfolio experiments",
};

export default function VeilPartingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff5ef] p-6">
      <VeilParting variant="full" cols={26} weight={0.5} />
    </main>
  );
}
