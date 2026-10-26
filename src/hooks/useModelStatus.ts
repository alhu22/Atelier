import { useEffect, useState } from "react";
import { getModelHealth } from "@/integrations/studioApi";

type ModelStatus = "Checking model…" | "Azure OpenAI ready" | "Check model URL in .env" | "Model status unavailable";

export function useModelStatus(): ModelStatus {
  const [status, setStatus] = useState<ModelStatus>("Checking model…");

  useEffect(() => {
    let active = true;
    void getModelHealth()
      .then(({ modelConfigured }) => {
        if (active) {
          setStatus(modelConfigured ? "Azure OpenAI ready" : "Check model URL in .env");
        }
      })
      .catch(() => {
        if (active) setStatus("Model status unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  return status;
}
