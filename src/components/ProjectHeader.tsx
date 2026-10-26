import { Button } from "@/components/ui/Button";
import { useProjectName } from "@/hooks/useStudio";
import type { StudioProject } from "@/types";

interface ProjectHeaderProps {
  project: StudioProject;
  saved: boolean;
  canUndo: boolean;
  canRedo: boolean;
  signedIn: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRename: () => void;
  onSignIn: () => void;
  onGitHub: () => void;
  onDownload: () => void;
}

export function ProjectHeader({
  project,
  saved,
  canUndo,
  canRedo,
  signedIn,
  onUndo,
  onRedo,
  onRename,
  onSignIn,
  onGitHub,
  onDownload,
}: ProjectHeaderProps) {
  const name = useProjectName(project);
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 md:px-7">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="text-muted-foreground">Projects</span>
        <span className="text-muted-foreground">/</span>
        <button
          className="max-w-52 truncate font-semibold hover:text-accent"
          onClick={onRename}
          title="Rename project"
          type="button"
        >
          {name} <span className="ml-1 text-xs text-muted-foreground">✎</span>
        </button>
        <span className="ml-2 hidden items-center gap-2 text-xs text-muted-foreground sm:inline-flex">
          <i className={`size-1.5 rounded-full ${saved ? "bg-emerald-500" : "bg-amber-500"}`} />
          {saved ? "Saved" : "Saving…"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button aria-label="Undo" disabled={!canUndo} onClick={onUndo} size="sm">
          ↶
        </Button>
        <Button aria-label="Redo" disabled={!canRedo} onClick={onRedo} size="sm">
          ↷
        </Button>
        <span className="mx-1 hidden h-6 border-l border-border sm:block" />
        <Button onClick={onSignIn} size="sm">
          {signedIn ? "Sign out" : "Sign in with Google"}
        </Button>
        <Button onClick={onGitHub} size="sm">
          GitHub
        </Button>
        <Button onClick={onDownload} size="sm" variant="primary">
          ↓ ZIP
        </Button>
      </div>
    </header>
  );
}
