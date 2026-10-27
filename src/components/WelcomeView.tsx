import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { firestore } from "@/integrations/firebase/client";
import { listProjectTemplates, type ProjectTemplate } from "@/integrations/firebase/templates";
import "./WelcomeView.css";

export function WelcomeView({
  name, disabled, signedIn, onStart, copyingTemplate, onUseTemplate,
}: {
  name: string;
  disabled: boolean;
  signedIn: boolean;
  onStart: (prompt: string) => void;
  copyingTemplate: string | null;
  onUseTemplate: (id: string) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    setLoadingTemplates(true);
    setTemplateError(null);
    const request = signedIn && firestore ? listProjectTemplates(firestore) : Promise.resolve([]);
    void request.then((items) => {
      if (active) setTemplates(items);
    }).catch((error: unknown) => {
      if (active) setTemplateError(error instanceof Error ? error.message : "Could not load templates.");
    }).finally(() => {
      if (active) setLoadingTemplates(false);
    });
    return () => { active = false; };
  }, [attempt, signedIn]);

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(input, { box: "border-box" });
    return () => observer.disconnect();
  }, [prompt]);

  return (
    <section className="welcome-view">
      <div className="mx-auto w-full max-w-[720px]">
        <header className="welcome-intro text-center">
          <p className="welcome-eyebrow mb-4 font-mono">Atelier Studio</p>
          <h1 className="text-[32px] font-medium leading-[1.15] tracking-[-0.02em] text-foreground sm:text-5xl">
            Welcome, <span className="text-accent">{name.split(" ")[0]}</span>
          </h1>
          <p className="mt-3 text-[17px] text-muted-foreground">What would you like to build today?</p>
        </header>
        <form
          className="welcome-card mt-6 lg:-mx-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && prompt.trim()) onStart(prompt.trim());
          }}
        >
          <textarea
            aria-label="Describe a website to start building"
            aria-describedby="welcome-input-hint"
            autoFocus
            className="welcome-input"
            maxLength={20_000}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Describe a website to start building…"
            ref={textarea}
            rows={3}
            value={prompt}
          />
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-5">
            <p className="font-mono text-[11px] leading-5 text-muted-foreground" id="welcome-input-hint">
              Enter to send · Shift+Enter for a new line
            </p>
            <Button className="welcome-submit ml-auto" aria-label="Send message" disabled={disabled || !prompt.trim()} type="submit" variant="primary">
              Start building
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 10h12m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
          </div>
        </form>
        <section className="welcome-templates" aria-label="Atelier templates">
          {!signedIn ? <p className="text-sm text-muted-foreground">Sign in to browse templates and start building.</p>
            : loadingTemplates ? <p className="text-sm text-muted-foreground" role="status">Loading templates…</p>
            : templateError ? <div>
              <p className="mb-3 text-sm text-muted-foreground" role="alert">{templateError}</p>
              <Button onClick={() => setAttempt((value) => value + 1)} size="sm">Retry templates</Button>
            </div>
            : !templates.length ? <p className="text-sm text-muted-foreground">Templates are coming soon. Start with your own idea above.</p>
            : <div className="grid gap-8">
            {templates.map((template) => (
              <button
                aria-label={`Use ${template.name} template`}
                className="welcome-template"
                disabled={disabled}
                key={template.id}
                onClick={() => void onUseTemplate(template.id)}
                type="button"
              >
                <TemplatePreview template={template} />
                <span className="welcome-template-caption">
                  <span className="font-display text-xl font-medium text-foreground">{template.name}</span>
                  <span className="shrink-0 font-mono text-xs text-accent">
                    {copyingTemplate === template.id ? "Creating your copy…" : "Use template →"}
                  </span>
                </span>
              </button>
            ))}
          </div>}
        </section>
      </div>
    </section>
  );
}

function TemplatePreview({ template }: { template: ProjectTemplate }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="welcome-template-preview">
      {template.previewImage && !failed ? (
        <img
          alt={`${template.name} homepage preview`}
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
          src={template.previewImage}
        />
      ) : <span className="text-sm text-muted-foreground">Preview unavailable</span>}
    </span>
  );
}
