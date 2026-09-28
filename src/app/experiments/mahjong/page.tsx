import MahjongTiles from "@/components/Mahjong/MahjongTiles";

/* The footer tiles from the live site, given a plate of their own: a row of
   mahjong tiles on a floor, white ground like every other plate. */
export default function MahjongPage() {
  return (
    <main className="flex min-h-dvh items-end justify-center bg-white px-6 pb-10">
      <div className="w-full max-w-[1100px]">
        <MahjongTiles height={260} />
      </div>
    </main>
  );
}
