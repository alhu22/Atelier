import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AssistantPanel, type PreviewConversation } from "@/components/AssistantPanel";
import { ProjectHeader } from "@/components/ProjectHeader";
import { PreviewPanel, type CanvasMode, type DeviceSize } from "@/components/PreviewPanel";
import { Sidebar } from "@/components/Sidebar";
import { StudioDialogs } from "@/components/StudioDialogs";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { Button } from "@/components/ui/Button";
import { firestore } from "@/integrations/firebase/client";
import { logProjectActivity } from "@/integrations/firebase/projects";
import { getTemplateSource } from "@/integrations/firebase/templates";
import { useAuth } from "@/hooks/useAuth";
import { useGitHub, useProjectDownload } from "@/hooks/useGitHub";
import { useModelStatus } from "@/hooks/useModelStatus";
import { useStudio } from "@/hooks/useStudio";
import { startConversation } from "@/hooks/useConversation";
import { WelcomeView } from "@/components/WelcomeView";

type DialogName = "projects" | "rename" | "file" | "github";

export function Index({ welcome = false }: { welcome?: boolean }) {
  const account = useAuth();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const studio = useStudio(account.user, account.loading, { active: !welcome, projectId });
  const workspacePath = account.user ? `/${encodeURIComponent(account.user.uid)}` : "/main";
  const builderReady = studio.ready && (!projectId || projectId === studio.project.id);
  const selectedRoute = useRef<string | undefined>(undefined);
  const starting = useRef(false);
  const templateRequest = useRef(0);
  const currentUser = useRef(account.user?.uid);
  currentUser.current = account.user?.uid;
  const [copyingTemplate, setCopyingTemplate] = useState<string | null>(null);
  const github = useGitHub(account.user);
  const downloadProject = useProjectDownload();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [mode, setMode] = useState<CanvasMode>("preview");
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const [previewConversation, setPreviewConversation] = useState<PreviewConversation>();
  const conversationKey = `atelier-chat-v1:${account.user?.uid ?? "local"}:${studio.project.id}`;
  useEffect(() => {
    setMode("preview");
    setDevice("desktop");
  }, [conversationKey]);
  const modelStatus = useModelStatus();
  const isAdmin = account.role === "admin";
  const [toast, setToast] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
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
  }, [compactLayout, drawer, welcome, builderReady]);

  useEffect(() => {
    if (!studio.ready || welcome || !projectId) {
      selectedRoute.current = undefined;
      return;
    }
    if (selectedRoute.current !== projectId) {
      selectedRoute.current = projectId;
      if (studio.project.id === projectId) return;
      const requested = studio.projects.find((project) => project.id === projectId);
      if (requested) studio.openProject(requested);
      else navigate(workspacePath, { replace: true });
    } else if (studio.project.id !== projectId) {
      // Keep the URL aligned when migration or deletion selects a replacement.
      navigate(`${workspacePath}/projects/${encodeURIComponent(studio.project.id)}`, { replace: true });
    }
  }, [projectId, welcome, studio.ready, studio.project.id, studio.projects, studio.openProject, navigate, workspacePath]);

  useEffect(() => {
    starting.current = false;
    setCopyingTemplate(null);
    return () => { templateRequest.current += 1; };
  }, [welcome, projectId, account.user?.uid]);

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

  async function signIn() {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await account.signIn();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setSigningIn(false);
    }
  }

  function newProject(prompt?: string) {
    if (!account.user) {
      void signIn();
      return;
    }
    if (!studio.ready || starting.current) return;
    starting.current = true;
    try {
      const project = studio.createProject(prompt ? (fresh) => {
        startConversation(`atelier-chat-v1:${account.user?.uid ?? "local"}:${fresh.id}`, prompt);
      } : undefined);
      navigate(`${workspacePath}/projects/${encodeURIComponent(project.id)}`);
      setDrawer(null);
    } catch (error) {
      starting.current = false;
      showError(error instanceof Error ? error.message : "Could not create a project.");
    }
  }

  async function useTemplate(id: string) {
    if (!studio.ready || starting.current || !account.user || !firestore) return;
    const owner = account.user.uid;
    const request = ++templateRequest.current;
    starting.current = true;
    setCopyingTemplate(id);
    try {
      const template = await getTemplateSource(firestore, id);
      if (currentUser.current !== owner || templateRequest.current !== request) return;
      const project = studio.createProject(undefined, template);
      navigate(`${workspacePath}/projects/${encodeURIComponent(project.id)}`);
      setDrawer(null);
    } catch (error) {
      if (templateRequest.current === request) {
        showError(error instanceof Error ? error.message : "Could not copy this template.");
      }
    } finally {
      if (templateRequest.current === request) {
        starting.current = false;
        setCopyingTemplate(null);
      }
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!account.user) return;
    const githubResult = new URLSearchParams(window.location.search).get("github");
    if (githubResult === "connected") {
      setToastIsError(false);
      setToast("GitHub connected.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (githubResult === "error") {
      showError("GitHub connection failed. Check the server configuration and try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [showError, account.user]);

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
      data-welcome={welcome}
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
        {!welcome && <button
          aria-controls="workspace-chat"
          aria-expanded={drawer === "chat"}
          aria-label="Toggle chat"
          className="rounded border border-border px-3 py-2 text-xs hover:bg-muted"
          onClick={() => setDrawer("chat")}
          type="button"
        >Chat</button>}
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
        signedIn={Boolean(account.user)}
        signInDisabled={signingIn || !account.configured}
        onNewProject={() => { setDrawer(null); navigate(workspacePath); }}
        onProfile={() => {
          if (!account.user) { void signIn(); return; }
          setDrawer(null);
          navigate(`${workspacePath}profile`);
        }}
        onProjects={() => {
          if (!account.user) { void signIn(); return; }
          setDrawer(null);
          setDialog("projects");
        }}
        onSettings={() => {
          setDrawer(null);
          setToastIsError(false);
          setToast("Model settings are managed in .env.");
        }}
        photoURL={account.photoURL}
        userLabel={account.user?.email ?? "Sign in with Google"}
        workspacePath={workspacePath}
      />
      </dialog>
      {!welcome && builderReady && <dialog
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
          existingProjectName={studio.project.generated ? studio.project.name : undefined}
          modelStatus={modelStatus}
          onGenerate={studio.generate}
          onPreviewConversation={setPreviewConversation}
          onOpenFile={(path) => {
            studio.setActiveFile(path);
            setMode("code");
            if (compactLayout) setDrawer(null);
          }}
          onToggle={() => compactLayout ? setDrawer(null) : setChatCollapsed((current) => !current)}
        />
      </dialog>}
      <main className="builder-project flex min-w-0 flex-col">
        {!welcome && builderReady && <ProjectHeader
          mode={mode}
          device={device}
          onModeChange={setMode}
          onDeviceChange={setDevice}
          onDownload={() => void downloadZip()}
          onGitHub={() => setDialog("github")}
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
          project={studio.project}
          saved={!studio.loadingCloud}
          signedIn={Boolean(account.user)}
        />}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-1 flex-col">
            {welcome ? (
              <WelcomeView
                name={account.displayName.trim() || account.user?.email?.split("@")[0] || "there"}
                disabled={!studio.ready || copyingTemplate !== null || signingIn || (!account.user && !account.configured)}
                signedIn={Boolean(account.user)}
                copyingTemplate={copyingTemplate}
                onUseTemplate={useTemplate}
                onStart={newProject}
              />
            ) : !builderReady ? (
              <p className="p-8 text-sm text-muted-foreground" role="status">Loading your project…</p>
            ) : <>
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
              key={conversationKey}
              conversation={previewConversation?.storageKey === conversationKey ? previewConversation : undefined}
              generated={studio.project.generated}
              mode={mode}
              device={device}
              onModeChange={setMode}
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
            </>}
            {welcome && !account.configured && (
              <StatusMessage message="Firebase sign-in is not configured. You can browse the main page, but sign-in is required to start building." tone="info" />
            )}
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
        onRename={studio.renameProject}
        onSelectProject={(project) => {
          studio.openProject(project);
          navigate(`${workspacePath}/projects/${encodeURIComponent(project.id)}`);
        }}
        projects={studio.projects}
        projectsOpen={dialog === "projects"}
        renameOpen={dialog === "rename"}
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
