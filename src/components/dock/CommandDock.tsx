import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ChevronUp, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_PROFILES, type AgentProfile } from '@/data/agentProfiles';
import { useChatWorkspace, CHANNEL_DEFAULT_AGENT } from '@/contexts/ChatWorkspaceContext';
import { chatRespond } from '@/lib/chatRespond';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { openAgentBuilder } from '@/hooks/useAgentBuilder';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

const PLACEHOLDERS = [
  'Ask your workforce anything...',
  '@Scout find backend engineers in Berlin',
  'Summarize this week’s pipeline',
  'What changed across competitors today?',
  '@Penn draft outreach for today’s leads',
];

const CHIPS = [
  'Brief me on today',
  'Show pending approvals',
  'What’s @Penn working on?',
  'Run morning standup',
];

const AGENT_HEX: Record<string, string> = {
  scout: '#10B981',
  aria: '#8B5CF6',
  penn: '#10B981',
  hawk: '#14B8A6',
  scribe: '#A855F7',
};

function AgentBadge({ agent, size = 24 }: { agent: AgentProfile; size?: number }) {
  const hex = AGENT_HEX[agent.id] ?? '#7D8590';
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 border border-white/[0.04] bg-white/[0.02] shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-all duration-300 hover:scale-105"
      style={{
        width: size,
        height: size,
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

export default function CommandDock() {
  const { mode, open, view, setView, setPending } = useChatWorkspace();
  const isMobile = useIsMobile();

  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phIdx, setPhIdx] = useState(0);
  const [rotating, setRotating] = useState(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const blurResumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hide when ChatWorkspace drawer/fullscreen is open — that surface owns input.
  const hidden = mode !== 'closed';

  // Rotating placeholder
  useEffect(() => {
    if (!rotating) return;
    const t = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(t);
  }, [rotating]);

  useEffect(() => {
    if (value.length > 0 || focused) setRotating(false);
  }, [value, focused]);

  // Auto-resize textarea — max 4 lines
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 4 * 22; // ~22px line-height
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }, [value]);

  // Cmd/Ctrl + \ toggles expand → opens ChatWorkspace drawer.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === '\\') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
    const channel = view.kind === 'channel' ? view.dept : null;

    open();
    setSubmitting(true);
    if (conversationId) setPending({ conversationId, text, awaiting: true });
    setValue('');
    try {
      const result = await chatRespond({ message: text, agent_slug: agentSlug, conversation_id: conversationId, channel });
      if (!conversationId) setView({ kind: 'chat', conversationId: result.conversation_id, agentSlug });
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

  if (hidden) return null;

  return (
    <>
      {/* Focus dim — full viewport, between page and dock */}
      <AnimatePresence>
        {focused && (
          <motion.div
            key="dock-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: isMobile ? 0.3 : 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed inset-0 bg-[#000000]/60 backdrop-blur-[2px] pointer-events-none z-30"
          />
        )}
      </AnimatePresence>

      {/* The dock — floating, centered, bottom */}
      <div
        className="fixed left-0 right-0 z-40 flex justify-center px-4 pointer-events-none"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        <div className={cn('w-full max-w-3xl pointer-events-auto relative')}>
          {/* Ambient emerald glow */}
          <motion.div
            aria-hidden
            initial={false}
            animate={{ opacity: focused ? 0.15 : 0.05 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="absolute -inset-2.5 rounded-2xl bg-emerald-500/10 blur-xl pointer-events-none"
          />

          <div className={cn('glass-surface relative rounded-2xl border border-white/[0.08] bg-[#0A0A0A]/85 backdrop-blur-xl shadow-2xl', isMobile ? 'p-3' : 'p-4')}>
            {/* Suggestion chips — desktop only, hidden when focused/typing */}
            {!isMobile && (
              <div className="relative mb-3 h-7 empty:hidden">
                <AnimatePresence>
                  {!focused && !hasText && (
                    <motion.div
                      key="chips"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -2 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="flex gap-2 overflow-x-auto flex-nowrap scrollbar-none px-0.5"
                    >
                      {CHIPS.map((c) => (
                        <motion.button
                          key={c}
                          type="button"
                          onClick={() => handleChipClick(c)}
                          whileHover={{ scale: 1.015 }}
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                          className="glass shrink-0 rounded-full px-3 py-1 text-mono-label text-neutral-400 hover:text-foreground border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/[0.08] transition-all"
                        >
                          {c}
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Composer row */}
            <div className="flex items-end gap-3">
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
                  className={cn(
                    'w-full resize-none bg-transparent outline-none text-foreground placeholder:text-neutral-600 py-1 font-sans',
                    isMobile ? 'text-[14px] leading-[20px] min-h-[36px]' : 'text-[14px] leading-[22px] min-h-[28px]',
                  )}
                  style={{ maxHeight: 88 }}
                />
                {!value && (
                  <div className={cn(
                    'pointer-events-none absolute inset-0 py-1 text-neutral-500 font-sans',
                    isMobile ? 'text-[14px] leading-[20px]' : 'text-[14px] leading-[22px]',
                  )}>
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

              {/* Right cluster: agents + chevron + send */}
              <div className="flex items-center gap-2 shrink-0">
                <TooltipProvider delayDuration={200}>
                  {!isMobile ? (
                    <div className="flex items-center gap-1.5 mr-1">
                      {visibleAgents.map((a) => (
                        <Tooltip key={a.id}>
                          <TooltipTrigger asChild>
                            <button type="button" className="rounded-full">
                              <AgentBadge agent={a} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs bg-[#0A0A0A] border-white/[0.04] text-neutral-300">{a.name} — active</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 mr-1">
                      {visibleAgents.slice(0, 3).map((a) => (
                        <AgentBadge key={a.id} agent={a} size={22} />
                      ))}
                      <span className="text-mono-label text-neutral-500">+2</span>
                    </div>
                  )}
                </TooltipProvider>

                {!isMobile && (
                  <button
                    type="button"
                    aria-label="Add agent"
                    onClick={() => openAgentBuilder()}
                    className="h-6 w-6 rounded-full border border-white/[0.06] text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.02] flex items-center justify-center transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Enter hint OR send button */}
                <AnimatePresence initial={false} mode="wait">
                  {hasText ? (
                    <motion.button
                      key="send"
                      type="button"
                      onClick={submit}
                      disabled={submitting}
                      aria-label="Send"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      className="h-7 w-7 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/40 hover:text-emerald-300 flex items-center justify-center transition-all duration-200 shadow-sm"
                    >
                      {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                    </motion.button>
                  ) : !isMobile ? (
                    <motion.span
                      key="hint"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="text-mono-label text-neutral-500 px-1 select-none"
                    >
                      Enter ↵
                    </motion.span>
                  ) : null}
                </AnimatePresence>

                {/* Chevron-up: expand into full ChatWorkspace */}
                <button
                  type="button"
                  aria-label="Expand conversation (Cmd+\\)"
                  onClick={() => open()}
                  className="h-7 w-7 rounded-full border border-white/[0.06] text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.02] flex items-center justify-center transition-colors"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
