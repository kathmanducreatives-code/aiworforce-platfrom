interface Props { status: string; }

const STATUS_TONE: Record<string, string> = {
  planning: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  running: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  executing: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  awaiting_approval: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  complete: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  partial: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  failed: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  stale: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/25',
};

export default function PlanStatusPill({ status }: Props) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.planning;
  const live = status === 'running' || status === 'executing' || status === 'planning';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border capitalize ${tone}`}>
      {live && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-50 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {status.replace(/_/g, ' ')}
    </span>
  );
}
