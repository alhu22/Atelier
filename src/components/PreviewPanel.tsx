import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import type { ProjectFiles } from "@/types";
import { useProjectPreview } from "@/hooks/useProjectPreview";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { FileTree } from "@/components/FileTree";
import { BuildingPreview } from "@/components/BuildingPreview";
import type { PreviewConversation } from "@/components/AssistantPanel";

interface PreviewPanelProps {
  conversation?: PreviewConversation;
  generated?: boolean;
  mode: CanvasMode;
  device: DeviceSize;
  onModeChange: (mode: CanvasMode) => void;
  files: ProjectFiles;
  entrypoint: string;
  activeFile: string;
  content: string;
  onSelectFile: (path: string) => void;
  onContentChange: (value: string) => void;
  onApply: () => void;
  onAddFile: () => void;
}

export type CanvasMode = "preview" | "code";
export type DeviceSize = "desktop" | "tablet" | "mobile";

export function PreviewPanel({
  conversation,
  generated = false,
  mode,
  device,
  onModeChange,
  files,
  entrypoint,
  activeFile,
  content,
  onSelectFile,
  onContentChange,
  onApply,
  onAddFile,
}: PreviewPanelProps) {
  const [filesCollapsed, setFilesCollapsed] = useState(() => {
    try {
      return localStorage.getItem("atelier-files-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [frameHeight, setFrameHeight] = useState(384);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hasPrompt = !!conversation?.prompt;
  const compiled = useProjectPreview(files, entrypoint, generated || !hasPrompt);
  const srcDoc = useMemo(
    () => withPreviewSizing(compiled.reactProject ? compiled.html : buildPreviewDocument(files, activeFile, content)),
    [activeFile, content, files, compiled.reactProject, compiled.html],
  );
  const [lastLiveDocument, setLastLiveDocument] = useState("");
  const startedWithoutVersion = useRef(!generated);
  const nextLiveDocument = generated && compiled.ready ? srcDoc : "";
  const liveDocument = nextLiveDocument || lastLiveDocument;
  const building = hasPrompt && !liveDocument && (!generated || startedWithoutVersion.current);
  const [buildingSeen, setBuildingSeen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [transitionDone, setTransitionDone] = useState(false);
  const buildFailed = !!conversation && (
    conversation.failed ||
    (conversation.settled && !conversation.busy && !generated) ||
    (!!compiled.error && !conversation.busy)
  );

  useLayoutEffect(() => {
    if (nextLiveDocument) setLastLiveDocument(nextLiveDocument);
  }, [nextLiveDocument]);

  useLayoutEffect(() => {
    if (building) {
      setBuildingSeen(true);
      setRevealed(false);
      setTransitionDone(false);
    } else if (!hasPrompt && !liveDocument) {
      setBuildingSeen(false);
      setRevealed(false);
    }
  }, [building, hasPrompt, liveDocument]);

  useEffect(() => {
    if (!revealed || !buildingSeen) return;
    const timer = window.setTimeout(() => setTransitionDone(true), 300);
    return () => window.clearTimeout(timer);
  }, [revealed, buildingSeen]);

  useEffect(() => {
    try {
      localStorage.setItem("atelier-files-collapsed", String(filesCollapsed));
    } catch {
      // The panel remains usable when browser storage is unavailable.
    }
  }, [filesCollapsed]);

  useEffect(() => setFrameHeight(384), [srcDoc]);

  useEffect(() => {
    function handlePreviewNavigation(event: MessageEvent<unknown>) {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (
        typeof event.data === "object" && event.data !== null &&
        "type" in event.data && event.data.type === "atelier-height" &&
        "height" in event.data && typeof event.data.height === "number" &&
        Number.isFinite(event.data.height)
      ) {
        setFrameHeight(Math.max(384, Math.min(100_000, event.data.height)));
        return;
      }
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "atelier-page" &&
        "path" in event.data &&
        typeof event.data.path === "string" &&
        files[event.data.path] !== undefined
      ) {
        onSelectFile(event.data.path);
      }
    }
    window.addEventListener("message", handlePreviewNavigation);
    return () => window.removeEventListener("message", handlePreviewNavigation);
  }, [files, onSelectFile]);

  return (
    <section className="project-preview relative flex min-h-[28rem] flex-1 flex-col overflow-hidden bg-surface">
      {mode === "preview" && (liveDocument || (generated && !startedWithoutVersion.current)) && (conversation?.busy || compiled.loading) && (
        <span role="status" className="pointer-events-none absolute right-3 top-3 z-10 rounded-full border border-accent/25 bg-surface px-3 py-1 text-xs text-accent">Updating…</span>
      )}
      <div
        className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-in-out motion-reduce:transition-none"
        style={{ gridTemplateColumns: mode === "code" ? `${filesCollapsed ? "40px" : "min(14rem, 42%)"} minmax(0, 1fr)` : "minmax(0, 1fr)" }}
      >
        <aside
          aria-label="Project files"
          className="min-w-0 overflow-hidden border-r border-border bg-background/50"
          hidden={mode !== "code"}
        >
          <div className={`flex items-center gap-1 py-3 text-xs font-semibold ${filesCollapsed ? "justify-center" : "px-2"}`}>
            {!filesCollapsed && <span className="mr-auto">Files</span>}
            {!filesCollapsed && <Button aria-label="Add file" onClick={onAddFile} size="sm">+</Button>}
            <button
              aria-controls="project-file-tree"
              aria-expanded={!filesCollapsed}
              aria-label="Toggle files panel"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => setFilesCollapsed((current) => !current)}
              type="button"
            >
              <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 20 20" width="18">
                <rect height="14" rx="2" width="16" x="2" y="3" />
                <path d="M7 3v14" />
                <path d={filesCollapsed ? "m11 7 3 3-3 3" : "m14 7-3 3 3 3"} />
              </svg>
            </button>
          </div>
          <div hidden={filesCollapsed} id="project-file-tree">
            <FileTree activeFile={activeFile} files={files} onSelectFile={onSelectFile} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-col bg-background">
          {mode === "preview" && liveDocument && compiled.error && <StatusMessage message={compiled.error} tone="error" />}
          <div className="preview-canvas bg-muted/50">
            {mode === "preview" && !building && !liveDocument && compiled.loading ? (
              <p role="status" className="p-5 text-sm text-muted-foreground">Compiling React preview…</p>
            ) : mode === "preview" && !building && !liveDocument && compiled.error ? (
              <StatusMessage message={compiled.error} tone="error" />
            ) : mode === "preview" && !building ? (
              <iframe
                ref={frameRef}
                className={`preview-live border-0 bg-white shadow-sm ${deviceWidth[device]} ${buildingSeen ? `preview-reveal ${revealed ? "is-ready" : ""}` : ""}`}
                sandbox="allow-scripts"
                srcDoc={liveDocument || srcDoc}
                style={{ height: frameHeight }}
                title="Website preview"
                onLoad={() => { if (liveDocument) setRevealed(true); }}
              />
            ) : mode === "code" ? (
              <Textarea
                aria-label="Selected project file source"
                className="min-h-[24rem] flex-1 resize-none rounded-none border-0 bg-surface p-5 font-mono text-xs leading-relaxed text-foreground focus:ring-0"
                onChange={(event) => onContentChange(event.target.value)}
                spellCheck={false}
                value={content}
              />
            ) : null}
            {mode === "preview" && conversation && (building || (buildingSeen && !transitionDone)) && (
              <div
                aria-hidden={revealed || undefined}
                className={`preview-building-layer ${deviceWidth[device]} ${revealed ? "is-leaving" : ""}`}
                inert={revealed}
              >
                <BuildingPreview conversation={conversation} assembling={generated && !conversation.busy} failed={buildFailed} />
              </div>
            )}
          </div>
          {mode === "code" && (
            <div className="flex justify-end border-t border-border p-2">
              <Button onClick={() => { onApply(); onModeChange("preview"); }} variant="primary">
                Apply changes
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const deviceWidth: Record<DeviceSize, string> = {
  desktop: "max-w-full",
  tablet: "max-w-[768px]",
  mobile: "max-w-[390px]",
};

function withPreviewSizing(html: string): string {
  const bridge = `<script>(() => {
    let queued = false;
    const measure = () => {
      if (queued) return;
      queued = true;
      window.setTimeout(() => {
        queued = false;
        const body = document.body;
        const height = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().bottom + scrollY) + parseFloat(getComputedStyle(body).marginBottom || "0"));
        parent.postMessage({ type: "atelier-height", height }, "*");
      });
    };
    new ResizeObserver(measure).observe(document.body);
    window.addEventListener("load", measure);
    window.addEventListener("resize", measure);
    document.fonts.ready.then(measure);
    measure();
  })();</script>`;
  return html.replace(/<\/body\s*>/i, `${bridge}</body>`);
}

function buildPreviewDocument(
  files: ProjectFiles,
  activeFile: string,
  content: string,
): string {
  if (!activeFile.toLowerCase().endsWith(".html")) {
    return `<!doctype html><html><body><pre>${escapeHtml(content)}</pre></body></html>`;
  }
  const parser = new DOMParser();
  const document = parser.parseFromString(content, "text/html");
  const basePath = activeFile.slice(0, activeFile.lastIndexOf("/") + 1);
  for (const link of [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')]) {
    const path = resolveFilePath(basePath, link.getAttribute("href") ?? "");
    const stylesheet = files[path];
    if (stylesheet === undefined) continue;
    const style = document.createElement("style");
    style.textContent = stylesheet;
    link.replaceWith(style);
  }
  for (const script of [...document.querySelectorAll<HTMLScriptElement>("script[src]")]) {
    const path = resolveFilePath(basePath, script.getAttribute("src") ?? "");
    const source = files[path];
    if (source === undefined) continue;
    const inlineScript = document.createElement("script");
    inlineScript.textContent = source;
    script.replaceWith(inlineScript);
  }
  const base = document.createElement("base");
  base.href = `https://atelier.local/${activeFile}`;
  document.head.prepend(base);
  const bridge = document.createElement("script");
  bridge.textContent = `document.addEventListener("click",event=>{const anchor=event.target instanceof Element?event.target.closest("a[href]"):null;if(!anchor)return;const url=new URL(anchor.href,location.href);if(url.origin!=="https://atelier.local")return;const path=decodeURIComponent(url.pathname.replace(/^\\//,""))||"index.html";if(path==="${escapeScriptString(activeFile)}")return;event.preventDefault();parent.postMessage({type:"atelier-page",path},"*")});`;
  document.body.append(bridge);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

function resolveFilePath(base: string, relativePath: string): string {
  try {
    const resolved = new URL(relativePath, `https://atelier.local/${base}`);
    if (resolved.origin !== "https://atelier.local") return "";
    return decodeURIComponent(resolved.pathname.slice(1));
  } catch {
    return "";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
