import ClothForm from "@/components/ClothForm/ClothForm";

export const metadata = {
  title: "Cloth form / portfolio experiments",
};

export default function ClothFormPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6">
      <ClothForm
        variant="full"
        form="staircase"
        threads={72}
        give={0.5}
        wind={0.6}
        fallTime={6}
        glow={0.7}
        glass={0.65}
      />
    </main>
  );
}
