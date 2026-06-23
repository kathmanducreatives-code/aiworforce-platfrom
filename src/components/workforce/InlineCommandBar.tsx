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
        'relative rounded-dock p-5',
        'bg-white/[0.03] border border-white/[0.08] backdrop-blur-2xl',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(16,185,129,0)]',
        'focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(16,185,129,0.4),0_0_38px_rgba(16,185,129,0.22)]',
        'transition-shadow',
      )}
    >
      <form onSubmit={onSubmit} className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-emerald-500/12 border border-emerald-500/35 flex items-center justify-center shrink-0">
          <Command className="h-[18px] w-[18px] text-emerald-300" />
        </div>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask Pilot to run a workflow…"
          className="flex-1 bg-transparent outline-none text-[15.5px] text-white placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="h-10 w-10 rounded-lg flex items-center justify-center bg-emerald-500/18 hover:bg-emerald-500/28 border border-emerald-500/35 text-emerald-200 disabled:opacity-30 transition-colors"
          aria-label="Send to Pilot"
        >
          <ArrowRight className="h-[18px] w-[18px]" />
        </button>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => run(c.prompt, c.route)}
            className="inline-flex items-center h-8 px-3 rounded-full text-[13px] font-medium text-neutral-200 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white border border-white/[0.07] transition-colors"
          >
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}
