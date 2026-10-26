interface StatusMessageProps {
  message: string;
  tone?: "error" | "info" | "success";
  onDismiss?: () => void;
}

const toneClasses = {
  error: "border-red-300 bg-red-50 text-red-900",
  info: "border-border bg-muted text-foreground",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
};

export function StatusMessage({
  message,
  tone = "info",
  onDismiss,
}: StatusMessageProps) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${toneClasses[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          aria-label="Dismiss message"
          className="font-semibold"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      )}
    </div>
  );
}
