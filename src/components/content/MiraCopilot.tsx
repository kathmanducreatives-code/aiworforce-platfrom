// Mira Content Copilot — the dedicated AI employee panel for the Content page.
//
// Mira is the canonical display name for the content strategy agent (internal
// slug: "scribe"). This panel provides a context-aware assistance experience
// with an Alta-inspired insight card, suggested prompts, and conversation log.
//
// All outputs remain approval-first. Mira can recommend, draft, and organize —
// never publish automatically.

import { useState, useRef, useEffect } from 'react';
import { ChevronRight, Send, Sparkles, X, PenLine, MessageSquare, BarChart3, Calendar, Lightbulb } from 'lucide-react';
import { sendAgentCommand } from '@/lib/agentCommand';
import scribeImg from '@/assets/agents/scribe.webp';

// ---- canonical display names (UI only; backend slugs unchanged) ---------------

export const CONTENT_AGENT_NAMES = {
  mira: { display: 'Mira', role: 'AI Message Strategist', dispatchSlug: 'Scribe' },
  lyra: { display: 'Lyra', role: 'AI Signal Scout', dispatchSlug: 'Scout' },
  atlas: { display: 'Atlas', role: 'AI Account Analyst', dispatchSlug: 'Aria' },
  pilot: { display: 'Pilot', role: 'AI Workforce Coordinator', dispatchSlug: 'Pilot' },
  orion: { display: 'Orion', role: 'AI Pipeline Operator', dispatchSlug: 'Pilot' },
} as const;

type MiraMode = 'plan' | 'write' | 'comment' | 'analyze';

const MODE_CONFIG: Record<MiraMode, { label: string; icon: typeof PenLine; prompts: string[] }> = {
  plan: {
    label: 'Plan',
    icon: Calendar,
    prompts: [
      'Plan my next five LinkedIn posts',
      'What should I post this week?',
      'Build a content calendar for my ICP',
      'Suggest a weekly content balance',
    ],
  },
  write: {
    label: 'Write',
    icon: PenLine,
    prompts: [
      'Write a hook about outbound quality',
      'Turn this trend into a founder post',
      'Improve my latest hook',
      'Write a stronger CTA',
    ],
  },
  comment: {
    label: 'Comment',
    icon: MessageSquare,
    prompts: [
      'Draft a thoughtful comment on this post',
      'Find posts worth commenting on',
      'Make this comment less promotional',
      'Add a contrarian insight',
    ],
  },
  analyze: {
    label: 'Analyze',
    icon: BarChart3,
    prompts: [
      'Which trend best matches my ICP?',
      'What angle is my market missing?',
      'How relevant is this topic to my Company Brain?',
      'Show conversations worth joining',
    ],
  },
};

// Rotating insights for the Alta-inspired insight card.
const INSIGHTS = [
  'Founder-led operational posts are strongest for your ICP this week.',
  'Posts about timing signals get 2× more conversation than feature announcements.',
  'Your market is discussing outbound quality — a practical framework post would stand out.',
  'Commenting on 3 relevant posts this week will increase your visibility more than a single post.',
];

interface ChatMessage {
  id: string;
  role: 'user' | 'mira';
  text: string;
  ts: number;
}

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  contextLabel?: string | null;
  onContextClear?: () => void;
}

