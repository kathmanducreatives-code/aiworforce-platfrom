import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const CHIPS: { label: string; prompt: string; route?: string }[] = [
  { label: 'Find hot leads', prompt: 'Find hot leads from hiring and intent signals.', route: '/signals' },
  { label: 'Draft outreach', prompt: 'Draft outreach for my highest-priority saved leads.' },
  { label: 'Summarize pipeline', prompt: 'Summarize my pipeline this week.' },
  { label: 'Review approvals', prompt: 'Show me what needs my approval.', route: '/awaiting-you' },
  { label: 'Research competitors', prompt: 'What are my competitors doing this week?', route: '/competitors' },
];

export default function InlineCommandBar() {
  const [value, setValue] = useState('');
  const navigate = useNavigate();

  const run = (text: string, route?: string) => {
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text } }));
    if (route) navigate(route);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    run(value.trim());
    setValue('');
  };

  return (
    <section
      className={cn(
        'relative rounded-2xl p-4',
        'bg-white/[0.025] border border-white/[0.08] backdrop-blur-2xl',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(16,185,129,0)]',
        'focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(16,185,129,0.35),0_0_32px_rgba(16,185,129,0.18)]',
        'transition-shadow',
      )}
    >
      <form onSubmit={onSubmit} className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <Command className="h-4 w-4 text-emerald-400" />
        </div>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask Pilot to run a workflow…"
          className="flex-1 bg-transparent outline-none text-[14px] text-white placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 disabled:opacity-30"
          aria-label="Send to Pilot"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => run(c.prompt, c.route)}
            className="inline-flex items-center h-7 px-2.5 rounded-full text-[11px] text-neutral-300 bg-white/[0.03] hover:bg-white/[0.07] hover:text-white border border-white/[0.06] transition-colors"
          >
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}
