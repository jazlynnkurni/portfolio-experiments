import ButterSideUp from "@/components/ButterSideUp/ButterSideUp";

export const metadata = {
  title: "Butter side up / portfolio experiments",
};

export default function ButterSideUpPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-white px-6 py-16 sm:px-10">
      <div className="w-full max-w-4xl">
        <ButterSideUp />
      </div>
    </main>
  );
}
