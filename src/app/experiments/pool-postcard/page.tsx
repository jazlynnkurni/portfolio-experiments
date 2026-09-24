import PoolPostcard from "@/components/PoolPostcard/PoolPostcard";

export default function PoolPostcardPage() {
  return (
    <main
      className="flex min-h-screen items-center justify-center p-6"
      style={{
        background:
          "radial-gradient(120% 120% at 50% 0%, #eef6f4 0%, #d7e6e3 55%, #c4d8d4 100%)",
      }}
    >
      <PoolPostcard variant="full" depth={1.5} chop={1.0} tint={1.0} sun={0.9} />
    </main>
  );
}
