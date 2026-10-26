import { useEffect } from "react";
import {
  createMemoryRouter as makeRouter, MemoryRouter, Link,
  useLocation, useNavigate, useRouteError, isRouteErrorResponse,
} from "react-router-dom";
export * from "react-router-dom";

function bridgeLinks(navigate, location) {
  const handleClick = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const href = anchor.getAttribute("href");
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return;
    const url = new URL(href, "https://atelier-preview.invalid" + location().pathname);
    event.preventDefault();
    let target;
    try {
      target = url.hash && url.pathname === location().pathname && document.getElementById(decodeURIComponent(url.hash.slice(1)));
    } catch {
      target = null;
    }
    if (target) {
      target.scrollIntoView();
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    } else {
      void navigate(url.pathname + url.search + url.hash);
    }
  };
  document.addEventListener("click", handleClick);
  return () => document.removeEventListener("click", handleClick);
}

function PreviewFailure({ missing = false }) {
  const error = useRouteError();
  const notFound = missing || (isRouteErrorResponse(error) && error.status === 404);
  return (
    <section role="alert" className="section-shell" style={{ padding: "4rem 1.5rem", background: "hsl(var(--background, 42 45% 94%))", color: "hsl(var(--foreground, 140 10% 18%))" }}>
      <h1>{notFound ? "Sidan hittades inte" : "Sidan kunde inte visas"}</h1>
      <p>{notFound ? "Kontrollera sidans adress." : error instanceof Error ? error.message : "Ett fel uppstod på sidan."}</p>
      <Link className="site-button" to="/">Till startsidan</Link>
    </section>
  );
}

export function createBrowserRouter(routes, options) {
  const router = makeRouter([
    ...routes.map((route) => ({ ...route, errorElement: route.errorElement ?? <PreviewFailure /> })),
    { path: "*", element: <PreviewFailure missing /> },
  ], options);
  const cleanup = bridgeLinks(router.navigate, () => router.state.location);
  const dispose = router.dispose;
  router.dispose = () => { cleanup(); dispose(); };
  return router;
}

export const createMemoryRouter = createBrowserRouter;

function LinkBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => bridgeLinks(navigate, () => location), [navigate, location]);
  return null;
}

export function BrowserRouter({ children, ...props }) {
  return <MemoryRouter {...props}><LinkBridge />{children}</MemoryRouter>;
}
