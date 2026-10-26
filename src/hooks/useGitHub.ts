import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  disconnectGitHub,
  exportToGitHub,
  getGitHubStatus,
  listGitHubRepositories,
} from "@/integrations/studioApi";
import { firestore } from "@/integrations/firebase/client";
import { logProjectActivity } from "@/integrations/firebase/projects";
import type { GitHubRepository, ProjectFiles, StudioProject } from "@/types";

interface GitHubState {
  configured: boolean;
  connected: boolean;
  login: string | null;
  repositories: GitHubRepository[];
  loading: boolean;
  error: string | null;
}

export function useGitHub(user: User | null) {
  const [state, setState] = useState<GitHubState>({
    configured: false,
    connected: false,
    login: null,
    repositories: [],
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const status = await getGitHubStatus();
      setState((current) => ({
        ...current,
        ...status,
        loading: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: message(error, "Could not check GitHub connection."),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(() => {
    window.location.assign("/api/github/login");
  }, []);

  const loadRepositories = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const repositories = await listGitHubRepositories();
      setState((current) => ({ ...current, repositories, loading: false }));
      return repositories;
    } catch (error) {
      const errorMessage = message(error, "Could not load GitHub repositories.");
      setState((current) => ({ ...current, loading: false, error: errorMessage }));
      throw new Error(errorMessage);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGitHub();
      await refresh();
    } catch (error) {
      const errorMessage = message(error, "Could not disconnect GitHub.");
      setState((current) => ({ ...current, error: errorMessage }));
      throw new Error(errorMessage);
    }
  }, [refresh]);

  const publish = useCallback(
    async (repository: string, branch: string, project: StudioProject) => {
      try {
        const result = await exportToGitHub(
          repository,
          branch,
          project.name,
          project.files,
        );
        if (user && firestore) {
          await logProjectActivity(firestore, user, "project_exported");
        }
        return result.message;
      } catch (error) {
        const errorMessage = message(error, "Could not export to GitHub.");
        setState((current) => ({ ...current, error: errorMessage }));
        throw new Error(errorMessage);
      }
    },
    [user],
  );

  return { ...state, refresh, connect, loadRepositories, disconnect, publish };
}

export function useProjectDownload() {
  const download = useCallback(async (projectName: string, files: ProjectFiles) => {
    const JSZip = (await import("jszip")).default;
    const archive = new JSZip();
    for (const [path, content] of Object.entries(files)) archive.file(path, content);
    const blob = await archive.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName.trim().replace(/[^a-z0-9_-]+/gi, "-") || "atelier-project"}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  return download;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
