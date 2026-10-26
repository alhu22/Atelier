import { useRef, useState } from "react";
import { Link } from "react-router-dom";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  return (
    <header className="site-header section-shell" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        setOpen(false);
        toggle.current?.focus();
      }
    }}>
      <Link className="wordmark" onClick={() => setOpen(false)} to="/">
        KEBABHOUSE<span>KARLSKRONA</span>
      </Link>
      <button
        aria-controls="site-navigation"
        aria-expanded={open}
        aria-label={open ? "Stäng menyn" : "Öppna menyn"}
        className="menu-toggle"
        onClick={() => setOpen((current) => !current)}
        ref={toggle}
        type="button"
      >
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={open ? "m6 6 12 12M6 18 18 6" : "M3 6h18M3 12h18M3 18h18"} />
        </svg>
      </button>
      <nav aria-label="Huvudnavigation" className={`site-nav ${open ? "is-open" : ""}`} id="site-navigation">
        {[["hem", "Hem"], ["om-oss", "Om oss"], ["mer", "Mer"], ["bestall", "Beställ online"]].map(([id, label]) => (
          <Link className={id === "bestall" ? "site-button" : undefined} key={id} to={`/#${id}`} onClick={(event) => {
            setOpen(false);
            const section = document.getElementById(id);
            if (section) {
              event.preventDefault();
              section.scrollIntoView();
              section.focus({ preventScroll: true });
            }
          }}>{label}</Link>
        ))}
      </nav>
    </header>
  );
}
