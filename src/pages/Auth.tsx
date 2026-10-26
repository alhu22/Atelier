import { useState } from "react";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/Button";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { useAuth } from "@/hooks/useAuth";

export function Auth() {
  const account = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      if (account.user) await account.signOut();
      else await account.signIn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <section className="w-full max-w-md space-y-6 rounded-xl border border-border bg-surface p-8 shadow-sm">
        <Brand />
        <div>
          <h1 className="font-display text-2xl font-semibold">Welcome to Atelier</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in with Google to open your workspace. Administrators are taken to the admin dashboard.
          </p>
        </div>
        {!account.configured && (
          <StatusMessage message="Firebase sign-in is not configured. Configure the Firebase public client settings to enable Google sign-in." tone="info" />
        )}
        {(error || account.error) && (
          <StatusMessage message={error || account.error || ""} tone="error" />
        )}
        <Button
          className="w-full"
          disabled={busy || !account.configured}
          onClick={() => void signIn()}
          variant="primary"
        >
          {busy ? "Please wait…" : account.user ? "Sign out and try again" : "Sign in with Google"}
        </Button>
      </section>
    </main>
  );
}
