import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_PROFILES, type AgentProfile } from '@/data/agentProfiles';

import { useChatWorkspace, CHANNEL_DEFAULT_AGENT } from '@/contexts/ChatWorkspaceContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { pilotChat } from '@/lib/pilotChat';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

const PLACEHOLDERS = [
  'Ask your workforce anything...',
  '@Scout find backend engineers in Berlin',
  'Summarize this week\u2019s pipeline',
  'What changed across competitors today?',
  '@Penn draft outreach for today\u2019s leads',
];

const CHIPS = [
  'Brief me on today',
  'Show pending approvals',
  'What\u2019s @Penn working on?',
  'Run morning standup',
];

const AGENT_HEX: Record<string, string> = {
  scout: '#3B82F6',
  aria: '#8B5CF6',
  penn: '#10B981',
  hawk: '#14B8A6',
  scribe: '#A855F7',
};

function AgentBadge({ agent, size = 24 }: { agent: AgentProfile; size?: number }) {
  const hex = AGENT_HEX[agent.id] ?? '#7D8590';
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 ring-[1.5px] ring-emerald-500/60 animate-[heroPulse_3s_ease-in-out_infinite]"
      style={{
        width: size,
        height: size,
        backgroundColor: `${hex}26`,
        color: hex,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
      }}
      aria-hidden
    >
      {agent.name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function HeroCommandSurface() {
  const { open, view, setView, setPending } = useChatWorkspace();
  const { workspaceId } = useWorkspace();

  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phIdx, setPhIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const blurResumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rotating, setRotating] = useState(true);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

  // Rotating placeholder
  useEffect(() => {
    if (!rotating) return;
    const t = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(t);
  }, [rotating]);

  useEffect(() => {
    if (value.length > 0 || focused) setRotating(false);
  }, [value, focused]);

  // Auto-resize
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  const visibleAgents = useMemo(() => AGENT_PROFILES.slice(0, 5), []);

  const submit = async () => {
    const text = value.trim();
    if (!text || submitting) return;

    const mentionMatch = text.match(/@(\w+)/);
    let mentioned: AgentProfile | undefined;
    if (mentionMatch) {
      const name = mentionMatch[1].toLowerCase();
      mentioned = AGENT_PROFILES.find((a) => a.name.toLowerCase() === name);
    }
    let agentSlug: string;
    if (mentioned) agentSlug = mentioned.id;
    else if (view.kind === 'chat') agentSlug = view.agentSlug;
    else if (view.kind === 'agent') agentSlug = view.slug;
    else if (view.kind === 'channel') agentSlug = CHANNEL_DEFAULT_AGENT[view.dept];
    else agentSlug = 'scout';

    const conversationId = view.kind === 'chat' ? view.conversationId : null;

    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }

    open();
    setSubmitting(true);
    if (conversationId) setPending({ conversationId, text, awaiting: true });
    setValue('');
    try {
      const result = await pilotChat({ message: text, workspace_id: workspaceId, conversation_id: conversationId });
      const newConvId = result?.conversation_id;
      if (!conversationId && typeof newConvId === 'string' && newConvId) {
        setView({ kind: 'chat', conversationId: newConvId, agentSlug });
      }
      setPending(null);
    } catch (e) {
      setPending(null);
      toast.error('Could not send message', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleChipClick = (text: string) => {
    setValue(text);
    requestAnimationFrame(() => {
      const el = taRef.current;
      el?.focus();
      el?.setSelectionRange(text.length, text.length);
    });
  };

  const handleFocus = () => {
    if (blurResumeRef.current) clearTimeout(blurResumeRef.current);
    setFocused(true);
  };
  const handleBlur = () => {
    setFocused(false);
    if (blurResumeRef.current) clearTimeout(blurResumeRef.current);
    blurResumeRef.current = setTimeout(() => {
      if (!value) setRotating(true);
    }, 2000);
  };

  const hasText = value.trim().length > 0;

  return (
    <>
      {/* Local keyframes for status ring breathe */}
      <style>{`
        @keyframes heroPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
          50% { box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }
        }
      `}</style>

      {/* Focus dim overlay — fixed full-viewport, between page and surface */}
      <AnimatePresence>
        {focused && (
          <motion.div
            key="hero-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: isMobile ? 0.4 : 0.6 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-0 bg-black pointer-events-none z-30"
          />
        )}
      </AnimatePresence>

      {/* Hero surface — relative wrapper, lifted above the dim */}
      <div className={cn('relative w-full mx-auto max-w-3xl my-8 sm:my-10', focused && 'z-40')}>
        {/* Ambient glow */}
        <motion.div
          aria-hidden
          initial={false}
          animate={{ opacity: focused ? 0.28 : 0.1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="absolute inset-0 rounded-2xl shadow-emerald-glow pointer-events-none"
        />

        {/* Suggestion chips */}
        <div className="relative mb-3 h-7">
          <AnimatePresence>
            {!focused && !hasText && (
              <motion.div
                key="chips"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex gap-2 overflow-x-auto flex-nowrap scrollbar-none px-1"
              >
                {CHIPS.map((c) => (
                  <motion.button
                    key={c}
                    type="button"
                    onClick={() => handleChipClick(c)}
                    whileHover={{ scale: 1.02 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="glass-surface shrink-0 rounded-full px-3 py-1.5 text-mono-label text-foreground/70 hover:text-foreground hover:shadow-emerald-glow/30"
                  >
                    {c}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* The composer */}
        <div className="glass-surface relative rounded-2xl p-5 sm:p-6 min-h-[120px]">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0 relative">
              <textarea
                ref={taRef}
                rows={1}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder=""
                className="w-full resize-none bg-transparent outline-none text-[15px] leading-relaxed text-foreground placeholder:text-foreground/40 max-h-[200px] min-h-[56px] py-1"
              />
              {!value && (
                <div className="pointer-events-none absolute inset-0 py-1 text-[15px] leading-relaxed text-foreground/40">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={phIdx}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      {PLACEHOLDERS[phIdx]}
                    </motion.span>
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          {/* Bottom row: agents + submit affordance */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-mono-label text-foreground/40 hidden sm:block">
              {focused ? 'Press Enter to send  ·  Shift+Enter for newline' : 'Your workforce is ready'}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <TooltipProvider delayDuration={200}>
                {/* Desktop: show all 5; Mobile: show 3 + counter */}
                <div className="hidden sm:flex items-center gap-1.5">
                  {visibleAgents.map((a) => (
                    <Tooltip key={a.id}>
                      <TooltipTrigger asChild>
                        <button type="button" className="rounded-full">
                          <AgentBadge agent={a} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">{a.name} — ready</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
                <div className="flex sm:hidden items-center gap-1.5">
                  {visibleAgents.slice(0, 3).map((a) => (
                    <AgentBadge key={a.id} agent={a} />
                  ))}
                  <span className="text-mono-label text-foreground/50 ml-1">+2</span>
                </div>
              </TooltipProvider>

              <button
                type="button"
                aria-label="Add agent"
                className="h-6 w-6 rounded-full border border-border-soft text-foreground/40 hover:text-foreground/70 hover:border-border-active flex items-center justify-center transition-colors"
              >
                <Plus className="h-3 w-3" />
              </button>

              {/* Submit affordance */}
              <AnimatePresence initial={false}>
                {hasText && (
                  <motion.div
                    key="submit"
                    initial={{ opacity: 0, x: 4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 4 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="flex items-center gap-2 ml-1"
                  >
                    {/* Desktop: keyboard hint */}
                    <span className="hidden sm:inline text-mono-label text-foreground/60">
                      Enter ↵
                    </span>
                    {/* Mobile: tappable emerald arrow */}
                    <button
                      type="button"
                      onClick={submit}
                      disabled={submitting}
                      aria-label="Send"
                      className="sm:hidden h-7 w-7 rounded-full bg-emerald-500 text-white flex items-center justify-center"
                    >
                      {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
