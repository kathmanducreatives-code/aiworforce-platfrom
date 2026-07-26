// ScoutCopilot — persistent right-rail assistant for the Signals workspace.
// Mirrors MiraCopilot's structure: agent header, rotating insight, mode chips,
// prompt suggestions, and a bottom Ask input. Dispatches via sendAgentCommand
// (no new backend). Uses the canonical Signal Scout profile from the registry.

import { useMemo, useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Radar, Eye, Brain, MessageSquare } from 'lucide-react';
import { sendAgentCommand } from '@/lib/agentCommand';

interface ScoutCopilotProps {
  agentName: string;
  agentRole: string;
  agentAvatar: string;
  agentStatus?: string;
  accentHex: string;
  onRunRadarScan?: () => void;
  onEditRadar?: () => void;
}

type Mode = 'brief' | 'watch' | 'analyze' | 'ask';

const MODES: { id: Mode; label: string; icon: typeof Radar; prompts: string[] }[] = [
  {
    id: 'brief',
    label: 'Brief',
    icon: Sparkles,
    prompts: [
      'What should I monitor this week?',
      'Summarise today’s strongest signals',
      'Which accounts moved most this week?',
    ],
  },
  {
    id: 'watch',
    label: 'Watch',
    icon: Eye,
    prompts: [
      'Find companies showing buying intent',
      'Watch competitor launches this month',
      'Track hiring surges in my ICP',
    ],
  },
  {
    id: 'analyze',
    label: 'Analyze',
    icon: Brain,
    prompts: [
      'Explain today’s strongest signal',
      'Review unverified signals',
      'Which signals map to a buying window?',
    ],
  },
  {
    id: 'ask',
    label: 'Ask',
    icon: MessageSquare,
    prompts: [
      'Create a radar for my ICP',
      'How do you detect a buying window?',
      'What would a stronger radar include?',
    ],
  },
];

const INSIGHTS = [
  'Hiring signals paired with leadership changes are more likely to create immediate buying windows.',
  'Funding rounds under $10M convert to outreach faster than mega-rounds — they hire quickly.',
  'Competitor launches in the past 14 days often surface founders open to alternatives.',
  'A workflow-trend signal is strongest when at least three companies in your ICP mention it.',
];

export default function ScoutCopilot({
  agentName,
  agentRole,
  agentAvatar,
  agentStatus = 'On duty',
  accentHex,
  onRunRadarScan,
  onEditRadar,
}: ScoutCopilotProps) {
  const [mode, setMode] = useState<Mode>('brief');
  const [imgFailed, setImgFailed] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const insight = useMemo(() => INSIGHTS[Math.floor(Math.random() * INSIGHTS.length)], []);
  const active = MODES.find((m) => m.id === mode)!;
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [value]);

  const dispatch = async (text: string) => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await sendAgentCommand(text, {
        success: `Sent to ${agentName}`,
        action_source: 'signals_scout_copilot',
      });
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="border-b border-white/[0.05] px-4 py-4"
        style={{ background: `linear-gradient(180deg, ${accentHex}14 0%, transparent 100%)` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="overflow-hidden rounded-full border"
            style={{ borderColor: `${accentHex}55`, boxShadow: `0 0 16px -3px ${accentHex}55` }}
          >
            {imgFailed ? (
              <div
                className="flex h-11 w-11 items-center justify-center rounded-full text-[15px] font-semibold"
                style={{ background: `${accentHex}22`, color: accentHex }}
              >
                {agentName[0]}
              </div>
            ) : (
              <img
                src={agentAvatar}
                alt={agentName}
                onError={() => setImgFailed(true)}
                className="h-11 w-11 rounded-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-foreground">{agentName}</h2>
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: `${accentHex}1A`, color: accentHex }}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: accentHex }} aria-hidden />
                {agentStatus}
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground/75">{agentRole}</p>
          </div>
        </div>
      </div>

      {/* Insight */}
      <div className="border-b border-white/[0.05] px-4 py-3">
        <p
          className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em]"
          style={{ color: `${accentHex}CC` }}
        >
          Insight
        </p>
        <p className="text-[13px] leading-relaxed text-foreground/85">{insight}</p>
      </div>

      {/* Modes */}
      <div className="border-b border-white/[0.05] px-3 py-2">
        <div className="flex gap-1">
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11.5px] font-medium transition-colors"
                style={
                  isActive
                    ? { background: `${accentHex}1A`, color: accentHex }
                    : { color: 'hsl(var(--muted-foreground))' }
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Prompts */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">Suggested</p>
        <div className="space-y-1.5">
          {active.prompts.map((p) => (
            <button
              key={p}
              onClick={() => dispatch(p)}
              disabled={submitting}
              className="flex w-full items-start gap-2 rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-white/[0.05] disabled:opacity-60"
            >
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0" style={{ color: `${accentHex}CC` }} />
              <span>{p}</span>
            </button>
          ))}
        </div>

        {(onRunRadarScan || onEditRadar) && (
          <div className="mt-4 space-y-1.5">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground/70">Quick actions</p>
            {onRunRadarScan && (
              <button
                onClick={onRunRadarScan}
                className="flex w-full items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-white/[0.05]"
              >
                <Radar className="h-3.5 w-3.5" style={{ color: accentHex }} />
                Run radar scan
              </button>
            )}
            {onEditRadar && (
              <button
                onClick={onEditRadar}
                className="flex w-full items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-white/[0.05]"
              >
                <Eye className="h-3.5 w-3.5" style={{ color: accentHex }} />
                Edit radar
              </button>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-white/[0.05] px-3 py-3">
        <div
          className="flex items-end gap-2 rounded-lg border bg-black/40 p-2"
          style={{ borderColor: `${accentHex}33` }}
        >
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void dispatch(value);
              }
            }}
            placeholder={`Ask ${agentName} about market signals…`}
            rows={1}
            className="flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <button
            onClick={() => void dispatch(value)}
            disabled={!value.trim() || submitting}
            aria-label="Send"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-all disabled:opacity-40"
            style={{ background: `${accentHex}22`, color: accentHex }}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
