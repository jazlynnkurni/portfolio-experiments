import TrackRecord from "@/components/TrackRecord/TrackRecord";

export const metadata = {
  title: "Track record / portfolio experiments",
};

export default function TrackRecordPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-white px-6 py-16 sm:px-10">
      <div className="w-full max-w-4xl">
        <TrackRecord />
      </div>
    </main>
  );
}
