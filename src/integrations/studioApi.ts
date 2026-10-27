import type { GitHubRepository, ProjectFiles } from "@/types";

export interface GenerateResponse {
  name?: string;
  files: ProjectFiles;
  entrypoint: string;
}

export interface ChatContext {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  conversation: ChatContext[];
  signal: AbortSignal;
  onToken: (token: string) => void;
}

export async function streamChat(
  prompt: string,
  currentFiles: ProjectFiles,
  currentEntrypoint: string,
  { conversation, signal, onToken }: ChatOptions,
): Promise<GenerateResponse | null> {
  if (!prompt.trim()) throw new Error("Write a message before sending.");
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.trim(),
      conversation: conversation.filter((message) => message.content.trim()).slice(-20),
      currentFiles, currentEntrypoint,
    }),
    signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    if (isRecord(body) && typeof body.error === "string") throw new Error(body.error);
    if (response.status === 404) throw new Error("The chat route /api/chat was not found on the backend. Restart the Python server from this checkout and check that Vite's /api proxy uses its PORT.");
    throw new Error(`The chat backend returned HTTP ${response.status}. Check the Python server and /api proxy.`);
  }
  if (!response.headers.get("Content-Type")?.includes("text/event-stream")) {
    throw new Error("The /api/chat request did not reach the streaming backend. Check the /api proxy and restart the Python server.");
  }
  if (!response.body) throw new Error("Streaming is unavailable in this browser.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r/g, "");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const event: unknown = JSON.parse(data);
        if (!isRecord(event)) throw new Error("The server returned an invalid chat event.");
        if (event.type === "error") throw new Error(typeof event.error === "string" ? event.error : "Chat failed. Please retry.");
        if (event.type === "delta" && typeof event.text === "string") onToken(event.text);
        else if (event.type === "done") {
          if (event.project === null) return null;
          if (isGeneratedProject(event.project)) return event.project;
          throw new Error("The server returned invalid project changes.");
        }
      }
      if (done) throw new Error("The connection ended before the response finished. Please retry.");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function isGeneratedProject(value: unknown): value is GenerateResponse {
  return isRecord(value) && isProjectFiles(value.files) &&
    (value.name === undefined || (typeof value.name === "string" && value.name.trim().length > 0 && value.name.trim().length <= 120)) &&
    typeof value.entrypoint === "string" && typeof value.files[value.entrypoint] === "string";
}

export function migrateWebsite(
  currentFiles: ProjectFiles,
  currentEntrypoint: string,
): Promise<GenerateResponse> {
  return requestJson("/api/migrate", isGeneratedProject, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentFiles, currentEntrypoint }),
  });
}

export function previewWebsite(
  files: ProjectFiles,
  entrypoint: string,
  signal: AbortSignal,
): Promise<{ html: string }> {
  return requestJson(
    "/api/preview",
    (value): value is { html: string } => isRecord(value) && typeof value.html === "string",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, entrypoint }),
      signal,
    },
  );
}

interface HealthResponse {
  modelConfigured: boolean;
}

interface GitHubStatus {
  configured: boolean;
  connected: boolean;
  login: string | null;
}

async function requestJson<T>(
  url: string,
  isResponse: (value: unknown) => value is T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  if (!isResponse(body)) {
    throw new Error(`The server returned an invalid response for ${url}.`);
  }
  return body;
}

export function getModelHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>(
    "/api/health",
    (value): value is HealthResponse =>
      isRecord(value) && typeof value.modelConfigured === "boolean",
  );
}

export function generateWebsite(
  prompt: string,
  currentFiles: ProjectFiles | null,
  currentEntrypoint: string,
): Promise<GenerateResponse> {
  return requestJson<GenerateResponse>(
    "/api/generate",
    isGeneratedProject,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        currentFiles,
        currentAssets: [],
        currentEntrypoint,
      }),
    },
  );
}

export function getGitHubStatus(): Promise<GitHubStatus> {
  return requestJson<GitHubStatus>(
    "/api/github/status",
    (value): value is GitHubStatus =>
      isRecord(value) &&
      typeof value.configured === "boolean" &&
      typeof value.connected === "boolean" &&
      (typeof value.login === "string" || value.login === null),
  );
}

export async function listGitHubRepositories(): Promise<GitHubRepository[]> {
  const result = await requestJson<{ repositories: GitHubRepository[] }>(
    "/api/github/repos",
    (value): value is { repositories: GitHubRepository[] } =>
      isRecord(value) &&
      Array.isArray(value.repositories) &&
      value.repositories.every(
        (repository) =>
          isRecord(repository) &&
          typeof repository.full_name === "string" &&
          typeof repository.private === "boolean" &&
          (typeof repository.default_branch === "string" ||
            repository.default_branch === null),
      ),
  );
  return result.repositories;
}

export async function exportToGitHub(
  repository: string,
  branch: string,
  projectName: string,
  files: ProjectFiles,
): Promise<{ message: string }> {
  return requestJson<{ message: string }>(
    "/api/github/export",
    (value): value is { message: string } =>
      isRecord(value) && typeof value.message === "string",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repository, branch, projectName, files }),
    },
  );
}

export async function disconnectGitHub(): Promise<void> {
  await requestJson<{ connected: boolean }>(
    "/api/github/logout",
    (value): value is { connected: boolean } =>
      isRecord(value) && typeof value.connected === "boolean",
    { method: "POST" },
  );
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
