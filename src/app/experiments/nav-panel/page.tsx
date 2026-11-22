import Link from "next/link";
import { DIRECTIONS } from "@/components/NavPanel/directions";
import d from "@/components/NavPanel/demo.module.css";

export const metadata = {
  title: "Nav panel / portfolio experiments",
};

/** plain index of the five navigation directions */
export default function NavPanelIndex() {
  return (
    <main className={d.page}>
      <p className={d.eyebrow}>Five directions</p>
      <h1 className={d.title}>Navigation panel</h1>
      <ol className={d.list}>
        {DIRECTIONS.map((x) => (
          <li key={x.n}>
            <Link href={`/experiments/nav-panel/${x.n}`} className={d.item}>
              <span className={d.num}>{String(x.n).padStart(2, "0")}</span>
              <span className={d.name}>
                {x.name}
                <span className={d.idea}>{x.idea}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
