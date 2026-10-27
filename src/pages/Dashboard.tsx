import { useState } from "react";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useAuth } from "@/hooks/useAuth";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusMessage } from "@/components/ui/StatusMessage";
import type { ActivityEvent, AdminProject, UserProfile } from "@/types";

export function Dashboard() {
  const auth = useAuth();
  const admin = useAdminDashboard(auth.user);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  async function handleAccount() {
    setAccountBusy(true);
    setAccountError(null);
    try {
      if (auth.user) await auth.signOut();
      else await auth.signIn();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not update your sign-in.");
    } finally {
      setAccountBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex min-h-16 items-center justify-between border-b border-border bg-surface px-5 md:px-8">
        <a href="/admin" className="text-lg"><Brand compact /></a>
        <div className="flex items-center gap-4">
          <span className="hidden max-w-60 truncate text-xs text-muted-foreground sm:block">
            {auth.displayName || auth.user?.email || "Administrator"}
          </span>
          {auth.user && (
            <a className="text-sm font-medium hover:underline" href={`/${encodeURIComponent(auth.user.uid)}`}>
              My projects
            </a>
          )}
          <Button
            disabled={auth.loading || accountBusy || !auth.configured}
            onClick={() => void handleAccount()}
          >
            {auth.loading || accountBusy ? "Please wait…" : auth.user ? "Sign out" : "Sign in with Google"}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
              Administration
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold">Users &amp; activity</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Account details, saved project metadata, and recent usage. Project contents are not shown.
            </p>
          </div>
          <Button disabled={auth.loading || !auth.user || admin.loading || Boolean(admin.deletingProject)} onClick={() => void admin.refresh()} variant="primary">
            {admin.loading ? "Refreshing…" : "Refresh data"}
          </Button>
        </div>

        {!auth.configured && (
          <div className="mt-5">
            <StatusMessage message="Firebase sign-in is not configured. Configure the Firebase public client settings to access administration." tone="info" />
          </div>
        )}
        {(accountError || auth.error) && (
          <div className="mt-5">
            <StatusMessage message={accountError || auth.error || ""} tone="error" />
          </div>
        )}

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Known users" value={admin.profiles.length} />
          <SummaryCard label="Saved projects" value={admin.projects.length} />
          <SummaryCard label="Activity events" value={admin.activity.length} />
        </div>

        {admin.error && (
          <div className="mt-5">
            <StatusMessage message={admin.error} tone="error" />
          </div>
        )}
        {admin.limited && (
          <div className="mt-4">
            <StatusMessage
              message="A result limit was reached. This dashboard displays only the most recent capped records."
              tone="info"
            />
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(18rem,.8fr)_minmax(0,1.5fr)]">
          <section className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-4">
              <h2 className="font-display font-semibold">Accounts</h2>
              <span className="rounded-full bg-muted px-2 py-1 text-xs">
                {admin.filteredProfiles.length}
              </span>
            </div>
            <div className="p-3">
              <Input
                aria-label="Search users"
                onChange={(event) => admin.setSearch(event.target.value)}
                placeholder="Search name, email, or UID"
                type="search"
                value={admin.search}
              />
            </div>
            <div className="max-h-[34rem] space-y-1 overflow-y-auto px-2 pb-3">
              {admin.filteredProfiles.map((profile) => (
                <button
                  aria-pressed={admin.selectedUid === profile.uid}
                  className={`w-full rounded-lg p-3 text-left ${admin.selectedUid === profile.uid ? "bg-muted" : "hover:bg-muted/60"}`}
                  key={profile.uid}
                  onClick={() => admin.setSelectedUid(profile.uid)}
                  type="button"
                >
                  <span className="block truncate text-sm font-semibold">
                    {profile.displayName || "Unnamed user"}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {profile.email || profile.uid}
                  </span>
                </button>
              ))}
              {!admin.loading && admin.filteredProfiles.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No matching users.
                </p>
              )}
            </div>
          </section>
          <section className="min-h-[26rem] rounded-lg border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-4">
              <h2 className="font-display font-semibold">Account details</h2>
              <span className="max-w-[50%] truncate text-xs text-muted-foreground">
                {admin.selectedProfile?.email ?? "No user selected"}
              </span>
            </div>
            {admin.selectedProfile ? (
              <AccountDetails
                activity={admin.selectedActivity}
                profile={admin.selectedProfile}
                projects={admin.selectedProjects}
                deletingProject={admin.deletingProject}
                deleteDisabled={admin.loading || Boolean(admin.deletingProject)}
                onDeleteProject={(project) => void admin.deleteProject(project)}
              />
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                Select an account to view its information, saved projects, and recent activity.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-lg border border-border bg-surface p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
    </article>
  );
}

function AccountDetails({
  profile,
  projects,
  activity,
  deletingProject,
  deleteDisabled,
  onDeleteProject,
}: {
  profile: UserProfile;
  projects: AdminProject[];
  activity: ActivityEvent[];
  deletingProject: AdminProject | null;
  deleteDisabled: boolean;
  onDeleteProject: (project: AdminProject) => void;
}) {
  return (
    <div className="space-y-6 p-4 md:p-5">
      <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Detail label="Display name" value={profile.displayName || "—"} />
        <Detail label="Email" value={profile.email || "—"} />
        <Detail label="UID" value={profile.uid} />
        <Detail label="First seen" value={formatDate(profile.createdAt)} />
        <Detail label="Last seen" value={formatDate(profile.lastSeenAt)} />
      </dl>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Saved projects</h3>
          <span className="text-xs text-muted-foreground">{projects.length}</span>
        </div>
        {projects.length ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {projects.map((project) => (
              <li className="flex items-center justify-between gap-3 p-3" key={project.id}>
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{project.name}</strong>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {project.entrypoint}
                  </span>
                </span>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <time className="text-xs text-muted-foreground">
                    {formatDate(project.updatedAt)}
                  </time>
                  <Button
                    aria-label={`Delete ${project.name}`}
                    disabled={deleteDisabled}
                    onClick={() => onDeleteProject(project)}
                    size="sm"
                    variant="danger"
                  >
                    {deletingProject?.owner === project.owner && deletingProject.id === project.id ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            No saved projects.
          </p>
        )}
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Recent activity</h3>
          <span className="text-xs text-muted-foreground">{activity.length}</span>
        </div>
        {activity.length ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {activity.map((event) => (
              <li className="flex items-center justify-between gap-3 p-3" key={event.id}>
                <span className="text-sm">{activityLabel(event.type)}</span>
                <time className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(event.occurredAt)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            No recent activity.
          </p>
        )}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm">{value}</dd>
    </div>
  );
}

function formatDate(value: UserProfile["createdAt"] | AdminProject["updatedAt"] | ActivityEvent["occurredAt"]): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : value.toDate();
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function activityLabel(type: string): string {
  const labels: Record<string, string> = {
    session_started: "Signed in",
    session_ended: "Signed out",
    project_created: "Created a project",
    project_opened: "Opened a project",
    generation_completed: "Generated a website",
    project_exported: "Exported a project",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}