export function MiraCopilot({ collapsed, onToggle, contextLabel, onContextClear }: Props) {
  const [mode, setMode] = useState<MiraMode>('plan');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [insightIdx, setInsightIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rotate the insight card every 12 seconds.
  useEffect(() => {
    const t = setInterval(() => setInsightIdx((i) => (i + 1) % INSIGHTS.length), 12000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: trimmed, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setInput('');

    const ctxPrefix = contextLabel ? `Context: ${contextLabel}. ` : '';
    void sendAgentCommand(`${ctxPrefix}${trimmed}`, {
      success: 'Sent to Mira — she\'ll prepare a draft for your review.',
      action_source: 'content_copilot',
    });

    const ack: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'mira',
      text: 'On it. I\'ll prepare this for your review — nothing publishes until you approve.',
      ts: Date.now(),
    };
    setTimeout(() => setMessages((m) => [...m, ack]), 400);
  }

  // ---- collapsed rail -------------------------------------------------------

  if (collapsed) {
    return (
      <div className="flex w-[60px] shrink-0 flex-col items-center gap-3 border-l border-border/20 bg-card/20 py-4 backdrop-blur-xl">
        <button
          onClick={onToggle}
          className="overflow-hidden rounded-full border-2 border-fuchsia-400/30 shadow-[0_0_16px_-4px_rgba(217,70,239,0.3)]"
          title="Expand Mira"
          aria-label="Expand Mira Content Copilot"
        >
          <MiraAvatar size={36} />
        </button>
        <button onClick={onToggle} className="text-[11px] font-medium text-muted-foreground/70 [writing-mode:vertical-rl] rotate-180">
          Ask Mira
        </button>
      </div>
    );
  }

  // ---- expanded panel -------------------------------------------------------

  const mc = MODE_CONFIG[mode];
  const showSuggestions = messages.length === 0;

  return (
    <div className="flex w-[380px] shrink-0 flex-col border-l border-border/15 bg-card/[0.12] backdrop-blur-2xl backdrop-saturate-[1.3] xl:w-[400px]">
      {/* Section 1 — Mira identity header */}
      <div className="flex items-center gap-3 border-b border-border/12 px-5 py-4">
        <div className="overflow-hidden rounded-full border-2 border-fuchsia-400/25 shadow-[0_0_18px_-4px_rgba(217,70,239,0.3)]">
          <MiraAvatar size={44} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-tight text-foreground">Mira</p>
          <p className="text-[12px] leading-tight text-muted-foreground/80">AI Message Strategist</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/20 bg-fuchsia-500/[0.06] px-2 py-0.5 text-[10px] font-medium text-fuchsia-300/80">
          <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400/70" /> On duty
        </span>
        <button
          onClick={onToggle}
          className="ml-1 rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-foreground"
          aria-label="Collapse Mira panel"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Section 2 — Alta-inspired insight card */}
      <div className="px-4 pt-4">
        <div
          className="rounded-xl border border-fuchsia-400/12 bg-gradient-to-br from-fuchsia-500/[0.06] to-violet-500/[0.03] p-4"
          style={{ boxShadow: '0 8px 28px -16px rgba(217,70,239,0.18)' }}
        >
          <div className="mb-2 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-fuchsia-400/60" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-400/50">Insight</span>
          </div>
          <p className="text-[13.5px] font-medium leading-relaxed text-foreground/85">
            {INSIGHTS[insightIdx]}
          </p>
        </div>
      </div>

      {/* context indicator */}
      {contextLabel && (
        <div className="flex items-center gap-2 px-4 pt-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/40">Working with:</span>
          <span className="flex-1 truncate text-[11px] text-fuchsia-300/70">{contextLabel}</span>
          {onContextClear && (
            <button onClick={onContextClear} className="text-muted-foreground/40 hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Section 3 — mode tabs */}
      <div className="flex gap-1 px-4 py-3">
        {(Object.keys(MODE_CONFIG) as MiraMode[]).map((m) => {
          const cfg = MODE_CONFIG[m];
          const Ic = cfg.icon;
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                active ? 'bg-fuchsia-500/[0.12] text-fuchsia-300' : 'text-muted-foreground/55 hover:text-foreground/80'
              }`}
            >
              <Ic className="h-3.5 w-3.5" /> {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Section 4 — conversation / suggestions */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-3">
        {showSuggestions ? (
          <div className="space-y-2.5">
            <p className="text-[13px] font-medium text-muted-foreground/70">What are you working on?</p>
            <div className="space-y-2">
              {mc.prompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="block w-full rounded-xl border border-border/15 bg-background/[0.15] px-3.5 py-2.5 text-left text-[13px] text-foreground/75 transition-colors hover:border-fuchsia-400/20 hover:bg-fuchsia-500/[0.04] hover:text-foreground"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <ChatBubble key={m.id} role={m.role} text={m.text} />
            ))}
          </div>
        )}
      </div>

      {/* Section 5 — composer */}
      <div className="border-t border-border/12 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask Mira about your content…"
            className="flex-1 resize-none rounded-xl border border-border/20 bg-background/25 px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:border-fuchsia-400/25 focus:outline-none"
            style={{ maxHeight: '80px' }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-300 transition-colors hover:bg-fuchsia-500/25 disabled:opacity-30"
            aria-label="Send to Mira"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/40">
          Drafts only — nothing publishes without your approval.
        </p>
      </div>
    </div>
  );
}

// ---- Mira avatar with real portrait ------------------------------------------

function MiraAvatar({ size = 36 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!failed) {
    return (
      <img
        src={scribeImg}
        alt="Mira — AI Message Strategist"
        onError={() => setFailed(true)}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    );
  }
  // Fallback to a styled initial if the image fails.
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500/20 to-violet-500/10"
      style={{ width: size, height: size }}
    >
      <span className="font-semibold text-fuchsia-300" style={{ fontSize: size * 0.4 }}>M</span>
    </div>
  );
}

function ChatBubble({ role, text }: { role: 'user' | 'mira'; text: string }) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-background/25 border border-border/12 px-3 py-2">
          <p className="text-[13px] leading-relaxed text-foreground/85">{text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 shrink-0 overflow-hidden rounded-full">
        <MiraAvatar size={28} />
      </div>
      <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-fuchsia-500/[0.06] border border-fuchsia-400/12 px-3 py-2">
        <p className="text-[13px] leading-relaxed text-foreground/80">{text}</p>
      </div>
    </div>
  );
}
