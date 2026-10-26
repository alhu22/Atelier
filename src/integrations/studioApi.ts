import type { GitHubRepository, ProjectFiles } from "@/types";

interface GenerateResponse {
  files: ProjectFiles;
  entrypoint: string;
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
    (value): value is GenerateResponse =>
      isRecord(value) &&
      isProjectFiles(value.files) &&
      typeof value.entrypoint === "string" &&
      typeof value.files[value.entrypoint] === "string",
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
