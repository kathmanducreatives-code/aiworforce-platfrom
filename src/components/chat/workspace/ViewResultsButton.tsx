import { ArrowRight } from 'lucide-react';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import type { WorkbenchArtifact } from '@/lib/workbenchArtifacts';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<WorkbenchArtifact['status'], { text: string; tone: string }> = {
  running:  { text: 'Running', tone: 'text-sky-300 bg-sky-500/10 border-sky-500/20' },
  complete: { text: 'Complete', tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' },
  partial:  { text: 'Partial', tone: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  failed:   { text: 'Failed', tone: 'text-rose-300 bg-rose-500/10 border-rose-500/25' },
  blocked:  { text: 'Blocked', tone: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
};

export default function ViewResultsButton({
  artifact,
  className,
}: {
  artifact: WorkbenchArtifact;
  className?: string;
}) {
  const { openArtifact, activeArtifactId, workbenchOpen } = useChatWorkspace();
  const active = workbenchOpen && activeArtifactId === artifact.id;
  const status = STATUS_LABEL[artifact.status];
  return (
    <button
      type="button"
      onClick={() => openArtifact(artifact.id)}
      className={cn(
        'mt-2 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] transition-colors',
        active
          ? 'border-emerald-400/50 bg-emerald-500/[0.12] text-emerald-100'
          : 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200 hover:bg-emerald-500/[0.12] hover:border-emerald-400/40',
        className,
      )}
      aria-label={`View results: ${artifact.title}`}
    >
      <ArrowRight className="h-3.5 w-3.5" />
      <span className="font-medium">View results</span>
      <span className="opacity-60">·</span>
      <span className="truncate max-w-[280px]">{artifact.title}</span>
      <span className={cn('ml-1 text-[10px] px-1.5 py-0.5 rounded border', status.tone)}>
        {status.text}
      </span>
    </button>
  );
}
