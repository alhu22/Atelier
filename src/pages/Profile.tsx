import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { useAuth } from "@/hooks/useAuth";
import { useGitHub } from "@/hooks/useGitHub";
import { prepareProfilePhoto } from "@/integrations/profilePhoto";

export function Profile() {
  const account = useAuth();
  const github = useGitHub(account.user);
  const [draft, setDraft] = useState<{ displayName: string; photoURL: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const values = draft ?? { displayName: account.displayName, photoURL: account.photoURL };
  const workspacePath = account.user ? `/${encodeURIComponent(account.user.uid)}` : "/main";

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreparingPhoto(true);
    setError(null);
    setNotice(null);
    try {
      const photoURL = await prepareProfilePhoto(file);
      setDraft((current) => ({ displayName: current?.displayName ?? account.displayName, photoURL }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not upload your photo.");
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await account.updateProfile(values.displayName.trim(), values.photoURL.trim());
      setDraft(null);
      setNotice("Profile saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await github.disconnect();
    } catch {
      // The GitHub hook displays the connection error.
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b border-border bg-surface px-5 md:px-8">
        <Link aria-label="Atelier" className="text-lg" to={workspacePath}><Brand compact /></Link>
        <nav aria-label="Profile navigation" className="flex gap-4 text-sm font-medium">
          <Link className="hover:underline" to={workspacePath}>Back to studio</Link>
          {account.role === "admin" && <Link className="hover:underline" to="/admin">Users</Link>}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <div className="flex items-center gap-4">
          <button aria-label="Upload profile photo" aria-describedby="photo-help"
            className="relative size-16 shrink-0 rounded-full bg-muted text-xl font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:opacity-50"
            disabled={saving || preparingPhoto} onClick={() => photoInput.current?.click()} title="Change profile photo" type="button">
            {values.photoURL ? <img alt="Profile photo" className="size-full rounded-full object-cover" src={values.photoURL} />
              : (account.displayName || account.user?.email || "A").slice(0, 1).toUpperCase()}
            <span aria-hidden="true" className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border border-border bg-surface text-sm">+</span>
          </button>
          <input accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Choose profile photo"
            className="sr-only" disabled={saving || preparingPhoto} onChange={(event) => void selectPhoto(event)}
            ref={photoInput} tabIndex={-1} type="file" />
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-semibold">My profile</h1>
            <p className="mt-1 break-words text-sm text-muted-foreground">{account.displayName || account.user?.email}</p>
            <p className="mt-2 text-xs text-muted-foreground" id="photo-help">Click your photo to upload from your device. JPEG, PNG, WebP or GIF, up to 5 MB. Save profile to apply.</p>
            {preparingPhoto && <p className="mt-1 text-xs" role="status">Preparing photo...</p>}
          </div>
        </div>

        <section aria-labelledby="personal-info-heading" className="space-y-5 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-display text-lg font-semibold" id="personal-info-heading">Personal information</h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="mt-1 break-all">{account.user?.email || "Not provided"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Account role</dt>
              <dd className="mt-1">{account.role === "admin" ? "Administrator" : "Builder"}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">Your email is managed by your Google sign-in account.</p>
          <form className="space-y-4 border-t border-border pt-5" onSubmit={saveProfile}>
            <fieldset className="space-y-4" disabled={saving || preparingPhoto}>
              <legend className="mb-4 text-sm font-semibold">Edit profile</legend>
              <label className="block space-y-2 text-sm" htmlFor="profile-name">
                <span>Display name</span>
                <Input autoComplete="name" id="profile-name" maxLength={120}
                  onChange={(event) => { setDraft({ ...values, displayName: event.target.value }); setNotice(null); }}
                  value={values.displayName} />
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={!draft} onClick={() => { setDraft(null); setError(null); setNotice(null); }}>Cancel</Button>
                <Button type="submit" variant="primary">{saving ? "Saving..." : "Save profile"}</Button>
              </div>
            </fieldset>
            {account.error && <StatusMessage message={account.error} tone="error" />}
            {error && <StatusMessage message={error} tone="error" />}
            {notice && <StatusMessage message={notice} tone="success" />}
          </form>
        </section>

        <section aria-labelledby="github-heading" className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-display text-lg font-semibold" id="github-heading">GitHub connection</h2>
          <p className="text-sm text-muted-foreground">Connect GitHub to export your projects to your repositories.</p>
          {github.error && <StatusMessage message={github.error} tone="error" />}
          {github.loading ? <p className="text-sm" role="status">Checking GitHub connection...</p>
            : github.connected ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                {github.login ? (
                  <a aria-label={`Connected GitHub profile: @${github.login}`} className="rounded-full"
                    href={`https://github.com/${encodeURIComponent(github.login)}`} rel="noreferrer" target="_blank">
                    <img alt={`GitHub profile photo for @${github.login}`} className="size-12 rounded-full object-cover"
                      src={`https://github.com/${encodeURIComponent(github.login)}.png?size=96`} />
                  </a>
                ) : <p className="text-sm">GitHub connected.</p>}
                <Button disabled={disconnecting} onClick={() => void disconnect()}>
                  {disconnecting ? "Disconnecting..." : "Disconnect GitHub"}
                </Button>
              </div>
            ) : github.error ? null : github.configured ? (
              <div className="space-y-3">
                <p className="text-sm">GitHub is not connected.</p>
                <Button onClick={github.connect} variant="primary">Connect GitHub</Button>
              </div>
            ) : (
              <StatusMessage message="GitHub connection is not configured. Add the GitHub OAuth client settings to the server environment to enable it." tone="info" />
            )}
          {github.error && <Button disabled={github.loading || disconnecting} onClick={() => void github.refresh()}>Retry connection check</Button>}
        </section>
      </main>
    </div>
  );
}
