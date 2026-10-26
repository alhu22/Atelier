import { Link, Outlet } from "react-router-dom";
import { Navbar } from "@/components/layout/Navbar";

export function SiteLayout() {
  return (
    <>
      <a className="sr-only focus:not-sr-only focus:block focus:p-4" href="#main-content">
        Hoppa till innehållet
      </a>
      <Navbar />
      <main id="main-content"><Outlet /></main>
      <footer className="site-footer section-shell">
        <div className="wordmark">KEBABHOUSE<span>KARLSKRONA</span></div>
        <p>Pizza, kebab &amp; massor av kärlek.</p>
        <Link className="text-link" to="/#hem" onClick={(event) => {
          const hero = document.getElementById("hem");
          if (hero) {
            event.preventDefault();
            hero.scrollIntoView();
            hero.focus({ preventScroll: true });
          }
        }}>Till toppen ↑</Link>
      </footer>
    </>
  );
}
