import RigEditor from "@/components/AsciiGallop/RigEditor";

export default function RigPage() {
  return (
    <main className="min-h-full bg-white px-6 py-14 sm:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9A4C19]">
            experiment / ascii / rig
          </p>
          <h1 className="text-3xl text-[#2A1608]">Pull the horse into shape</h1>
          <p className="max-w-[62ch] text-sm leading-relaxed text-[#2A1608]/70">
            Every control point of the animal, live. Drag a handle to move it,
            scroll over one to fatten or thin that part, and press play to check
            the change across the whole stride. When it looks right, hit copy
            rig and hand the JSON back so it can be baked in as the default.
          </p>
        </header>
        <RigEditor />
      </div>
    </main>
  );
}
