import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <section className="px-6 py-24 text-center" aria-labelledby="not-found-title">
      <h1 id="not-found-title" className="font-display text-5xl">Page not found</h1>
      <p className="my-6 text-muted-foreground">This page does not exist.</p>
      <Link className="underline underline-offset-4" to="/">Back to home</Link>
    </section>
  );
}
