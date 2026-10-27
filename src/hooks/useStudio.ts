import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  logProjectActivity,
  listProjects,
  observeProjects,
  removeProject,
  saveProject,
} from "@/integrations/firebase/projects";
import { firestore } from "@/integrations/firebase/client";
import type { TemplateSource } from "@/integrations/firebase/templates";
import { streamChat, type ChatOptions } from "@/integrations/studioApi";
import { createProjectFiles, isLegacyProject } from "@/integrations/projectTemplate";
import { useProjectMigration } from "@/hooks/useProjectMigration";
import type {
  ProjectFiles,
  ProjectSettings,
  ProjectSnapshot,
  StudioProject,
} from "@/types";

const STORAGE_PREFIX = "atelier-studio-project-v1";
const starterProject = (): StudioProject => ({
  id: "current",
  name: "Untitled project",
  files: createProjectFiles(),
  entrypoint: "index.html",
  generated: false,
  settings: {},
  pendingCreation: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function readProject(raw: string | null, id: string): StudioProject | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const files = isProjectFiles(parsed.files)
      ? parsed.files
      : typeof parsed.html === "string"
        ? { "index.html": parsed.html }
        : null;
    if (!files || Object.keys(files).length === 0) return null;
    const name = typeof parsed.name === "string" ? parsed.name : "Untitled project";
    const entrypoint =
      typeof parsed.entrypoint === "string" && files[parsed.entrypoint]
        ? parsed.entrypoint
        : Object.keys(files)[0] ?? "index.html";
    return {
      id: typeof parsed.projectId === "string" ? parsed.projectId : id,
      name,
      owner: typeof parsed.owner === "string" ? parsed.owner : undefined,
      pendingCreation: parsed.pendingCreation === true,
      files,
      entrypoint,
      generated: parsed.generated === true,
      settings: isProjectSettings(parsed.settings) ? parsed.settings : {},
      createdAt: dateValue(parsed.createdAt),
      updatedAt: dateValue(parsed.updatedAt),
    };
  } catch {
    return null;
  }
}

function dateValue(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectFiles(value: unknown): value is ProjectFiles {
  return (
    isRecord(value) &&
    Object.values(value).every((file) => typeof file === "string")
  );
}

function isProjectSettings(value: unknown): value is ProjectSettings {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    )
  );
}

function readLocalProjects(uid?: string): StudioProject[] {
  const owner = uid ?? "local";
  const candidates = new Map<string, StudioProject>();
  const legacyKeys = [
    `${STORAGE_PREFIX}:${owner}:current`,
    `${STORAGE_PREFIX}:local:current`,
    `${STORAGE_PREFIX}:local`,
    STORAGE_PREFIX,
  ];
  for (const key of legacyKeys) {
    const project = readProject(localStorage.getItem(key), "current");
    if (project && key !== `${STORAGE_PREFIX}:${owner}:current` && project.owner === undefined) {
      project.pendingCreation = true;
    }
    if (project && !candidates.has(project.id)) candidates.set(project.id, project);
  }
  const prefix = `${STORAGE_PREFIX}:${owner}:`;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix) || key === `${prefix}current`) continue;
    const projectId = key.slice(prefix.length);
    const project = readProject(localStorage.getItem(key), projectId);
    if (project) candidates.set(project.id, project);
  }
  return [...candidates.values()].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
}

function localProjectKeys(owner: string, projectId: string): [string, string][] {
  return [
    [`${STORAGE_PREFIX}:${owner}:${projectId}`, projectId],
    [`${STORAGE_PREFIX}:${owner}`, "current"],
    [`${STORAGE_PREFIX}:local:${projectId}`, projectId],
    [`${STORAGE_PREFIX}:local`, "current"],
    [STORAGE_PREFIX, "current"],
  ];
}

