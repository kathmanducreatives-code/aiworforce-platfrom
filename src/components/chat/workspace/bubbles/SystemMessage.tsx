interface Props { text: string }
export default function SystemMessage({ text }: Props) {
  return (
    <div className="flex items-center justify-center gap-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground/70">
      <span className="h-px w-12 bg-border/60" />
      {text}
      <span className="h-px w-12 bg-border/60" />
    </div>
  );
}
