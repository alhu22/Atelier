import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const suggestions = [
  "A warm, editorial site for a neighborhood bakery",
  "A quiet, gallery-like portfolio for a ceramic artist",
  "A launch page for a tiny cabin in the woods",
];

interface AssistantPanelProps {
  messages: ConversationMessage[];
  busy: boolean;
  modelStatus: string;
  onSubmit: (prompt: string) => Promise<void>;
}

export function AssistantPanel({
  messages,
  busy,
  modelStatus,
  onSubmit,
}: AssistantPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || busy) return;
    setPrompt("");
    await onSubmit(value);
  }

  return (
    <aside className="flex min-h-[25rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface lg:h-[calc(100dvh-8rem)]">
      <button
        aria-expanded={!collapsed}
        className="flex items-center justify-between border-b border-border px-4 py-4 text-left"
        onClick={() => setCollapsed((current) => !current)}
        type="button"
      >
        <span className="font-display text-sm font-semibold">
          <span className="mr-2 text-accent">✳</span>Build with Atelier
        </span>
        <span className="max-w-40 truncate text-[10px] text-muted-foreground">
          {modelStatus}
        </span>
      </button>
      {!collapsed && (
      <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="py-6">
            <h1 className="font-display text-2xl font-semibold">
              What are we making?
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Start with a feeling, a business, or a half-formed idea. We’ll make
              it real.
            </p>
            <div className="mt-6 space-y-2">
              {suggestions.map((suggestion) => (
                <button
                  className="w-full rounded-lg border border-border p-3 text-left text-xs leading-5 text-muted-foreground hover:border-accent hover:text-foreground"
                  key={suggestion}
                  onClick={() => setPrompt(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              className={`max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2.5 text-sm leading-6 ${message.role === "user" ? "ml-auto bg-foreground text-background" : "bg-muted text-foreground"}`}
              key={message.id}
            >
              {message.content}
            </div>
          ))
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            Designing <span className="typing-dots">•••</span>
          </div>
        )}
      </div>
      <form className="border-t border-border p-3" onSubmit={submit}>
        <Textarea
          aria-label="Describe a website or request a project page change"
          className="min-h-24 border-0 bg-background focus:ring-0"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Add an about page, update a specific page, or describe a website..."
          value={prompt}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-[.16em] text-muted-foreground">
            AZURE OPENAI · WEBSITE BUILDER
          </span>
          <Button
            aria-label="Generate website"
            disabled={busy || !prompt.trim()}
            type="submit"
            variant="primary"
          >
            ↑
          </Button>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Projects save in this browser. Sign in to sync your current project.
        </p>
      </form>
      </>
      )}
    </aside>
  );
}
