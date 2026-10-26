import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { AssistantPanel } from "@/components/AssistantPanel";
import { ProjectHeader } from "@/components/ProjectHeader";
import { PreviewPanel } from "@/components/PreviewPanel";
import { Sidebar } from "@/components/Sidebar";
import { StudioDialogs } from "@/components/StudioDialogs";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { Button } from "@/components/ui/Button";
import { firestore } from "@/integrations/firebase/client";
import { logProjectActivity } from "@/integrations/firebase/projects";
import { useAuth } from "@/hooks/useAuth";
import { useGitHub, useProjectDownload } from "@/hooks/useGitHub";
import { useModelStatus } from "@/hooks/useModelStatus";
import { useStudio } from "@/hooks/useStudio";

type DialogName = "projects" | "rename" | "file" | "profile" | "github";

export function Index() {
  const account = useAuth();
  const studio = useStudio(account.user, account.loading);
  const github = useGitHub(account.user);
  const downloadProject = useProjectDownload();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [codeRequest, setCodeRequest] = useState<{ path: string }>();
  const modelStatus = useModelStatus();
  const isAdmin = account.role === "admin";
  const [toast, setToast] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredCollapse("atelier-sidebar-collapsed");
  const [chatCollapsed, setChatCollapsed] = useStoredCollapse("atelier-chat-collapsed");
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia("(max-width: 1279px)").matches);
  const [drawer, setDrawer] = useState<"sidebar" | "chat" | null>(null);
  const sidebarRef = useRef<HTMLDialogElement>(null);
  const chatRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    let previous = media.matches;
    const update = () => {
      setCompactLayout(media.matches);
      if (media.matches !== previous) setDrawer(null);
      previous = media.matches;
    };
    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    for (const [panel, name] of [[sidebarRef.current, "sidebar"], [chatRef.current, "chat"]] as const) {
      if (!panel) continue;
      if (!compactLayout) {
        if (panel.matches(":modal")) panel.close();
        panel.setAttribute("open", "");
      } else if (drawer === name) {
        if (panel.open && !panel.matches(":modal")) panel.close();
        if (!panel.open) panel.showModal();
      } else {
        panel.close();
      }
    }
  }, [compactLayout, drawer]);

  useEffect(() => {
    if (!compactLayout || !drawer) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [compactLayout, drawer]);

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (compactLayout && event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) setDrawer(null);
    }
  }

  const showError = useCallback((message: string) => {
    setToastIsError(true);
    setToast(message);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const githubResult = new URLSearchParams(window.location.search).get("github");
    if (githubResult === "connected") {
      setToastIsError(false);
      setToast("GitHub connected.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (githubResult === "error") {
      showError("GitHub connection failed. Check the server configuration and try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [showError]);

  async function downloadZip() {
    try {
      await downloadProject(studio.project.name, studio.project.files);
      if (account.user && firestore) {
        await logProjectActivity(firestore, account.user, "project_exported");
      }
      setToastIsError(false);
      setToast("Project ZIP downloaded.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not create the ZIP archive.");
    }
  }

  async function deleteProject(project: (typeof studio.projects)[number]) {
    if (!window.confirm(`Delete “${project.name}” permanently?`)) return;
    try {
      await studio.deleteProject(project.id);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not delete this project.");
    }
  }

  return (
    <div
      className="builder-layout min-h-dvh bg-background text-foreground"
      data-sidebar-collapsed={sidebarCollapsed}
      data-chat-collapsed={chatCollapsed}
    >
      <div className="builder-drawer-triggers">
        <button
          aria-controls="workspace-sidebar"
          aria-expanded={drawer === "sidebar"}
          aria-label="Toggle sidebar"
          className="rounded border border-border px-3 py-2 text-xs hover:bg-muted"
          onClick={() => setDrawer("sidebar")}
          type="button"
        >Navigation</button>
        <button
          aria-controls="workspace-chat"
          aria-expanded={drawer === "chat"}
          aria-label="Toggle chat"
          className="rounded border border-border px-3 py-2 text-xs hover:bg-muted"
          onClick={() => setDrawer("chat")}
          type="button"
        >Chat</button>
      </div>
      <dialog
        aria-label="Workspace navigation"
        className="builder-panel builder-sidebar"
        id="workspace-sidebar"
        onCancel={(event) => { event.preventDefault(); setDrawer(null); }}
        onClick={closeOnBackdrop}
        ref={sidebarRef}
        role={compactLayout ? "dialog" : "presentation"}
      >
      <Sidebar
        collapsed={!compactLayout && sidebarCollapsed}
        onToggle={() => compactLayout ? setDrawer(null) : setSidebarCollapsed((current) => !current)}
        avatar={account.photoURL ? "" : (account.displayName || account.user?.email || "A").slice(0, 1).toUpperCase()}
        isAdmin={isAdmin}
        onNewProject={() => {
          studio.createProject();
          setDrawer(null);
        }}
        onProfile={() => { setDrawer(null); setDialog("profile"); }}
        onProjects={() => { setDrawer(null); setDialog("projects"); }}
        onSettings={() => {
          setDrawer(null);
          setToastIsError(false);
          setToast("Model settings are managed in .env.");
        }}
        photoURL={account.photoURL}
        userLabel={account.user?.email ?? "Sign in with Google"}
        workspacePath={account.user ? `/${encodeURIComponent(account.user.uid)}` : "/main"}
      />
      </dialog>
      <dialog
        aria-label="Build with Atelier"
        className="builder-panel builder-chat"
        id="workspace-chat"
        onCancel={(event) => { event.preventDefault(); setDrawer(null); }}
        onClick={closeOnBackdrop}
        ref={chatRef}
        role={compactLayout ? "dialog" : "presentation"}
      >
        <AssistantPanel
          key={`${account.user?.uid ?? "local"}:${studio.project.id}`}
          storageKey={`atelier-chat-v1:${account.user?.uid ?? "local"}:${studio.project.id}`}
          blocked={studio.migrating || account.loading || studio.loadingCloud}
          collapsed={!compactLayout && chatCollapsed}
          visible={!compactLayout || drawer === "chat"}
          files={studio.project.files}
          modelStatus={modelStatus}
          onGenerate={studio.generate}
          onOpenFile={(path) => {
            studio.setActiveFile(path);
            setCodeRequest({ path });
            if (compactLayout) setDrawer(null);
          }}
          onToggle={() => compactLayout ? setDrawer(null) : setChatCollapsed((current) => !current)}
        />
      </dialog>
      <main className="builder-project flex min-w-0 flex-col">
        <ProjectHeader
          canRedo={studio.canRedo}
          canUndo={studio.canUndo}
          onDownload={() => void downloadZip()}
          onGitHub={() => setDialog("github")}
          onRedo={studio.redo}
          onRename={() => setDialog("rename")}
          onSignIn={() => {
            if (account.user) {
              void account.signOut().catch((error: unknown) =>
                showError(error instanceof Error ? error.message : "Could not sign out."),
              );
            } else {
              void account.signIn().catch((error: unknown) =>
                showError(error instanceof Error ? error.message : "Could not sign in."),
              );
            }
          }}
          onUndo={studio.undo}
          project={studio.project}
          saved={!studio.loadingCloud}
          signedIn={Boolean(account.user)}
        />
        <div className="flex min-w-0 flex-1 flex-col p-3 md:p-5">
          <div className="flex min-w-0 flex-1 flex-col">
            {studio.migrating ? (
              <div className="mb-3">
                <StatusMessage message="Creating a React copy of this website. Your original stays saved and unchanged." tone="info" />
              </div>
            ) : studio.legacyProject && studio.error ? (
              <div className="mb-3">
                <Button onClick={studio.retryMigration}>Retry React migration</Button>
              </div>
            ) : null}
            <PreviewPanel
              codeRequest={codeRequest}
              activeFile={studio.activeFile}
              content={studio.activeContent}
              entrypoint={studio.project.entrypoint}
              files={studio.project.files}
              onAddFile={() => setDialog("file")}
              onApply={() =>
                studio.updateFiles(
                  studio.project.files,
                  studio.activeFile,
                  studio.project.entrypoint,
                )
              }
              onContentChange={studio.setActiveContent}
              onSelectFile={studio.setActiveFile}
            />
            {(studio.error || studio.syncError || account.error || toast) && (
              <div className="mt-3 space-y-2">
                {studio.error && (
                  <StatusMessage
                    message={studio.error}
                    onDismiss={() => studio.setError(null)}
                    tone="error"
                  />
                )}
                {studio.syncError && (
                  <div className="space-y-2">
                    <StatusMessage message={studio.syncError} onDismiss={() => studio.setSyncError(null)} tone="error" />
                    <Button aria-label="Retry cloud sync" disabled={studio.loadingCloud} onClick={studio.retrySync} size="sm">Retry cloud sync</Button>
                  </div>
                )}
                {account.error && (
                  <StatusMessage message={account.error} tone="error" />
                )}
                {toast && (
                  <StatusMessage
                    message={toast}
                    onDismiss={() => setToast(null)}
                    tone={toastIsError ? "error" : "success"}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <StudioDialogs
        currentProjectId={studio.project.id}
        currentProjectName={studio.project.name}
        fileOpen={dialog === "file"}
        githubConnected={github.connected}
        githubConfigured={github.configured}
        githubError={github.error}
        githubLoading={github.loading}
        githubLogin={github.login}
        githubOpen={dialog === "github"}
        githubRepositories={github.repositories}
        onAddFile={studio.addFile}
        onClose={() => setDialog(null)}
        onDeleteProject={(project) => void deleteProject(project)}
        onError={showError}
        onGitHubConnect={github.connect}
        onGitHubDisconnect={github.disconnect}
        onGitHubExport={(repository, branch) =>
          github.publish(repository, branch, studio.project)
        }
        onNotice={(message) => {
          setToastIsError(false);
          setToast(message);
        }}
        onGitHubRefresh={github.loadRepositories}
        onProfileSave={account.updateProfile}
        onRename={studio.renameProject}
        onSelectProject={(project) => {
          studio.openProject(project);
        }}
        photoURL={account.photoURL}
        profileOpen={dialog === "profile"}
        projects={studio.projects}
        projectsOpen={dialog === "projects"}
        renameOpen={dialog === "rename"}
        userName={account.user ? account.displayName : ""}
      />
    </div>
  );
}

function useStoredCollapse(key: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(collapsed));
    } catch {
      // Layout controls still work when browser storage is unavailable.
    }
  }, [key, collapsed]);
  return [collapsed, setCollapsed] as const;
}
