import { useMemo, useState } from 'react';
import { ArrowUpRight, Check, RefreshCw } from 'lucide-react';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { toSavedBrainView } from '@/lib/companyBrainView';
import { cn } from '@/lib/utils';

const CATEGORIES = ['For you', 'Research', 'Signals', 'Outreach', 'Content'] as const;
type Category = typeof CATEGORIES[number];
interface Idea { title: string; detail: string; prompt: string; category: Category }
interface Props { onPickPrompt?: (text: string) => void }

export default function EmptyState({ onPickPrompt }: Props) {
  const { data, loading, error } = useCompanyBrain();
  const [category, setCategory] = useState<Category>('For you');
  const [round, setRound] = useState(0);
  const [selected, setSelected] = useState('');
  const brain = useMemo(() => toSavedBrainView(data?.profile).brain, [data?.profile]);
  // `CompanyBrainV2` keeps industries on `target_customer` (a legacy profile's
  // `icp.industries` is folded in by `normalizeCompanyBrain`). It has no `icp`
  // field, so reading one threw on every render and the chat showed "Chat hit an
  // error" (2026-09-26).
  const industry = brain.target_customer.industries[0]?.trim();
  const persona = brain.buyer_personas[0]?.trim();
  const audience = industry || 'our target market';
  const buyer = persona || 'our ideal buyer';
  const ideas: Idea[] = [
    { category: 'Research', title: `Find opportunities in ${audience}`, detail: 'Company fit · evidence · next step', prompt: `Research 5 companies in ${audience} against our saved ICP. Explain fit, exclusions, evidence and the next action for each. Flag anything you cannot verify.` },
    { category: 'Research', title: 'Pressure-test our ideal customer', detail: 'Sharpen the assumptions behind our targeting', prompt: 'Review our Company Brain targeting. Identify unclear criteria, missing exclusions and three questions that would improve qualification.' },
    { category: 'Research', title: `Understand ${buyer}`, detail: 'Priorities · pain points · buying context', prompt: `Build a brief for ${buyer} using our Company Brain. Separate saved facts from assumptions and suggest questions to validate gaps.` },
    { category: 'Signals', title: 'Find changes worth acting on', detail: 'Timing backed by sources', prompt: 'Review available recent buying signals for our target market. Explain what changed, why it matters, source dates and next actions. If none are available, say so.' },
    { category: 'Signals', title: 'Define our strongest buying moments', detail: 'Turn company context into monitoring priorities', prompt: 'Using our Company Brain, suggest three buying signals relevant to our ICP. Explain the evidence required and what would make each misleading.' },
    { category: 'Signals', title: 'Separate signal from noise', detail: 'Review relevance before taking action', prompt: 'Review available signals against our ICP and exclusions. Separate relevant changes from noise, cite evidence and flag anything needing verification.' },
    { category: 'Outreach', title: `Start a conversation with ${buyer}`, detail: 'A relevant, evidence-led first message', prompt: `Help draft a concise first message for ${buyer}. Use our saved positioning, ask me to choose an account, and personalize only with verified evidence. Prepare a draft for review; do not send.` },
    { category: 'Outreach', title: 'Make a follow-up worth replying to', detail: 'Add value without repeating yourself', prompt: 'Ask for my original message and account context, then draft a short, useful follow-up with a clear reason to reply. Do not send it.' },
    { category: 'Outreach', title: 'Review a message before it goes out', detail: 'Relevance · clarity · credibility', prompt: 'Ask me to paste an outreach draft, then review relevance, unsupported claims and clarity. Suggest a shorter version in our company voice. Do not send anything.' },
    { category: 'Content', title: `Turn ${audience} insights into a post`, detail: 'A focused idea in your company voice', prompt: `Suggest three LinkedIn post angles relevant to ${audience}, using our saved positioning and brand voice. Ask me to choose before drafting. Do not invent customer results or publish.` },
    { category: 'Content', title: 'Build a week of useful content', detail: 'Five angles with a clear audience and purpose', prompt: 'Plan five posts using our Company Brain content angles and buyer personas. Give each a hook, audience and evidence needed. Keep this as a plan for review.' },
    { category: 'Content', title: 'Turn one insight into three formats', detail: 'Post · short article · email draft', prompt: 'Ask for one company insight or source, then suggest how to adapt it into a LinkedIn post, short article and email draft in our brand voice. Do not publish or send.' },
  ];
  const visible = category === 'For you'
    ? CATEGORIES.slice(1).map((item) => ideas.filter((s) => s.category === item)[round % 3])
    : ideas.filter((s) => s.category === category);
  const pick = (idea: Idea) => {
    setSelected(idea.title);
    if (onPickPrompt) onPickPrompt(idea.prompt);
    else window.dispatchEvent(new CustomEvent('chat:prefill', { detail: idea.prompt }));
  };
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Your workforce is ready</div>
        <h2 className="mt-3 text-[clamp(24px,4vw,32px)] font-medium leading-tight tracking-tight text-foreground">What should we move forward?</h2>
        <p className="mt-3 max-w-[560px] text-sm leading-relaxed text-muted-foreground">Start with a direction. Your team can help research, find signals, and turn the right insight into action.</p>
        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Suggestion categories">
          {CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => { setCategory(item); setSelected(''); }} className={cn('rounded-full border px-3 py-1.5 text-xs transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400', category === item ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-white/[0.07] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground')}>{item}</button>)}
        </div>
        <div className="mb-2 mt-6 flex min-h-8 items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{loading ? 'Starter ideas · loading company context' : error ? 'Starter ideas · company context unavailable' : industry || persona ? 'Inspired by your Company Brain' : 'A few places to start'}</p>
          {category === 'For you' && <button type="button" onClick={() => { setRound((value) => value + 1); setSelected(''); }} className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"><RefreshCw size={12} />More ideas</button>}
        </div>
        <ul className="divide-y divide-white/[0.06]">
          {visible.map((idea) => <li key={idea.title}><button type="button" onClick={() => pick(idea)} className="group flex w-full items-center gap-4 rounded-lg px-3 py-4 text-left transition-colors hover:bg-white/[0.035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 motion-reduce:transition-none">
            <div className="min-w-0 flex-1"><span className="mb-1 block text-[10px] uppercase tracking-wider text-emerald-400/75">{idea.category}</span><span className="block text-sm font-medium text-foreground">{idea.title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{idea.detail}</span></div>
            {selected === idea.title ? <Check size={16} className="shrink-0 text-emerald-400" /> : <ArrowUpRight size={16} className="shrink-0 text-muted-foreground group-hover:text-emerald-300" />}
          </button></li>)}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground" role="status">{selected ? 'Added to your message. Adjust the details, then send when ready.' : 'Choose an idea to customize it below. Nothing runs until you send.'}</p>
      </div>
    </div>
  );
}