function removeLocalProject(owner: string, projectId: string) {
  for (const [key, fallbackId] of localProjectKeys(owner, projectId)) {
    if (readProject(localStorage.getItem(key), fallbackId)?.id === projectId) {
      localStorage.removeItem(key);
    }
  }
}

function markLocalProjectSynced(owner: string, projectId: string) {
  for (const [key, fallbackId] of localProjectKeys(owner, projectId)) {
    const raw = localStorage.getItem(key);
    if (!raw || readProject(raw, fallbackId)?.id !== projectId) continue;
    const stored = JSON.parse(raw);
    if (stored.owner !== owner || stored.pendingCreation !== false) {
      localStorage.setItem(key, JSON.stringify({ ...stored, owner, pendingCreation: false }));
    }
  }
}

interface StoredHistory {
  history: ProjectSnapshot[];
  historyIndex: number;
  activeFile: string;
}

function readLocalHistory(project: StudioProject, uid: string): StoredHistory {
  const keys = [
    `${STORAGE_PREFIX}:${uid}:${project.id}`,
    `${STORAGE_PREFIX}:local:${project.id}`,
    `${STORAGE_PREFIX}:local`,
    STORAGE_PREFIX,
  ];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || !Array.isArray(value.history)) continue;
      const history = value.history.flatMap((item): ProjectSnapshot[] => {
        if (typeof item === "string") {
          return [{
            files: { "index.html": item },
            entrypoint: "index.html",
            activeFile: "index.html",
          }];
        }
        if (!isRecord(item) || !isProjectFiles(item.files)) return [];
        const entrypoint =
          typeof item.entrypoint === "string" && item.files[item.entrypoint]
            ? item.entrypoint
            : "index.html";
        const snapshotActiveFile =
          typeof item.activeFile === "string" && item.files[item.activeFile]
            ? item.activeFile
            : entrypoint;
        return [{ files: item.files, entrypoint, activeFile: snapshotActiveFile }];
      });
      const validIndex =
        typeof value.historyIndex === "number" &&
        Number.isInteger(value.historyIndex) &&
        value.historyIndex >= 0 &&
        value.historyIndex < history.length
          ? value.historyIndex
          : project.generated && history.length > 0
            ? history.length - 1
            : -1;
      const activeFile =
        typeof value.activeFile === "string" && project.files[value.activeFile]
          ? value.activeFile
          : project.entrypoint;
      const storedFiles = isProjectFiles(value.files)
        ? value.files
        : typeof value.html === "string"
          ? { "index.html": value.html }
          : null;
      if (JSON.stringify(storedFiles) === JSON.stringify(project.files)) {
        return { history, historyIndex: validIndex, activeFile };
      }
    } catch {
      continue;
    }
  }
  const history = project.generated
    ? [makeSnapshot(project.files, project.entrypoint, project.entrypoint)]
    : [];
  return {
    history,
    historyIndex: history.length - 1,
    activeFile: project.entrypoint,
  };
}

function makeSnapshot(
  files: ProjectFiles,
  entrypoint: string,
  activeFile: string,
): ProjectSnapshot {
  return { files: { ...files }, entrypoint, activeFile };
}

