import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  logProjectActivity,
  listProjects,
  removeProject,
  saveProject,
} from "@/integrations/firebase/projects";
import { firestore } from "@/integrations/firebase/client";
import { generateWebsite } from "@/integrations/studioApi";
import type {
  ProjectFiles,
  ProjectSettings,
  ProjectSnapshot,
  StudioProject,
} from "@/types";

const STORAGE_PREFIX = "atelier-studio-project-v1";
const INITIAL_FILES: ProjectFiles = {
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sunday House</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; color: #28302b; background: #f5f3ec; font-family: "DM Sans", sans-serif; }
      header { display: flex; justify-content: space-between; align-items: center; padding: 28px 8vw; }
      .brand { font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
      nav { display: flex; gap: 26px; font-size: 13px; }
      a { color: inherit; text-decoration: none; }
      main { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 7vw; min-height: 72vh; padding: 5vh 8vw 10vh; }
      .eyebrow { font-size: 11px; letter-spacing: .2em; text-transform: uppercase; }
      h1 { max-width: 620px; margin: 24px 0; font: 500 clamp(54px, 7vw, 100px)/.98 "Playfair Display", serif; letter-spacing: -.055em; }
      p { max-width: 390px; color: #6c746d; font-size: 16px; line-height: 1.8; }
      .cta { display: inline-flex; margin-top: 22px; padding: 14px 22px; color: white; background: #414d43; border-radius: 3px; font-size: 13px; }
      .photo { min-height: 480px; background: linear-gradient(180deg, #0000, #0002), url("https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=1200&q=85") center/cover; }
      @media (max-width: 700px) { header { padding: 24px; } nav { gap: 12px; } main { grid-template-columns: 1fr; padding: 4vh 24px 8vh; } .photo { min-height: 320px; } }
    </style>
  </head>
  <body>
    <header><a class="brand" href="#">Sunday House</a><nav><a href="#stay">The house</a><a href="#story">Our story</a><a href="#visit">Visit</a></nav></header>
    <main><section><span class="eyebrow">A little further from everything</span><h1>Room to breathe again.</h1><p>A quiet cabin in the hills, made for slow mornings, long walks, and remembering what a weekend can feel like.</p><a class="cta" href="#visit">Find your weekend</a></section><div class="photo" role="img" aria-label="A cabin surrounded by trees"></div></main>
  </body>
</html>`,
};

const starterProject = (): StudioProject => ({
  id: "current",
  name: "Sunday House",
  files: INITIAL_FILES,
  entrypoint: "index.html",
  generated: false,
  settings: {},
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
    if (project) candidates.set(project.id, project);
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

export function useStudio(user: User | null) {
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
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const skipNextCloudSave = useRef(false);
  const cloudOwner = user?.uid ?? "local";

  useEffect(() => {
    setProjects(readLocalProjects(user?.uid));
    if (!user || !firestore) {
      setCloudReady(true);
      setHydrated(true);
      setReadyOwner("local");
      return;
    }
    const database = firestore;
    let active = true;
    setLoadingCloud(true);
    setCloudReady(false);
    setReadyOwner(null);
    void listProjects(database, user)
      .then((cloudProjects) => {
        if (!active) return;
        const localProjects = readLocalProjects(user.uid);
        const combined = new Map(localProjects.map((item) => [item.id, item]));
        for (const item of cloudProjects) combined.set(item.id, item);
        const merged = [...combined.values()].sort(
          (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
        );
        setProjects(merged);
        const current =
          merged.find((item) => item.id === projectRef.current.id) ??
          merged[0] ??
          projectRef.current;
        skipNextCloudSave.current = true;
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
        if (!cloudProjects.some((item) => item.id === current.id)) {
          void saveProject(database, user, current).catch((reason: unknown) =>
            setError(errorText(reason, "Could not sync this project.")),
          );
        }
        setCloudReady(true);
        setHydrated(true);
        setReadyOwner(user.uid);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(errorText(reason, "Could not load saved cloud projects."));
          setCloudReady(true);
          setHydrated(true);
          setReadyOwner(user.uid);
        }
      })
      .finally(() => {
        if (active) setLoadingCloud(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!hydrated || readyOwner !== cloudOwner) return;
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
      void saveProject(database, user, project).catch((reason: unknown) =>
        setError(errorText(reason, "Could not sync the project to the cloud.")),
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project, activeFile, history, historyIndex, user, cloudReady, hydrated, readyOwner, cloudOwner]);

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

  const createProject = useCallback(() => {
    const fresh = starterProject();
    fresh.id = crypto.randomUUID();
    fresh.name = "Untitled project";
    setProject(fresh);
    setActiveFile(fresh.entrypoint);
    setHistory([]);
    setHistoryIndex(-1);
    if (user && firestore) {
      void logProjectActivity(firestore, user, "project_created").catch(
        (reason: unknown) => setError(errorText(reason, "Could not record project activity.")),
      );
    }
  }, [user]);

  const openProject = useCallback(
    (next: StudioProject) => {
      setProject(next);
      setActiveFile(next.entrypoint);
      setHistory(next.generated ? [makeSnapshot(next.files, next.entrypoint, next.entrypoint)] : []);
      setHistoryIndex(next.generated ? 0 : -1);
      if (user && firestore) {
        void logProjectActivity(firestore, user, "project_opened").catch(
          (reason: unknown) => setError(errorText(reason, "Could not record project activity.")),
        );
      }
    },
    [user],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      if (user && firestore) await removeProject(firestore, user, projectId);
      localStorage.removeItem(`${STORAGE_PREFIX}:${cloudOwner}:${projectId}`);
      if (projectId === "current") {
        localStorage.removeItem(`${STORAGE_PREFIX}:${cloudOwner}`);
        localStorage.removeItem(`${STORAGE_PREFIX}:local:current`);
        localStorage.removeItem(`${STORAGE_PREFIX}:local`);
        localStorage.removeItem(STORAGE_PREFIX);
      }
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
        normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
      ) {
        throw new Error("Enter a valid relative file path.");
      }
      if (project.files[normalized]) throw new Error("A file with that path already exists.");
      updateFiles({ ...project.files, [normalized]: "" }, normalized);
    },
    [project.files, updateFiles],
  );

  const generate = useCallback(
    async (prompt: string) => {
      setGenerating(true);
      setError(null);
      try {
        const result = await generateWebsite(
          prompt,
          project.generated ? project.files : null,
          project.entrypoint,
        );
        const nextActive =
          result.files[activeFile] !== undefined ? activeFile : result.entrypoint;
        updateFiles(result.files, nextActive, result.entrypoint);
        if (user && firestore) {
          void logProjectActivity(firestore, user, "generation_completed").catch(
            (reason: unknown) => setError(errorText(reason, "Could not record generation activity.")),
          );
        }
      } catch (reason) {
        setError(errorText(reason, "Website generation failed."));
        throw reason;
      } finally {
        setGenerating(false);
      }
    },
    [activeFile, project.entrypoint, project.files, project.generated, updateFiles, user],
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
    generating,
    error,
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
