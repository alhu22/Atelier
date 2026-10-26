import { useEffect, useRef, useState } from "react";
import { isLegacyProject } from "@/integrations/projectTemplate";
import { migrateWebsite, type GenerateResponse } from "@/integrations/studioApi";
import type { StudioProject } from "@/types";

interface MigrationOptions {
  project: StudioProject;
  projects: StudioProject[];
  owner: string;
  ready: boolean;
  onMigrated: (project: StudioProject) => Promise<void>;
  onError: (message: string) => void;
}

export function useProjectMigration(options: MigrationOptions) {
  const latest = useRef(options);
  latest.current = options;
  const requests = useRef(new Map<string, { source: string; result: Promise<GenerateResponse> }>());
  const [migrating, setMigrating] = useState(false);
  const [retry, setRetry] = useState(0);
  const { project, owner, ready } = options;

  useEffect(() => {
    const current = latest.current;
    if (!ready || !isLegacyProject(project.files) ||
        current.projects.some((item) => item.settings.migrationSourceId === project.id)) {
      setMigrating(false);
      return;
    }
    const key = `${owner}:${project.id}:${retry}`;
    const source = JSON.stringify(project.files);
    let request = requests.current.get(key);
    if (!request) {
      request = { source, result: migrateWebsite(project.files, project.entrypoint) };
      requests.current.set(key, request);
    }
    const started = request;
    let active = true;
    setMigrating(true);
    void started.result.then(async (result) => {
      if (!active || latest.current.owner !== owner || latest.current.project.id !== project.id) return;
      if (JSON.stringify(latest.current.project.files) !== started.source) {
        throw new Error("The original changed during migration. It was kept intact; retry migration when ready.");
      }
      const now = new Date();
      await latest.current.onMigrated({
        ...latest.current.project,
        id: crypto.randomUUID(),
        name: `${latest.current.project.name.slice(0, 112)} (React)`,
        files: result.files,
        entrypoint: result.entrypoint,
        generated: true,
        settings: { ...project.settings, migrationSourceId: project.id },
        createdAt: now,
        updatedAt: now,
      });
    }).catch((error: unknown) => {
      if (active) {
        latest.current.onError(
          `React migration failed; your original is unchanged. ${error instanceof Error ? error.message : "Please retry."}`,
        );
      }
    }).finally(() => {
      if (active) setMigrating(false);
    });
    return () => { active = false; };
    // File edits are checked against the captured source before committing a copy, not re-sent on every keystroke.
  }, [project.id, owner, ready, retry]);

  return { migrating, retryMigration: () => setRetry((value) => value + 1) };
}