export function useStudio(
  user: User | null,
  authLoading = false,
  { active = true, projectId }: { active?: boolean; projectId?: string } = {},
) {
  const [project, setProject] = useState<StudioProject>(() => {
    const local = readLocalProjects()[0];
    return local ?? starterProject();
  });
  const projectRef = useRef(project);
  projectRef.current = project;
  const [activeFile, setActiveFile] = useState(
    () => readLocalHistory(project, "local").activeFile,
  );
  const [history, setHistory] = useState<ProjectSnapshot[]>(() =>
    readLocalHistory(project, "local").history,
  );
  const [historyIndex, setHistoryIndex] = useState(
    () => readLocalHistory(project, "local").historyIndex,
  );
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const skipNextCloudSave = useRef(false);
  const cloudOwner = user?.uid ?? "local";
  const ownerRef = useRef(cloudOwner);
  ownerRef.current = cloudOwner;
  const previousOwner = useRef("local");

  useEffect(() => {
    if (authLoading) return;
    setSyncError(null);
    const priorOwner = previousOwner.current;
    previousOwner.current = cloudOwner;
    setProjects(readLocalProjects(user?.uid));
    if (!user || !firestore) {
      setError(null);
      if (priorOwner !== "local") {
        const local = readLocalProjects()[0] ?? starterProject();
        const restored = readLocalHistory(local, "local");
        setProject(local);
        setActiveFile(restored.activeFile);
        setHistory(restored.history);
        setHistoryIndex(restored.historyIndex);
      }
      setCloudReady(true);
      setHydrated(true);
      setReadyOwner("local");
      return;
    }
    const database = firestore;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setLoadingCloud(true);
    setCloudReady(false);
    setReadyOwner(null);
    void listProjects(database, user)
      .then((cloudProjects) => {
        if (!active) return;
        const localProjects = readLocalProjects(user.uid);
        const cloudIds = new Set(cloudProjects.map((item) => item.id));
        const combined = new Map(localProjects.filter((item) => {
          if (cloudIds.has(item.id) || item.pendingCreation) return true;
          removeLocalProject(user.uid, item.id);
          return false;
        }).map((item) => [item.id, item]));
        for (const item of cloudProjects) {
          markLocalProjectSynced(user.uid, item.id);
          const local = combined.get(item.id);
          combined.set(item.id, !local || item.updatedAt >= local.updatedAt
            ? item : { ...local, owner: user.uid, pendingCreation: false });
        }
        const merged = [...combined.values()].sort(
          (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
        );
        setProjects(merged);
        const current =
          merged.find((item) => item.id === (projectId ?? projectRef.current.id) && (priorOwner === "local" || priorOwner === user.uid)) ??
          merged[0] ??
          { ...starterProject(), id: crypto.randomUUID() };
        skipNextCloudSave.current = cloudProjects.some((item) => item === current);
        projectRef.current = current;
        projectsRef.current = merged;
        setProject(current);
        const localCurrent = localProjects.find((item) => item.id === current.id);
        const matchingLocal =
          localCurrent &&
          JSON.stringify(localCurrent.files) === JSON.stringify(current.files)
            ? localCurrent
            : null;
        const restoredHistory = readLocalHistory(matchingLocal ?? current, user.uid);
        const selectedFile = matchingLocal
          ? restoredHistory.activeFile
          : current.files[activeFileRef.current]
            ? activeFileRef.current
            : current.entrypoint;
        setActiveFile(selectedFile);
        setHistory(restoredHistory.history);
        setHistoryIndex(restoredHistory.historyIndex);
        setCloudReady(true);
        setHydrated(true);
        setReadyOwner(user.uid);
        let knownIds = cloudIds;
        unsubscribe = observeProjects(database, user, (savedProjects) => {
          if (!active) return;
          const savedIds = new Set(savedProjects.map((item) => item.id));
          const deletedIds = new Set([...knownIds].filter((id) => !savedIds.has(id)));
          knownIds = savedIds;
          for (const id of deletedIds) removeLocalProject(user.uid, id);
          for (const id of savedIds) markLocalProjectSynced(user.uid, id);
          const reconcile = (item: StudioProject) => savedIds.has(item.id) && item.pendingCreation
            ? { ...item, owner: user.uid, pendingCreation: false } : item;
          const remaining = projectsRef.current.filter((item) => !deletedIds.has(item.id)).map(reconcile);
          projectsRef.current = remaining;
          setProjects(remaining);
          const selected = projectRef.current;
          if (deletedIds.has(selected.id)) {
            const next = remaining[0] ?? savedProjects[0] ?? { ...starterProject(), id: crypto.randomUUID(), name: "Untitled project" };
            const restored = readLocalHistory(next, user.uid);
            projectRef.current = next;
            skipNextCloudSave.current = savedProjects.includes(next);
            setProject(next);
            setActiveFile(restored.activeFile);
            setHistory(restored.history);
            setHistoryIndex(restored.historyIndex);
            setSyncError(null);
          } else if (savedIds.has(selected.id) && selected.pendingCreation) {
            const next = reconcile(selected);
            projectRef.current = next;
            setProject(next);
          }
        }, (reason) => {
          if (active) setSyncError(errorText(reason, "Could not watch saved projects."));
        });
      })
      .catch((reason: unknown) => {
        if (active) {
          const local = readLocalProjects(user.uid)[0] ?? starterProject();
          const restored = readLocalHistory(local, user.uid);
          setProject(local);
          setActiveFile(restored.activeFile);
          setHistory(restored.history);
          setHistoryIndex(restored.historyIndex);
          setSyncError(errorText(reason, "Could not load saved cloud projects.") + " Working from browser storage; retry cloud sync after correcting access.");
          setCloudReady(false);
          setHydrated(true);
          setReadyOwner(user.uid);
        }
      })
      .finally(() => {
        if (active) setLoadingCloud(false);
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [user, authLoading, cloudOwner, syncAttempt]);

  useEffect(() => {
    if (!active || (projectId && project.id !== projectId) || !hydrated || authLoading || readyOwner !== cloudOwner) return;
    const stored = {
      ...project,
      projectId: project.id,
      activeFile,
      history,
      historyIndex,
    };
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}:${cloudOwner}:${project.id}`,
        JSON.stringify(stored),
      );
      if (project.id === "current") {
        localStorage.setItem(`${STORAGE_PREFIX}:${cloudOwner}`, JSON.stringify(stored));
      }
    } catch (reason) {
      setError(errorText(reason, "Could not save the project in this browser."));
    }
    setProjects((current) => {
      const next = [project, ...current.filter((item) => item.id !== project.id)];
      return next.sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
      );
    });
    if (!user || !firestore || !cloudReady || skipNextCloudSave.current) {
      skipNextCloudSave.current = false;
      return;
    }
    const database = firestore;
    const timer = window.setTimeout(() => {
      void saveProject(database, user, project).then(() => {
        if (ownerRef.current === user.uid) setSyncError(null);
      }).catch((reason: unknown) => {
        if (ownerRef.current === user.uid) setSyncError(errorText(reason, "Could not sync the project to the cloud.") + " Your local copy is retained.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project, activeFile, history, historyIndex, user, cloudReady, hydrated, readyOwner, cloudOwner, authLoading, active, projectId]);

  const acceptMigration = useCallback(async (copy: StudioProject) => {
    const snapshot = makeSnapshot(copy.files, copy.entrypoint, copy.entrypoint);
    localStorage.setItem(`${STORAGE_PREFIX}:${cloudOwner}:${copy.id}`, JSON.stringify({
      ...copy, projectId: copy.id, activeFile: copy.entrypoint, history: [snapshot], historyIndex: 0,
    }));
    setProjects((current) => [copy, ...current]);
    setProject(copy);
    setActiveFile(copy.entrypoint);
    setHistory([snapshot]);
    setHistoryIndex(0);
  }, [cloudOwner]);
  const { migrating, retryMigration } = useProjectMigration({
    project,
    projects,
    owner: cloudOwner,
    ready: active && (!projectId || project.id === projectId) && hydrated && !loadingCloud && !authLoading && readyOwner === cloudOwner,
    onMigrated: acceptMigration,
    onError: setError,
  });

  const recordSnapshot = useCallback(
    (nextFiles: ProjectFiles, nextEntrypoint: string, nextActiveFile: string) => {
      const snapshot = makeSnapshot(nextFiles, nextEntrypoint, nextActiveFile);
      const next = history.slice(0, historyIndex + 1);
      if (
        next.length > 0 &&
        JSON.stringify(next[next.length - 1]) === JSON.stringify(snapshot)
      ) {
        return;
      }
      next.push(snapshot);
      setHistory(next);
      setHistoryIndex(next.length - 1);
    },
    [history, historyIndex],
  );

  const updateFiles = useCallback(
    (files: ProjectFiles, nextActive = activeFile, entrypoint = project.entrypoint) => {
      setProject((current) => ({
        ...current,
        files,
        entrypoint,
        generated: true,
        updatedAt: new Date(),
      }));
      setActiveFile(nextActive);
      recordSnapshot(files, entrypoint, nextActive);
    },
    [activeFile, project.entrypoint, recordSnapshot],
  );

  const renameProject = useCallback((name: string) => {
    const nextName = name.trim();
    if (!nextName) throw new Error("Project name cannot be empty.");
    setProject((current) => ({ ...current, name: nextName, updatedAt: new Date() }));
  }, []);

  const createProject = useCallback((onCreate?: (fresh: StudioProject) => void, template?: TemplateSource) => {
    const fresh = starterProject();
    fresh.id = crypto.randomUUID();
    fresh.owner = user?.uid;
    if (template) {
      fresh.name = template.name;
      fresh.files = { ...template.files };
      fresh.entrypoint = template.entrypoint;
      fresh.generated = true;
    }
    const initialHistory = template ? [makeSnapshot(fresh.files, fresh.entrypoint, fresh.entrypoint)] : [];
    localStorage.setItem(`${STORAGE_PREFIX}:${cloudOwner}:${fresh.id}`, JSON.stringify({
      ...fresh, projectId: fresh.id, activeFile: fresh.entrypoint, history: initialHistory, historyIndex: initialHistory.length - 1,
    }));
    try {
      onCreate?.(fresh);
    } catch (error) {
      localStorage.removeItem(`${STORAGE_PREFIX}:${cloudOwner}:${fresh.id}`);
      throw error;
    }
    skipNextCloudSave.current = false;
    projectRef.current = fresh;
    setProject(fresh);
    setProjects((current) => [fresh, ...current]);
    setActiveFile(fresh.entrypoint);
    setHistory(initialHistory);
    setHistoryIndex(initialHistory.length - 1);
    if (user && firestore) {
      void logProjectActivity(firestore, user, "project_created").catch(
        (reason: unknown) => setError(errorText(reason, "Could not record project activity.")),
      );
    }
    return fresh;
  }, [user, cloudOwner]);

  const openProject = useCallback(
    (next: StudioProject) => {
      skipNextCloudSave.current = false;
      projectRef.current = next;
      setProject(next);
      const restored = readLocalHistory(next, cloudOwner);
      setActiveFile(restored.activeFile);
      setHistory(restored.history);
      setHistoryIndex(restored.historyIndex);
      if (user && firestore) {
        void logProjectActivity(firestore, user, "project_opened").catch(
          (reason: unknown) => setError(errorText(reason, "Could not record project activity.")),
        );
      }
    },
    [user, cloudOwner],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      if (user && firestore) await removeProject(firestore, user, projectId);
      removeLocalProject(cloudOwner, projectId);
      setProjects((current) => current.filter((item) => item.id !== projectId));
      if (project.id === projectId) {
        const alternate = projects.find((item) => item.id !== projectId);
        if (alternate) openProject(alternate);
        else createProject();
      }
    },
    [cloudOwner, createProject, openProject, project.id, projects, user],
  );

  const addFile = useCallback(
    (path: string) => {
      const normalized = path.trim().replace(/^\/+/, "").replaceAll("\\", "/");
      if (
        !normalized ||
        !/^[A-Za-z0-9_./-]+$/.test(normalized) ||
        normalized.split("/").some((segment) => !segment || [".", "..", "node_modules", "dist", ".git"].includes(segment)) ||
        (normalized.split("/").at(-1)?.startsWith(".env") && normalized !== ".env.example")
      ) {
        throw new Error("Enter a valid relative file path.");
      }
      if (Object.hasOwn(project.files, normalized)) throw new Error("A file with that path already exists.");
      if (Object.keys(project.files).length >= 100) throw new Error("Projects are limited to 100 files.");
      if (!/\.(html|css|js|jsx|ts|tsx|mjs|cjs|json|svg|txt|md)$/.test(normalized) &&
          ![".gitignore", ".env.example"].includes(normalized)) {
        throw new Error("Use a supported source file extension, .gitignore, or .env.example.");
      }
      updateFiles({ ...project.files, [normalized]: "" }, normalized);
    },
    [project.files, updateFiles],
  );

  const generate = useCallback(
    async (prompt: string, options: ChatOptions) => {
      if (migrating) throw new Error("Wait for the React migration to finish before generating.");
      const sourceId = project.id;
      const sourceOwner = cloudOwner;
      setGenerating(true);
      setError(null);
      try {
        const result = await streamChat(
          prompt,
          project.files,
          project.entrypoint,
          options,
        );
        options.signal.throwIfAborted();
        if (projectRef.current.id !== sourceId || ownerRef.current !== sourceOwner) {
          throw new Error("The selected project changed during generation. No project was overwritten.");
        }
        if (!result) return [];
        if (projectRef.current.files !== project.files) {
          throw new Error("Project files changed while generating. Retry to use the latest files.");
        }
        const changedFiles = [...new Set([...Object.keys(project.files), ...Object.keys(result.files)])]
          .filter((path) => project.files[path] !== result.files[path]);
        const nextActive =
          result.files[activeFile] !== undefined ? activeFile : result.entrypoint;
        if (result.name) {
          const name = result.name.trim();
          setProject((current) =>
            !current.generated && current.name === "Untitled project"
              ? { ...current, name }
              : current,
          );
        }
        updateFiles(result.files, nextActive, result.entrypoint);
        if (user && firestore) {
          void logProjectActivity(firestore, user, "generation_completed").catch(
            (reason: unknown) => setError(errorText(reason, "Could not record generation activity.")),
          );
        }
        return changedFiles;
      } finally {
        setGenerating(false);
      }
    },
    [activeFile, project.id, project.entrypoint, project.files, updateFiles, user, cloudOwner, migrating],
  );

  const restoreHistory = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = historyIndex + direction;
      const snapshot = history[nextIndex];
      if (!snapshot) return;
      setHistoryIndex(nextIndex);
      setProject((current) => ({
        ...current,
        files: { ...snapshot.files },
        entrypoint: snapshot.entrypoint,
        generated: true,
        updatedAt: new Date(),
      }));
      setActiveFile(snapshot.activeFile);
    },
    [history, historyIndex],
  );

  return {
    project,
    projects,
    activeFile,
    activeContent: project.files[activeFile] ?? "",
    historyIndex,
    historyLength: history.length,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    loadingCloud,
    ready: hydrated && !authLoading && !loadingCloud && readyOwner === cloudOwner,
    generating: generating || migrating,
    migrating,
    legacyProject: isLegacyProject(project.files),
    retryMigration,
    error,
    syncError,
    setSyncError,
    retrySync: () => setSyncAttempt((attempt) => attempt + 1),
    setError,
    setActiveFile,
    setActiveContent: (content: string) =>
      setProject((current) => ({
        ...current,
        files: { ...current.files, [activeFile]: content },
        updatedAt: new Date(),
      })),
    updateFiles,
    renameProject,
    createProject,
    openProject,
    deleteProject,
    addFile,
    generate,
    undo: () => restoreHistory(-1),
    redo: () => restoreHistory(1),
  };
}

export function useProjectName(project: StudioProject): string {
  return project.name || "Untitled project";
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
