import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ChatMarkdown, CopyButton } from "@/components/ChatMarkdown";
import { useConversation } from "@/hooks/useConversation";
import type { ChatOptions } from "@/integrations/studioApi";

const suggestions = [
  "A warm, editorial site for a neighborhood bakery",
  "A quiet, gallery-like portfolio for a ceramic artist",
  "A launch page for a tiny cabin in the woods",
];

interface AssistantPanelProps {
  collapsed: boolean;
  visible: boolean;
  onToggle: () => void;
  storageKey: string;
  blocked: boolean;
  modelStatus: string;
  onGenerate: (prompt: string, options: ChatOptions) => Promise<string[]>;
  onOpenFile: (path: string) => void;
  files: Record<string, string>;
}

export function AssistantPanel({
  collapsed, visible, onToggle, storageKey, blocked, modelStatus, onGenerate, onOpenFile, files,
}: AssistantPanelProps) {
  const chat = useConversation(storageKey, onGenerate);
  const [prompt, setPrompt] = useState("");
  const [editId, setEditId] = useState<string>();
  const [away, setAway] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastUser = chat.messages.filter((message) => message.role === "user").at(-1)?.id;

  function jumpToLatest() {
    following.current = true;
    setAway(false);
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input || !visible || collapsed) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [prompt, collapsed, visible]);

  useLayoutEffect(() => {
    if (following.current && visible && !collapsed) jumpToLatest();
  }, [chat.messages, collapsed, visible]);

  useEffect(() => {
    const element = log.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (following.current && element.clientHeight) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function send(value: string) {
    if (!value.trim() || chat.busy || blocked) return;
    chat.send(value, editId);
    setPrompt("");
    setEditId(undefined);
    textarea.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(prompt);
  }

  return (
    <aside aria-label="Build with Atelier" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-surface">
      <div className={`flex shrink-0 items-center border-b border-border py-4 ${collapsed ? "justify-center" : "justify-between gap-1 px-3"}`}>
        {!collapsed && <>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold">
              <span aria-hidden="true" className="mr-2 text-[#a34b36]">✳</span>Build with Atelier
            </h2>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">{modelStatus}</p>
          </div>
          <button
            aria-label="New chat"
            className="chat-action shrink-0"
            disabled={chat.busy || !chat.messages.length}
            onClick={() => {
              if (window.confirm("Clear this project's conversation and start a new chat? Project files will not change.")) {
                chat.clear();
                setEditId(undefined);
                setPrompt("");
                jumpToLatest();
                textarea.current?.focus();
              }
            }}
            type="button"
          >New chat</button>
        </>}
        <button aria-controls="chat-content" aria-expanded={!collapsed} aria-label="Toggle chat" className="panel-toggle" onClick={onToggle} title="Toggle chat" type="button">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            {collapsed ? <path d="M3 3h14v10H8l-5 4Zm3 4h8M6 10h5" /> : <path d="m12 4-6 6 6 6" />}
          </svg>
        </button>
      </div>
      <div className={collapsed ? "hidden" : "flex min-h-0 flex-1 flex-col"} id="chat-content">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions text"
            className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4"
            onScroll={() => {
              const element = log.current;
              if (!element?.clientHeight) return;
              const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
              following.current = atBottom;
              setAway(!atBottom);
            }}
            ref={log}
            role="log"
            tabIndex={0}
          >
            {chat.messages.length === 0 ? (
              <div className="py-6">
                <h1 className="font-display text-2xl font-semibold">What are we making?</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Start with a feeling, a business, or a half-formed idea. We’ll make it real.</p>
                <div className="mt-6 space-y-2">
                  {suggestions.map((suggestion) => (
                    <button aria-label={suggestion} className="w-full rounded-lg border border-border p-3 text-left text-xs leading-5 text-muted-foreground hover:border-accent hover:text-foreground disabled:opacity-50" disabled={blocked} key={suggestion} onClick={() => send(suggestion)} type="button">
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : chat.messages.map((message) => (
              <article aria-label={message.role === "user" ? "Your message" : "Atelier reply"} className={`chat-message group min-w-0 max-w-[94%] ${message.role === "user" ? "ml-auto" : "mr-auto"}`} key={message.id}>
                <div className={`min-w-0 break-words rounded-lg px-3 py-2.5 text-sm leading-6 ${message.role === "user" ? "whitespace-pre-wrap bg-foreground text-background" : "border border-border bg-background text-foreground"}`}>
                  {message.role === "assistant" && <span aria-label="Atelier" className="mb-1 block text-[#a34b36]">✳</span>}
                  {message.role === "user" ? message.content : <ChatMarkdown content={message.content} />}
                  {message.status === "streaming" && (
                    <div aria-label={message.content ? "Generating response" : "Atelier is typing"} className="flex items-center gap-1 py-2 text-xs text-muted-foreground" role="status">
                      <span className="sr-only">{message.content ? "Generating response" : "Atelier is typing"}</span>
                      {[0, 1, 2].map((dot) => <span aria-hidden="true" className="chat-typing-dot" key={dot} style={{ animationDelay: `${dot * 150}ms` }} />)}
                    </div>
                  )}
                  {message.status === "stopped" && <p className="text-xs text-muted-foreground">Response stopped. No pending changes were applied.</p>}
                  {message.error && <div className="mt-2 text-xs text-[#a34b36]" role="alert">
                    <p>{message.error}</p>
                    <button aria-label="Retry response" className="chat-action mt-1" disabled={chat.busy || blocked} onClick={() => chat.regenerate(message.id)} type="button">Retry</button>
                  </div>}
                  {!!message.changedFiles?.length && (
                    <div className="mt-3 rounded border border-border bg-surface p-2 text-xs">
                      <p className="mb-1 font-semibold">Changes applied</p>
                      {message.changedFiles.map((path) => (
                        <button
                          aria-label={`Open ${path} in Code view`}
                          className="block w-full break-all rounded px-1 py-1 text-left font-mono text-accent hover:bg-muted disabled:text-muted-foreground"
                          disabled={files[path] === undefined}
                          key={path}
                          onClick={() => onOpenFile(path)}
                          type="button"
                        >{path}{files[path] === undefined ? " (removed)" : ""}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground ${message.role === "user" ? "justify-end" : ""}`}>
                  <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
                  <div className="chat-message-actions flex flex-wrap items-center gap-1">
                    {message.role === "assistant" && message.status !== "streaming" && <>
                      {!!message.content && <CopyButton text={message.content} />}
                      <button aria-label="Regenerate reply" className="chat-action" disabled={chat.busy || blocked} onClick={() => chat.regenerate(message.id)} type="button">Regenerate</button>
                    </>}
                    {message.role === "user" && message.id === lastUser && <button
                      aria-label="Edit and resend message"
                      className="chat-action"
                      disabled={chat.busy || blocked}
                      onClick={() => { setEditId(message.id); setPrompt(message.content); textarea.current?.focus(); }}
                      type="button"
                    >Edit & resend</button>}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {away && <button aria-label="Jump to latest message" className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-2 text-xs shadow-sm hover:bg-muted" onClick={jumpToLatest} type="button">Jump to latest ↓</button>}
        </div>
        <form className="shrink-0 border-t border-border p-3" onSubmit={submit}>
          {chat.storageError && <p className="mb-2 text-xs text-[#a34b36]" role="alert">{chat.storageError}</p>}
          {editId && <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Editing your last message</span>
            <button aria-label="Cancel editing" className="chat-action" onClick={() => { setEditId(undefined); setPrompt(""); }} type="button">Cancel</button>
          </div>}
          <textarea
            aria-label="Describe a website or request a project page change"
            className="block min-h-16 w-full resize-none overflow-y-auto rounded-md border-0 bg-background px-3 py-2 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus:outline focus:outline-2 focus:outline-accent"
            maxLength={20_000}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Describe a website or ask for a change..."
            ref={textarea}
            rows={2}
            value={prompt}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] tracking-[.12em] text-muted-foreground">AZURE OPENAI · WEBSITE BUILDER</span>
            {chat.busy ? (
              <Button aria-label="Stop response" className="bg-[#a34b36] text-white hover:bg-[#893e2c]" onClick={chat.stop}>■</Button>
            ) : (
              <Button aria-label={editId ? "Resend message" : "Send message"} disabled={blocked || !prompt.trim()} type="submit" variant="primary">↑</Button>
            )}
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Chat saves in this browser, per project.</p>
        </form>
      </div>
    </aside>
  );
}
