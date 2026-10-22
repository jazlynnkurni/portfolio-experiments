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
      {/* the bottom tab bar on phones, the same file the site uses; it points Projects and About back to the site */}
      <script dangerouslySetInnerHTML={{ __html: `window.TABBAR_HOME=${JSON.stringify(process.env.NODE_ENV === "development" ? "http://localhost:5330" : "https://jazlynnwashere.com")};` }} />
      <script src="/tabbar.js?v=6" />
    </>
  );
}
