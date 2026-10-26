import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import type { ProjectFiles } from "@/types";

interface PreviewPanelProps {
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
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(
    () => buildPreviewDocument(files, activeFile, content),
    [activeFile, content, files],
  );

  useEffect(() => {
    function handlePreviewNavigation(event: MessageEvent<unknown>) {
      if (event.source !== frameRef.current?.contentWindow) return;
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
      <div className="grid min-h-0 flex-1 grid-cols-[9rem_minmax(0,1fr)]">
        <aside
          aria-label="Project files"
          className="border-r border-border bg-background/50"
        >
          <div className="flex items-center justify-between px-3 py-3 text-xs font-semibold">
            Files
            <Button aria-label="Add file" onClick={onAddFile} size="sm">
              +
            </Button>
          </div>
          <ul className="space-y-0.5 px-2 pb-3">
            {Object.keys(files)
              .sort()
              .map((path) => (
                <li key={path}>
                  <button
                    className={`w-full truncate rounded px-2 py-1.5 text-left font-mono text-[11px] ${path === activeFile ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
                    onClick={() => onSelectFile(path)}
                    title={path}
                    type="button"
                  >
                    {path}
                  </button>
                </li>
              ))}
          </ul>
        </aside>
        <div className="flex min-w-0 flex-col bg-background">
          <div className="border-b border-border px-4 py-2 font-mono text-[11px] text-muted-foreground">
            {activeFile || entrypoint}
          </div>
          <div className="flex min-h-[24rem] flex-1 items-start justify-center overflow-auto bg-muted/50 p-3 md:p-5">
            {mode === "preview" ? (
              <iframe
                ref={frameRef}
                className={`min-h-[24rem] flex-1 border border-border bg-white shadow-sm transition-[max-width] ${deviceWidth[device]}`}
                sandbox="allow-scripts"
                srcDoc={srcDoc}
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
              <Button onClick={onApply} variant="primary">
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
