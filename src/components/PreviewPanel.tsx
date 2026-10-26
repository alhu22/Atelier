import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import type { ProjectFiles } from "@/types";
import { useProjectPreview } from "@/hooks/useProjectPreview";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { FileTree } from "@/components/FileTree";

interface PreviewPanelProps {
  codeRequest?: { path: string };
  files: ProjectFiles;
  entrypoint: string;
  activeFile: string;
  content: string;
  onSelectFile: (path: string) => void;
  onContentChange: (value: string) => void;
  onApply: () => void;
  onAddFile: () => void;
}

type CanvasMode = "preview" | "code";
type DeviceSize = "desktop" | "tablet" | "mobile";

export function PreviewPanel({
  codeRequest,
  files,
  entrypoint,
  activeFile,
  content,
  onSelectFile,
  onContentChange,
  onApply,
  onAddFile,
}: PreviewPanelProps) {
  const [mode, setMode] = useState<CanvasMode>("preview");
  useEffect(() => {
    if (codeRequest) setMode("code");
  }, [codeRequest]);
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const [filesCollapsed, setFilesCollapsed] = useState(() => {
    try {
      return localStorage.getItem("atelier-files-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [frameHeight, setFrameHeight] = useState(384);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const compiled = useProjectPreview(files, entrypoint);
  const srcDoc = useMemo(
    () => withPreviewSizing(compiled.reactProject ? compiled.html : buildPreviewDocument(files, activeFile, content)),
    [activeFile, content, files, compiled.reactProject, compiled.html],
  );

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
    <section className="flex min-h-[28rem] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1 rounded-md bg-muted p-1">
          {(["preview", "code"] as const).map((item) => (
            <button
              aria-pressed={mode === item}
              className={`rounded px-3 py-1.5 text-xs capitalize ${mode === item ? "bg-surface font-semibold shadow-sm" : "text-muted-foreground"}`}
              key={item}
              onClick={() => setMode(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div aria-label="Preview size" className="flex gap-1">
          {(["desktop", "tablet", "mobile"] as const).map((item) => (
            <button
              aria-pressed={device === item}
              className={`rounded px-2 py-1.5 text-xs capitalize ${device === item ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
              key={item}
              onClick={() => setDevice(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div
        className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-in-out motion-reduce:transition-none"
        style={{ gridTemplateColumns: `${filesCollapsed ? "40px" : "min(14rem, 42%)"} minmax(0, 1fr)` }}
      >
        <aside
          aria-label="Project files"
          className="min-w-0 overflow-hidden border-r border-border bg-background/50"
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
          <div className="border-b border-border px-4 py-2 font-mono text-[11px] text-muted-foreground">
            {activeFile || entrypoint}
          </div>
          <div className="flex min-h-[24rem] min-w-0 flex-1 items-start justify-center bg-muted/50 p-3 md:p-5">
            {mode === "preview" && compiled.loading ? (
              <p role="status" className="p-5 text-sm text-muted-foreground">Compiling React preview…</p>
            ) : mode === "preview" && compiled.error ? (
              <StatusMessage message={compiled.error} tone="error" />
            ) : mode === "preview" ? (
              <iframe
                ref={frameRef}
                className={`min-h-[24rem] min-w-0 flex-1 border-0 bg-white shadow-sm transition-[max-width] ${deviceWidth[device]}`}
                sandbox="allow-scripts"
                srcDoc={srcDoc}
                style={{ height: frameHeight }}
                title="Website preview"
              />
            ) : (
              <Textarea
                aria-label="Selected project file source"
                className="min-h-[24rem] flex-1 resize-none rounded-none border-0 bg-[#202321] p-5 font-mono text-xs leading-relaxed text-[#e9e9e5] focus:ring-0"
                onChange={(event) => onContentChange(event.target.value)}
                spellCheck={false}
                value={content}
              />
            )}
          </div>
          {mode === "code" && (
            <div className="flex justify-end border-t border-border p-2">
              <Button onClick={() => { onApply(); setMode("preview"); }} variant="primary">
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
