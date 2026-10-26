import { useEffect, useState } from "react";
import { isReactProject } from "@/integrations/projectTemplate";
import { previewWebsite } from "@/integrations/studioApi";
import type { ProjectFiles } from "@/types";

export function useProjectPreview(files: ProjectFiles, entrypoint: string) {
  const reactProject = isReactProject(files);
  const [state, setState] = useState({ html: "", error: "", loading: false });

  useEffect(() => {
    if (!reactProject) {
      setState({ html: "", error: "", loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ html: "", error: "", loading: true });
    const timer = window.setTimeout(() => {
      void previewWebsite(files, entrypoint, controller.signal)
        .then(({ html }) => {
          if (!controller.signal.aborted) setState({ html, error: "", loading: false });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setState({
              html: "",
              error: error instanceof Error ? error.message : "Could not compile the project.",
              loading: false,
            });
          }
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [files, entrypoint, reactProject]);

  return { ...state, reactProject };
}
