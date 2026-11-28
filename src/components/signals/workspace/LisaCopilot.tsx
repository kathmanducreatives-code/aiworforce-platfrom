import AgentStatus from '@/components/layout/department/AgentStatus';
// LisaCopilot — LISA, the Signals specialist (agentRegistry: `lisa`), in the Signals page rail.
// Mode chips change what LISA does; every message is sent with { department: "lisa", lisa_mode }
// and answered by pilot-chat's LISA branch from the Company Brain and the recorded canonical
// signals (Watch drafts a reviewable monitoring plan). The answer opens in the workforce chat.

import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Radar, Eye, Brain, MessageSquare } from 'lucide-react';
import { sendAgentCommand } from '@/lib/agentCommand';

interface LisaCopilotProps {
  agentName: string;
  agentRole: string;
  agentAvatar: string;
  /** Live status word, or null while unknown (no pill is shown). */
  agentStatus?: string | null;
  accentHex: string;
  onRunRadarScan?: () => void;
  onEditRadar?: () => void;
}

type Mode = 'brief' | 'watch' | 'analyze' | 'ask';

// Each mode CHANGES WHAT LISA DOES (pilot-chat's LISA branch reads `lisa_mode`):
//   brief / analyze / ask → LISA answers from the Company Brain + recorded canonical signals
//   watch                 → a reviewable monitoring DRAFT (nothing runs until approved + activated)
const MODES: { id: Mode; label: string; icon: typeof Radar; does: string; prompts: string[] }[] = [
  {
    id: 'brief', label: 'Brief', icon: Sparkles,
    does: 'What your recorded signals say — and, when none are recorded, which signals are worth watching for your business.',
    prompts: [
      'Which buying signals should we prioritize, and why?',
      'Summarise the strongest recorded signals',
      'What changed since my last review?',
    ],
  },
  {
    id: 'watch', label: 'Watch', icon: Eye,
    does: 'Drafts a monitoring plan from your Company Brain. Nothing runs until an owner, admin or editor approves and activates it.',
    prompts: [
      'Watch for US manufacturers and distributors that are expanding',
      'Watch for companies in our ICP hiring Account Executives',
      'Watch our main competitor for launches and pricing changes',
    ],
  },
  {
    id: 'analyze', label: 'Analyze', icon: Brain,
    does: 'Checks recorded signals against your Company Brain: verification, relevance, what is missing, and a recommended action.',
    prompts: [
      'Analyse the strongest recorded signal',
      'Which recorded signals are unverified, and what would verify them?',
      'Which signals match our ICP best?',
    ],
  },
  {
    id: 'ask', label: 'Ask', icon: MessageSquare,
    does: 'Anything about signals, answered from your Company Brain and what is recorded.',
    prompts: [
      'What would a stronger radar include for us?',
      'How do you verify a signal?',
      'What can’t you see yet, and why?',
    ],
  },
];

export default function LisaCopilot({
  agentName,
  agentRole,
  agentAvatar,
  agentStatus = null,
  accentHex,
  onRunRadarScan,
  onEditRadar,
}: LisaCopilotProps) {
  const [mode, setMode] = useState<Mode>('brief');
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
      // The panel's MODE reaches LISA: it selects her task (pilot-chat LISA branch).
      await sendAgentCommand(text, {
        success: `Sent to ${agentName} — the answer opens in your workforce chat`,
        action_source: 'signals_lisa',
        metadata: { department: 'lisa', lisa_mode: mode },
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
        style={{ background: `${accentHex}05` }}
      >
        <AgentStatus name={agentName} role={agentRole} src={agentAvatar} status={agentStatus} />
      </div>

      {/* What this mode does — no invented market "insights". */}
      <div className="border-b border-white/[0.05] px-4 py-3" data-testid="lisa-mode-description">
        <p
          className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em]"
          style={{ color: `${accentHex}CC` }}
        >
          {active.label}
        </p>
        <p className="text-[13px] leading-relaxed text-foreground/85">{active.does}</p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground/75">
          {agentName} reports only signals recorded with a source, and calls one verified only when the evidence says so.
        </p>
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
            placeholder={`${active.label}: ask ${agentName} about signals…`}
            rows={1}
            className="min-w-0 flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
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
