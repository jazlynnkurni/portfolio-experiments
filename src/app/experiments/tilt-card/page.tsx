import { TiltCard } from "@/components/TiltCard/TiltCard";

export default function TiltCardPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[url('/tilt-card/stars-bg.png')] bg-cover bg-center p-6">
      <div className="w-[560px] max-w-[92vw]">
        <TiltCard maxTilt={14} glare={0.45} holo>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tilt-card/jazcard.svg"
            alt="Travel license"
            className="w-full object-cover object-top"
            style={{ height: "calc(100% + 5px)" }}
          />
        </TiltCard>
      </div>
    </main>
  );
}