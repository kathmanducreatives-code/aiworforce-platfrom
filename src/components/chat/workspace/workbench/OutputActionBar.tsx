import { Send, Sparkles, Mail, Bookmark } from 'lucide-react';

function prefill(text: string) {
  window.dispatchEvent(new CustomEvent('chat:prefill', { detail: text }));
}

export default function OutputActionBar({ agentSlug }: { agentSlug?: string | null }) {
  const actions: { label: string; icon: any; prompt: string; disabled?: boolean }[] = [];

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
  actions.push({ label: 'Save to leads', icon: Bookmark, prompt: '', disabled: true });

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-white/[0.06]">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.label}
            disabled={a.disabled}
            onClick={() => !a.disabled && prefill(a.prompt)}
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-[#C9D1D9] hover:bg-white/[0.06] hover:border-white/[0.14] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Icon className="h-3 w-3" />
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
