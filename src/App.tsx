import { Dashboard } from "@/pages/Dashboard";
import { Index } from "@/pages/Index";

export function App() {
  return window.location.pathname.replace(/\/+$/, "") === "/users" ||
    window.location.pathname.replace(/\/+$/, "") === "/users.html" ? (
    <Dashboard />
  ) : (
    <Index />
  );
}
