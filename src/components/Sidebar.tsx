import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/Button";

interface SidebarProps {
  userLabel: string;
  avatar: string;
  photoURL: string;
  isAdmin: boolean;
  onNewProject: () => void;
  onProjects: () => void;
  onProfile: () => void;
  onSettings: () => void;
}

export function Sidebar({
  userLabel,
  avatar,
  photoURL,
  isAdmin,
  onNewProject,
  onProjects,
  onProfile,
  onSettings,
}: SidebarProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-surface p-4 md:h-dvh md:w-60 md:border-b-0 md:border-r md:p-5">
      <a className="mb-7 px-2 py-1 text-lg" href="/">
        <Brand />
      </a>
      <Button
        className="w-full justify-start"
        onClick={onNewProject}
        variant="primary"
      >
        <span className="text-lg leading-none">+</span>
        New project
      </Button>
      <p className="mb-2 mt-8 px-2 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
        Workspace
      </p>
      <a className="sidebar-link sidebar-link-active" href="/" aria-current="page">
        <span aria-hidden="true">▤</span> Builder
      </a>
      <button className="sidebar-link" onClick={onProjects} type="button">
        <span aria-hidden="true">⬡</span> Projects
      </button>
      {isAdmin && (
        <a className="sidebar-link" href="/users">
          <span aria-hidden="true">♙</span> Users
        </a>
      )}
      <p className="mb-2 mt-7 px-2 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
        Your space
      </p>
      <button
        className="sidebar-link"
        onClick={onSettings}
        type="button"
      >
        <span aria-hidden="true">⚙</span> Settings
      </button>
      <button
        className="mt-auto flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted"
        onClick={onProfile}
        type="button"
      >
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
          {photoURL ? (
            <img alt="" className="size-full object-cover" src={photoURL} />
          ) : (
            avatar
          )}
        </span>
        <span className="min-w-0">
          <strong className="block text-xs">My profile</strong>
          <span className="block truncate text-xs text-muted-foreground">
            {userLabel}
          </span>
        </span>
      </button>
    </aside>
  );
}
