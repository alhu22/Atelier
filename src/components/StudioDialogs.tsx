import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogHeading } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { StatusMessage } from "@/components/ui/StatusMessage";
import type { GitHubRepository, StudioProject } from "@/types";

interface StudioDialogsProps {
  projectsOpen: boolean;
  renameOpen: boolean;
  fileOpen: boolean;
  profileOpen: boolean;
  githubOpen: boolean;
  projects: StudioProject[];
  currentProjectId: string;
  currentProjectName: string;
  userName: string;
  photoURL: string;
  githubConfigured: boolean;
  githubConnected: boolean;
  githubLogin: string | null;
  githubRepositories: GitHubRepository[];
  githubLoading: boolean;
  githubError: string | null;
  onClose: () => void;
  onRename: (name: string) => void;
  onAddFile: (path: string) => void;
  onSelectProject: (project: StudioProject) => void;
  onDeleteProject: (project: StudioProject) => void;
  onProfileSave: (name: string, photo: string) => Promise<void>;
  onGitHubConnect: () => void;
  onGitHubDisconnect: () => Promise<void>;
  onGitHubRefresh: () => Promise<GitHubRepository[]>;
  onGitHubExport: (repository: string, branch: string) => Promise<string>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export function StudioDialogs(props: StudioDialogsProps) {
  const {
    projectsOpen,
    renameOpen,
    fileOpen,
    profileOpen,
    githubOpen,
    projects,
    currentProjectId,
    currentProjectName,
    userName,
    photoURL,
    githubConfigured,
    githubConnected,
    githubLogin,
    githubRepositories,
    githubLoading,
    githubError,
    onClose,
    onRename,
    onAddFile,
    onSelectProject,
    onDeleteProject,
    onProfileSave,
    onGitHubConnect,
    onGitHubDisconnect,
    onGitHubRefresh,
    onGitHubExport,
    onNotice,
    onError,
  } = props;
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [displayName, setDisplayName] = useState(userName);
  const [photo, setPhoto] = useState(photoURL);
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDisplayName(userName);
    setPhoto(photoURL);
  }, [userName, photoURL]);

  useEffect(() => {
    setName(currentProjectName);
  }, [currentProjectName, renameOpen]);

  useEffect(() => {
    if (!githubOpen || !githubConnected || githubRepositories.length > 0) return;
    void onGitHubRefresh().catch(() => undefined);
  }, [githubConnected, githubOpen, githubRepositories.length, onGitHubRefresh]);

  async function handleProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onProfileSave(displayName.trim(), photo.trim());
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save your profile.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository) return;
    setSubmitting(true);
    try {
      const message = await onGitHubExport(repository, branch);
      onNotice(message);
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not export this project.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={projectsOpen} onClose={onClose} title="My workspace projects">
        <DialogHeading onClose={onClose} title="My workspace projects" />
        <div className="max-h-[65vh] space-y-2 overflow-y-auto p-4">
          {projects.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Your projects will appear here.
            </p>
          ) : (
            projects.map((project) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                key={project.id}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    onSelectProject(project);
                    onClose();
                  }}
                  type="button"
                >
                  <strong className="block truncate text-sm">{project.name}</strong>
                  <span className="text-xs text-muted-foreground">
                    {Object.keys(project.files).length} files · Updated{" "}
                    {project.updatedAt.toLocaleDateString()}
                  </span>
                </button>
                <Button
                  disabled={project.id === currentProjectId}
                  onClick={() => onDeleteProject(project)}
                  size="sm"
                  variant="danger"
                >
                  Delete
                </Button>
              </div>
            ))
          )}
        </div>
      </Dialog>

      <Dialog open={renameOpen} onClose={onClose} title="Rename project">
        <DialogHeading onClose={onClose} title="Rename project" />
        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onRename(name);
              onClose();
            } catch (error) {
              onError(error instanceof Error ? error.message : "Could not rename project.");
            }
          }}
        >
          <label className="block space-y-2 text-sm" htmlFor="project-name">
            Project name
            <Input
              autoComplete="off"
              id="project-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">Save name</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={fileOpen} onClose={onClose} title="Add project file">
        <DialogHeading onClose={onClose} title="Add project file" />
        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onAddFile(path);
              setPath("");
              onClose();
            } catch (error) {
              onError(error instanceof Error ? error.message : "Could not add that file.");
            }
          }}
        >
          <label className="block space-y-2 text-sm" htmlFor="new-file-path">
            Relative file path
            <Input
              autoComplete="off"
              id="new-file-path"
              onChange={(event) => setPath(event.target.value)}
              placeholder="about.html or assets/styles.css"
              required
              value={path}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">Create file</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={profileOpen} onClose={onClose} title="My profile">
        <DialogHeading onClose={onClose} title="My profile" />
        <form className="space-y-4 p-5" onSubmit={handleProfile}>
          {!userName && (
            <p className="text-sm text-muted-foreground">
              Sign in with Google to sync your profile and projects.
            </p>
          )}
          <label className="block space-y-2 text-sm" htmlFor="profile-name">
            Display name
            <Input
              autoComplete="name"
              id="profile-name"
              maxLength={120}
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
          </label>
          <label className="block space-y-2 text-sm" htmlFor="profile-photo">
            Profile photo URL
            <Input
              id="profile-photo"
              onChange={(event) => setPhoto(event.target.value)}
              type="url"
              value={photo}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button disabled={submitting || !userName} type="submit" variant="primary">
              Save profile
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        className="max-w-lg"
        open={githubOpen}
        onClose={onClose}
        title="GitHub export"
      >
        <DialogHeading onClose={onClose} title="GitHub export" />
        <div className="space-y-4 p-5">
          {githubError && <StatusMessage message={githubError} tone="error" />}
          {!githubConfigured ? (
            <p className="text-sm text-muted-foreground">
              Add the GitHub OAuth client settings to the server environment to enable export.
            </p>
          ) : !githubConnected ? (
            <>
              <p className="text-sm text-muted-foreground">
                Connect GitHub to publish this project to a repository you can access.
              </p>
              <Button
                onClick={() => {
                  if (!githubConfigured) {
                    onError("GitHub OAuth is not configured on the server.");
                    return;
                  }
                  onGitHubConnect();
                }}
                variant="primary"
              >
                Connect with GitHub
              </Button>
            </>
          ) : (
            <form className="space-y-4" onSubmit={handleExport}>
              <p className="text-sm text-muted-foreground">
                Connected as <strong>{githubLogin}</strong>.
              </p>
              <label className="block space-y-2 text-sm" htmlFor="github-repository">
                Repository
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  id="github-repository"
                  onChange={(event) => setRepository(event.target.value)}
                  required
                  value={repository}
                >
                  <option value="">Choose a repository</option>
                  {githubRepositories.map((item) => (
                    <option key={item.full_name} value={item.full_name}>
                      {item.full_name}{item.private ? " · private" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm" htmlFor="github-branch">
                Branch (optional)
                <Input
                  id="github-branch"
                  onChange={(event) => setBranch(event.target.value)}
                  placeholder="default branch"
                  value={branch}
                />
              </label>
              {githubLoading && (
                <p className="text-xs text-muted-foreground" role="status">Loading repositories…</p>
              )}
              <div className="flex justify-between">
                <Button
                  onClick={() => void onGitHubDisconnect().catch((error: unknown) =>
                    onError(error instanceof Error ? error.message : "Could not disconnect GitHub."),
                  )}
                  size="sm"
                >
                  Disconnect
                </Button>
                <Button disabled={submitting || !repository} type="submit" variant="primary">
                  Export project
                </Button>
              </div>
            </form>
          )}
        </div>
      </Dialog>
    </>
  );
}
