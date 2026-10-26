import { useCallback, useEffect, useState } from "react";
import { AssistantPanel, type ConversationMessage } from "@/components/AssistantPanel";
import { ProjectHeader } from "@/components/ProjectHeader";
import { PreviewPanel } from "@/components/PreviewPanel";
import { Sidebar } from "@/components/Sidebar";
import { StudioDialogs } from "@/components/StudioDialogs";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { firestore } from "@/integrations/firebase/client";
import { logProjectActivity } from "@/integrations/firebase/projects";
import { useAuth } from "@/hooks/useAuth";
import { useGitHub, useProjectDownload } from "@/hooks/useGitHub";
import { useModelStatus } from "@/hooks/useModelStatus";
import { useStudio } from "@/hooks/useStudio";

type DialogName = "projects" | "rename" | "file" | "profile" | "github";

export function Index() {
  const account = useAuth();
  const studio = useStudio(account.user);
  const github = useGitHub(account.user);
  const downloadProject = useProjectDownload();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const modelStatus = useModelStatus();
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(false);

  const showError = useCallback((message: string) => {
    setToastIsError(true);
    setToast(message);
  }, []);

  useEffect(() => {
    let active = true;
    if (!account.user) {
      setIsAdmin(false);
      return;
    }
    void account.user
      .getIdTokenResult()
      .then((token) => {
        if (active) setIsAdmin(token.claims.admin === true);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [account.user]);

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

  async function submitPrompt(prompt: string) {
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    };
    setMessages((current) => [...current, userMessage]);
    try {
      await studio.generate(prompt);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Your project is ready. Preview it, edit the source, or ask for another change.",
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error instanceof Error ? error.message : "Website generation failed.",
        },
      ]);
    }
  }

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
    <div className="min-h-dvh bg-background text-foreground md:flex">
      <Sidebar
        avatar={account.photoURL ? "" : (account.displayName || account.user?.email || "A").slice(0, 1).toUpperCase()}
        isAdmin={isAdmin}
        onNewProject={() => {
          studio.createProject();
          setMessages([]);
        }}
        onProfile={() => setDialog("profile")}
        onProjects={() => setDialog("projects")}
        onSettings={() => {
          setToastIsError(false);
          setToast("Model settings are managed in .env.");
        }}
        photoURL={account.photoURL}
        userLabel={account.user?.email ?? "Sign in with Google"}
      />
      <main className="flex min-w-0 flex-1 flex-col">
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
        <div className="flex flex-1 flex-col gap-4 p-3 md:p-5 xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col">
            <PreviewPanel
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
            {(studio.error || account.error || toast) && (
              <div className="mt-3 space-y-2">
                {studio.error && (
                  <StatusMessage
                    message={studio.error}
                    onDismiss={() => studio.setError(null)}
                    tone="error"
                  />
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
          <div className="w-full shrink-0 xl:w-[22rem] 2xl:w-[25rem]">
            <AssistantPanel
              busy={studio.generating}
              messages={messages}
              modelStatus={modelStatus}
              onSubmit={submitPrompt}
            />
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
          setMessages([]);
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
