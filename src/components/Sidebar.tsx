import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/Button";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  userLabel: string;
  avatar: string;
  photoURL: string;
  isAdmin: boolean;
  workspacePath: string;
  onNewProject: () => void;
  onProjects: () => void;
  onProfile: () => void;
  onSettings: () => void;
}

export function Sidebar({
  collapsed,
  onToggle,
  userLabel,
  avatar,
  photoURL,
  isAdmin,
  workspacePath,
  onNewProject,
  onProjects,
  onProfile,
  onSettings,
}: SidebarProps) {
  return (
    <aside aria-label="Workspace navigation" className={`profile-sidebar flex h-full min-h-0 w-full flex-col overflow-y-auto border-r border-border bg-surface ${collapsed ? "is-collapsed p-2" : "p-5"}`}>
      <div className={`mb-7 flex gap-2 ${collapsed ? "flex-col items-center" : "items-center justify-between"}`}>
        <a aria-label="Atelier" className="py-1 text-base" href={workspacePath} title="Atelier">
          {collapsed ? <span aria-hidden="true" className="brand-mark" /> : <Brand />}
        </a>
        <button
          aria-expanded={!collapsed}
          aria-label="Toggle sidebar"
          className="panel-toggle"
          onClick={onToggle}
          title="Toggle sidebar"
          type="button"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="16" height="14" rx="2" />
            <path d="M7 3v14" />
            <path d={collapsed ? "m11 7 3 3-3 3" : "m14 7-3 3 3 3"} />
          </svg>
        </button>
      </div>
      {!collapsed && <Button
        className="w-full justify-start"
        onClick={onNewProject}
        variant="primary"
      >
        <span className="text-lg leading-none">+</span>
        New project
      </Button>}
      {!collapsed && <p className="mb-2 mt-8 px-2 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
        Workspace
      </p>}
      <a aria-label="Builder" className="sidebar-link sidebar-link-active" href={workspacePath} aria-current="page" title="Builder">
        <span aria-hidden="true">▤</span> {!collapsed && "Builder"}
      </a>
      <button aria-label="Projects" className="sidebar-link" onClick={onProjects} title="Projects" type="button">
        <span aria-hidden="true">⬡</span> {!collapsed && "Projects"}
      </button>
      {isAdmin && (
        <a aria-label="Users" className="sidebar-link" href="/admin" title="Users">
          <span aria-hidden="true">♙</span> {!collapsed && "Users"}
        </a>
      )}
      {!collapsed && <p className="mb-2 mt-7 px-2 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
        Your space
      </p>}
      <button
        aria-label="Settings"
        className="sidebar-link"
        onClick={onSettings}
        title="Settings"
        type="button"
      >
        <span aria-hidden="true">⚙</span> {!collapsed && "Settings"}
      </button>
      <button
        aria-label="My profile"
        className={`mt-auto flex shrink-0 items-center rounded-lg text-left hover:bg-muted ${collapsed ? "justify-center py-3" : "gap-3 border border-border p-3"}`}
        onClick={onProfile}
        title={`My profile — ${userLabel}`}
        type="button"
      >
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
          {photoURL ? (
            <img alt="" className="size-full object-cover" src={photoURL} />
          ) : (
            avatar
          )}
        </span>
        {!collapsed && <span className="min-w-0">
          <strong className="block text-xs">My profile</strong>
          <span className="block truncate text-xs text-muted-foreground">
            {userLabel}
          </span>
        </span>}
      </button>
    </aside>
  );
}
