import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "info" | "danger" | "muted";

export function StatusPill({
  label,
  tone = "neutral",
  className,
  title,
}: {
  label: string;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  const toneClass: Record<Tone, string> = {
    neutral: "bg-muted/40 text-foreground border-border/60",
    success: "bg-primary/10 text-primary border-primary/30",
    warning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    info: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    danger: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    muted: "bg-transparent text-muted-foreground border-border/40",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
