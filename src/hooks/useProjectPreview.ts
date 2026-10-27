import { useEffect, useState } from "react";
import { isReactProject } from "@/integrations/projectTemplate";
import { previewWebsite } from "@/integrations/studioApi";
import type { ProjectFiles } from "@/types";

export function useProjectPreview(files: ProjectFiles, entrypoint: string, enabled = true) {
  const reactProject = isReactProject(files);
  const [state, setState] = useState<{
    html: string; error: string; loading: boolean; files?: ProjectFiles; entrypoint?: string;
  }>({ html: "", error: "", loading: false });

  useEffect(() => {
    if (!reactProject || !enabled) {
      setState({ html: "", error: "", loading: false });
      return;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, error: "", loading: true, files, entrypoint }));
    const timer = window.setTimeout(() => {
      void previewWebsite(files, entrypoint, controller.signal)
        .then(({ html }) => {
          if (!controller.signal.aborted) setState({ html, error: "", loading: false, files, entrypoint });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setState((current) => ({
              ...current,
              error: error instanceof Error ? error.message : "Could not compile the project.",
              loading: false,
              files, entrypoint,
            }));
          }
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [files, entrypoint, reactProject, enabled]);

  const current = state.files === files && state.entrypoint === entrypoint;
  return {
    ...state,
    error: current ? state.error : "",
    loading: enabled && reactProject && (!current || state.loading),
    ready: !reactProject || (enabled && current && !state.loading && !state.error && !!state.html),
    reactProject,
  };
}
