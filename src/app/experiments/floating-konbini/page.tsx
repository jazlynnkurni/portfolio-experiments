import FloatingKonbini from "@/components/FloatingKonbini/FloatingKonbini";

export default function FloatingKonbiniPage() {
  return (
    <main className="min-h-full bg-white px-6 py-14 sm:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9A4C19]">
            experiment / three
          </p>
          <h1 className="text-3xl text-[#2A1608]">
            A convenience store adrift, and the light it leaves on the water
          </h1>
          <p className="max-w-[62ch] text-sm leading-relaxed text-[#2A1608]/70">
            One lit shopfront on a raft, alone on open water at night. The
            surface is a real planar reflection with a drifting distortion map,
            and the sign&apos;s spill is a second additive pass that breaks into
            moving streaks the further it travels from the store.
          </p>
        </header>
        <FloatingKonbini />
      </div>
    </main>
  );
}
