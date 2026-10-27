import { Outlet } from "react-router-dom";
import { Navbar } from "@/components/layout/Navbar";

export function SiteLayout() {
  return (
    <>
      <Navbar />
      <main id="main-content"><Outlet /></main>
    </>
  );
}
