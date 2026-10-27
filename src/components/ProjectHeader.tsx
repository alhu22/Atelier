import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CanvasMode, DeviceSize } from "@/components/PreviewPanel";
import { useProjectName } from "@/hooks/useStudio";
import type { StudioProject } from "@/types";

interface ProjectHeaderProps {
  project: StudioProject;
  saved: boolean;
  mode: CanvasMode;
  device: DeviceSize;
  onModeChange: (mode: CanvasMode) => void;
  onDeviceChange: (device: DeviceSize) => void;
  signedIn: boolean;
  onRename: () => void;
  onSignIn: () => void;
  onGitHub: () => void;
  onDownload: () => void;
}

export function ProjectHeader({
  project,
  saved,
  mode,
  device,
  onModeChange,
  onDeviceChange,
  signedIn,
  onRename,
  onSignIn,
  onGitHub,
  onDownload,
}: ProjectHeaderProps) {
  const name = useProjectName(project);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const deviceButton = useRef<HTMLButtonElement>(null);
  return (
    <header className="project-header flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 md:px-7">
      <div className="flex min-w-0 flex-[1_1_24rem] items-center gap-2 text-sm">
        <span className="hidden text-muted-foreground sm:inline">Projects /</span>
        <button
          className="flex min-w-0 max-w-52 items-center gap-1 font-semibold hover:text-accent"
          onClick={onRename}
          title="Rename project"
          type="button"
        >
          <span className="truncate">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">✎</span>
        </button>
        <span className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:inline-flex">
          <i className={`size-1.5 rounded-full ${saved ? "bg-emerald-500" : "bg-amber-500"}`} />
          {saved ? "Saved" : "Saving…"}
        </span>
        <div aria-label="Editor view" className="flex shrink-0 items-center gap-1 rounded-md bg-muted p-1">
          {(["preview", "code"] as const).map((item) => (
            <button
              aria-pressed={mode === item}
              className={`rounded px-3 py-1.5 text-xs capitalize ${mode === item ? "bg-surface font-semibold shadow-sm" : "text-muted-foreground"}`}
              key={item}
              onClick={() => { onModeChange(item); setDevicesOpen(false); }}
              type="button"
            >{item}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {mode === "preview" && <div
          className="relative"
          onPointerEnter={(event) => { if (event.pointerType === "mouse") setDevicesOpen(true); }}
          onPointerLeave={(event) => { if (event.pointerType === "mouse") setDevicesOpen(false); }}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDevicesOpen(false); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDevicesOpen(false);
              deviceButton.current?.focus();
              event.stopPropagation();
            }
          }}
        >
          <button
            aria-label={deviceNames[device]}
            aria-controls="preview-devices"
            aria-expanded={devicesOpen}
            className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => setDevicesOpen(true)}
            ref={deviceButton}
            title={deviceNames[device]}
            type="button"
          ><DeviceIcon device={device} /></button>
          {devicesOpen && <div className="absolute left-0 top-full z-20 pt-1">
            <div aria-label="Preview devices" className="flex gap-1 rounded-md border border-border bg-surface p-1 shadow-lg" id="preview-devices" role="group">
              {(["desktop", "tablet", "mobile"] as const).map((item) => (
                <button
                  aria-label={deviceNames[item]}
                  aria-pressed={device === item}
                  className={`flex size-9 items-center justify-center rounded hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${device === item ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                  key={item}
                  onClick={() => { onDeviceChange(item); setDevicesOpen(false); deviceButton.current?.focus(); }}
                  title={deviceNames[item]}
                  type="button"
                ><DeviceIcon device={item} /></button>
              ))}
            </div>
          </div>}
        </div>}
        <Button onClick={onSignIn} size="sm">
          {signedIn ? "Sign out" : "Sign in with Google"}
        </Button>
        <Button onClick={onGitHub} size="sm">
          GitHub
        </Button>
        <Button onClick={onDownload} size="sm" variant="primary">
          ↓ ZIP
        </Button>
      </div>
    </header>
  );
}

const deviceNames: Record<DeviceSize, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

function DeviceIcon({ device }: { device: DeviceSize }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {device === "desktop" ? <>
        <rect x="3" y="3" width="18" height="13" rx="2" />
        <path d="M12 16v5M8 21h8" />
      </> : <>
        <rect x={device === "tablet" ? 4 : 6} y="2" width={device === "tablet" ? 16 : 12} height="20" rx="2" />
        <path d="M11 18h2" />
      </>}
    </svg>
  );
}
