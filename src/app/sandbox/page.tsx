import Sandbox from "@/components/Sandbox/Sandbox";
import { THEME_INIT } from "@/components/Sandbox/Chrome";
import "./revamp.css";

export const metadata = {
  title: "Sandbox — Jazlynn Kurniandra",
};

export default function SandboxPage() {
  return (
    <>
      {/* the mode, before anything paints: the revamp does the same in its head */}
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      <Sandbox />
    </>
  );
}
