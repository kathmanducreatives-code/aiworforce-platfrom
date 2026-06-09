import { Send, Sparkles, Mail, Bookmark, Download, RefreshCw, Plug, ArrowLeftRight } from 'lucide-react';

function prefill(text: string) {
  window.dispatchEvent(new CustomEvent('chat:prefill', { detail: text }));
}

interface Props {
  agentSlug?: string | null;
  status?: string;
}

export default function OutputActionBar({ agentSlug, status }: Props) {
  const failed = status === 'failed' || status === 'unavailable';
  const running = status === 'running' || status === 'queued';

  if (running) {
    return (
      <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06] text-[11px] text-[#7D8590]">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        Working… actions will appear when this step finishes.
      </div>
    );
  }

  const actions: { label: string; icon: any; prompt: string; disabled?: boolean; tone?: 'danger' }[] = [];

  if (failed) {
    actions.push(
      { label: 'Retry run', icon: RefreshCw, prompt: '@Pilot retry the last step', tone: 'danger' },
      { label: 'Reconnect tool', icon: Plug, prompt: '@Pilot help me reconnect the failed tool', tone: 'danger' },
      { label: 'Ask Pilot alternative', icon: Sparkles, prompt: '@Pilot suggest an alternative approach for this task', tone: 'danger' },
      { label: 'Switch sourcing', icon: ArrowLeftRight, prompt: '@Pilot use an alternative sourcing method', tone: 'danger' },
    );
  } else {
    if (agentSlug === 'scout' || agentSlug == null) {
      actions.push(
        { label: 'Send to Aria for ranking', icon: Sparkles, prompt: '@Aria please rank the latest Scout results by fit.' },
        { label: 'Enrich top 3', icon: Send, prompt: '@Hawk enrich the top 3 results from Scout with company intel.' },
        { label: 'Draft outreach', icon: Mail, prompt: '@Penn draft personalized outreach for the top Scout results.' },
      );
    }
    if (agentSlug === 'aria') {
      actions.push(
        { label: 'Draft outreach for Hot tier', icon: Mail, prompt: "@Penn draft outreach for Aria's Hot tier results." },
        { label: 'Enrich Hot leads', icon: Send, prompt: "@Hawk enrich Aria's Hot tier with company intel." },
      );
    }
    if (agentSlug === 'hawk') {
      actions.push(
        { label: 'Summarize for outreach', icon: Mail, prompt: "@Penn use Hawk's intel to draft outreach." },
      );
    }
    if (agentSlug === 'penn') {
      actions.push(
        { label: 'Refine tone', icon: Sparkles, prompt: '@Penn make the drafts shorter and more direct.' },
      );
    }
    actions.push(
      { label: 'Export results', icon: Download, prompt: '@Scribe export these results as a CSV.' },
      { label: 'Save to leads', icon: Bookmark, prompt: '', disabled: true },
    );
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-3 mt-1 border-t border-white/[0.06]">
      {actions.map((a) => {
        const Icon = a.icon;
        const danger = a.tone === 'danger';
        return (
          <button
            key={a.label}
            disabled={a.disabled}
            onClick={() => !a.disabled && prefill(a.prompt)}
            className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              danger
                ? 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200 hover:bg-amber-500/[0.12] hover:border-amber-500/40'
                : 'border-white/[0.08] bg-white/[0.03] text-[#C9D1D9] hover:bg-white/[0.06] hover:border-white/[0.14]'
            }`}
          >
            <Icon className="h-3 w-3" />
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
