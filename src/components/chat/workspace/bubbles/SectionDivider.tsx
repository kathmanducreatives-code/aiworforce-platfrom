interface Props {
  label: string;
  ts?: string | null;
}

export default function SectionDivider({ label, ts }: Props) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-500/20 to-emerald-500/5" />
      <span className="text-[10px] uppercase tracking-widest text-emerald-300/80 font-semibold">
        {label}
      </span>
      {ts && (
        <span className="text-[10px] text-muted-foreground/70">
          {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-emerald-500/20 to-emerald-500/5" />
    </div>
  );
}
