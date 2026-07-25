import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "info" | "danger" | "muted";

const TONE: Record<Tone, string> = {
  neutral: "bg-white/[0.04] text-foreground/90 border-white/10",
  success:
    "bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04))] text-primary border-primary/30 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.08)]",
  warning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  info: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  danger: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  muted: "bg-transparent text-muted-foreground border-white/[0.08]",
};

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
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-none whitespace-nowrap backdrop-blur-sm",
        TONE[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

