import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";

export function RouteError() {
  const error: unknown = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <section className="section-shell px-6 py-24 text-center" role="alert">
      <h1 className="font-display text-5xl">{missing ? "Page not found" : "Unable to display this page"}</h1>
      <p className="my-6 text-muted-foreground">
        {missing ? "Check the page address." : "Something went wrong. Return home and try again."}
      </p>
      <Link className="site-button" to="/">Back to home</Link>
    </section>
  );
}
