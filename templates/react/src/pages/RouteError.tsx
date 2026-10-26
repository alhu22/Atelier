import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";

export function RouteError() {
  const error: unknown = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <section className="section-shell px-6 py-24 text-center" role="alert">
      <h1 className="font-display text-5xl">{missing ? "Sidan hittades inte" : "Sidan kunde inte visas"}</h1>
      <p className="my-6 text-muted-foreground">
        {missing ? "Kontrollera sidans adress." : "Något gick fel. Gå tillbaka till startsidan och försök igen."}
      </p>
      <Link className="site-button" to="/">Till startsidan</Link>
    </section>
  );
}
