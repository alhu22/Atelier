export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-display font-extrabold tracking-[.12em]">
      <span aria-hidden="true" className="brand-mark" />
      atelier
      {!compact && (
        <span className="ml-1 font-mono text-[9px] font-medium tracking-[.2em] text-muted-foreground">
          STUDIO
        </span>
      )}
    </span>
  );
}
