import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  className = "",
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      className={`w-[min(92vw,36rem)] rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/35 ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export function DialogHeading({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-4">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <button
        aria-label="Close dialog"
        className="rounded-md px-2 py-1 text-xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onClose}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
