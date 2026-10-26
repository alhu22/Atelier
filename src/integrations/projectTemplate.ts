import type { ProjectFiles } from "@/types";

const sources = import.meta.glob<string>(
  [
    "../../templates/react/**/*",
    "!../../templates/react/dist/**",
    "!../../templates/react/node_modules/**",
    "!../../templates/react/package-lock.json",
    "!../../templates/react/**/.env*",
  ],
  { query: "?raw", import: "default", eager: true },
);

export function createProjectFiles(): ProjectFiles {
  return Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path.replace("../../templates/react/", ""),
      source,
    ]),
  );
}

export function isReactProject(files: ProjectFiles): boolean {
  return "package.json" in files && "src/main.tsx" in files;
}

export function isLegacyProject(files: ProjectFiles): boolean {
  return !("package.json" in files) && Object.keys(files).some((path) => path.endsWith(".html"));
}
