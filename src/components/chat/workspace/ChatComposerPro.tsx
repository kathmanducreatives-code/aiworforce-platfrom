import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Hash, Loader2, Slash, X, AtSign } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AGENT_PROFILES, type AgentProfile, type AgentDept } from '@/data/agentProfiles';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApprovals } from '@/hooks/useApprovals';
import { useChatWorkspace, CHANNEL_DEFAULT_AGENT } from '@/contexts/ChatWorkspaceContext';
import { pilotChat } from '@/lib/pilotChat';
import { toast } from 'sonner';

const DEPTS: { id: AgentDept; label: string; description: string }[] = [
  { id: 'talent', label: 'talent', description: 'Sourcing & screening' },
  { id: 'growth', label: 'growth', description: 'Outreach & leads' },
  { id: 'intelligence', label: 'intelligence', description: 'Market & competitor signals' },
  { id: 'content', label: 'content', description: 'Posts & narratives' },
];

const COMMANDS = [
  { id: 'plan', label: '/plan', desc: 'Show the current active plan' },
  { id: 'agents', label: '/agents', desc: 'List your AI workforce' },
  { id: 'history', label: '/history', desc: 'Show completed conversations' },
  { id: 'brain', label: '/brain', desc: 'Open Company Brain' },
  { id: 'clear', label: '/clear', desc: 'Clear current view' },
];

const AGENT_HEX: Record<string, string> = {
  scout: '#3B82F6',
  aria: '#8B5CF6',
  penn: '#10B981',
  hawk: '#14B8A6',
  scribe: '#A855F7',
};

function InitialCircle({ slug, name, size = 20 }: { slug: string; name: string; size?: number }) {
  const hex = AGENT_HEX[slug] ?? '#7D8590';
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: `${hex}26`,
        color: hex,
        fontSize: size <= 20 ? 10 : 11,
        fontWeight: 600,
        lineHeight: 1,
      }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

interface Props {
  restrictDepartment?: AgentDept;
  placeholder?: string;
  autoFocus?: boolean;
  openOnFocus?: boolean;
}

export default function ChatComposerPro({ restrictDepartment, placeholder, autoFocus, openOnFocus }: Props) {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { count: pendingApprovalCount } = useApprovals(workspaceId);
  const { open, mode, view, setView, setPending, setComposerFocused } = useChatWorkspace();

  const [value, setValue] = useState('');
  const [popup, setPopup] = useState<null | 'mention' | 'channel' | 'command'>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false); // IME composition guard
  const autosizeRafRef = useRef<number | null>(null);

  const mentionCandidates = useMemo(
    () =>
      AGENT_PROFILES
        .filter((a) => !restrictDepartment || a.department === restrictDepartment)
        .filter((a) => a.name.toLowerCase().startsWith(query.toLowerCase())),
    [query, restrictDepartment],
  );

  const channelCandidates = useMemo(() => DEPTS.filter((d) => d.id.startsWith(query.toLowerCase())), [query]);
  const commandCandidates = useMemo(() => COMMANDS.filter((c) => c.id.startsWith(query.toLowerCase())), [query]);

  // Auto-resize — coalesced via rAF so fast typing/paste doesn't thrash layout.
  useLayoutEffect(() => {
    if (autosizeRafRef.current != null) cancelAnimationFrame(autosizeRafRef.current);
    autosizeRafRef.current = requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      const prev = el.style.height;
      el.style.height = 'auto';
      const next = Math.min(el.scrollHeight, 240) + 'px';
      if (prev !== next) el.style.height = next;
    });
    return () => {
      if (autosizeRafRef.current != null) cancelAnimationFrame(autosizeRafRef.current);
    };
  }, [value]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  // Stable ref to the latest submit() so window listeners never go stale
  // (and StrictMode double-mount can't drop/duplicate dispatched sends).
  const submitRef = useRef<(text: string, opts?: Parameters<typeof submit>[1]) => void>(() => {});

  // External prefill (from EmptyState rows)
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail !== 'string') return;
      setValue(detail);
      requestAnimationFrame(() => {
        const el = taRef.current;
        el?.focus();
        el?.setSelectionRange(detail.length, detail.length);
      });
    };
    const onSend = (e: Event) => {
      const raw = (e as CustomEvent).detail;
      // Back-compat: plain string detail still works (treated as freeform).
      const detail = typeof raw === 'string'
        ? { text: raw, conversation_id: null as string | null }
        : (raw && typeof raw === 'object' && typeof (raw as { text?: unknown }).text === 'string'
            ? (raw as { text: string; conversation_id?: string | null; action_source?: string; metadata?: Record<string, unknown> })
            : null);
      if (!detail || !detail.text.trim()) return;
      submitRef.current(detail.text, {
        conversationIdOverride: detail.conversation_id ?? null,
        actionSource: detail.action_source ?? null,
        metadata: detail.metadata,
      });
    };
    window.addEventListener('chat:prefill', onPrefill);
    window.addEventListener('chat:send', onSend);
    return () => {
      window.removeEventListener('chat:prefill', onPrefill);
      window.removeEventListener('chat:send', onSend);
    };
  }, []);

  const detectPopup = (text: string, caret: number) => {
    const upTo = text.slice(0, caret);
    const m = upTo.match(/(?:^|\s)([@#/])(\w*)$/);
    if (m) {
      setPopup(m[1] === '@' ? 'mention' : m[1] === '#' ? 'channel' : 'command');
      setQuery(m[2] ?? '');
      setActiveIdx(0);
    } else {
      setPopup(null); setQuery('');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    if (showSuggestions) setShowSuggestions(false);
    // Only run popup detection when a trigger char is at/near the caret or
    // a popup is already open. Avoids per-keystroke state churn on plain text.
    const caret = e.target.selectionStart ?? v.length;
    const prevChar = caret > 0 ? v[caret - 1] : '';
    if (popup || prevChar === '@' || prevChar === '#' || prevChar === '/') {
      detectPopup(v, caret);
    }
  };

  const replaceTrigger = (_trigger: '@' | '#' | '/', insert: string) => {
    const el = taRef.current;
    const caret = el?.selectionStart ?? value.length;
    const upTo = value.slice(0, caret);
    const after = value.slice(caret);
    const replaced = upTo.replace(/(?:^|\s)([@#/])(\w*)$/, (m) => {
      const lead = m.startsWith(' ') ? ' ' : '';
      return `${lead}${insert} `;
    });
    const next = replaced + after;
    setValue(next);
    setPopup(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = replaced.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const runCommand = (cmdId: string) => {
    setPopup(null); setValue('');
    if (cmdId === 'brain') { navigate('/company-brain'); return; }
    if (cmdId === 'agents') { setView({ kind: 'channel', dept: 'talent' }); return; }
    if (cmdId === 'history') return;
    if (cmdId === 'clear') { setView({ kind: 'empty' }); return; }
    if (cmdId === 'plan') return;
  };

  const submit = async (
    override?: string,
    opts?: {
      conversationIdOverride?: string | null;
      actionSource?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) => {
    const text = (override ?? value).trim();
    if (!text || submitting) return;

    const isCardAction = !!opts?.actionSource;

    // Resolve target agent slug
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

    // Card actions MUST carry their origin conversation_id. Never fall back to
    // the active view (which may have changed) and never silently create a
    // new conversation.
    const explicitOverride = opts?.conversationIdOverride ?? null;
    const conversationId = isCardAction
      ? explicitOverride
      : (explicitOverride ?? (view.kind === 'chat' ? view.conversationId : null));

    if (isCardAction && !conversationId) {
      toast.error('Action lost its chat context. Please retry from the original conversation.');
      return;
    }

    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }

    open();
    setSubmitting(true);
    // Clear composer FIRST so the user can keep typing the next message
    // immediately, then stash optimistic pending state.
    if (!override) setValue('');
    if (conversationId) {
      setPending({ conversationId, text, awaiting: true });
    }
    try {
      const result = await pilotChat({
        message: text,
        workspace_id: workspaceId,
        conversation_id: conversationId,
        metadata: opts?.metadata,
        action_source: opts?.actionSource ?? undefined,
      });
      const newConvId = result?.conversation_id;
      if (!isCardAction && !conversationId && typeof newConvId === 'string' && newConvId) {
        setView({ kind: 'chat', conversationId: newConvId, agentSlug });
      }
      setPending(null);
    } catch (e) {
      setPending(null);
      // Restore the user's text so they don't lose it on failure.
      if (!override) setValue(text);
      toast.error('Could not send message', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  // Keep submitRef pointing at the latest closure so window listeners
  // dispatched via chat:send always use current state.
  useEffect(() => {
    submitRef.current = (text, opts) => { void submit(text, opts); };
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition guard — never act on Enter while user is composing
    // (kana, pinyin, hangul, etc.). `e.nativeEvent.isComposing` covers most
    // browsers; the ref catches the rest.
    const composing = composingRef.current || (e.nativeEvent as KeyboardEvent['nativeEvent'] & { isComposing?: boolean }).isComposing;
    if (composing) return;

    if (popup) {
      const list =
        popup === 'mention' ? mentionCandidates :
        popup === 'channel' ? channelCandidates :
        commandCandidates;
      if (list.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % list.length); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => (i - 1 + list.length) % list.length); return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (popup === 'mention') replaceTrigger('@', `@${(list[activeIdx] as AgentProfile).name}`);
          else if (popup === 'channel') {
            replaceTrigger('#', '');
            setView({ kind: 'channel', dept: (list[activeIdx] as typeof DEPTS[number]).id });
            open();
          } else {
            replaceTrigger('/', '');
            runCommand((list[activeIdx] as typeof COMMANDS[number]).id);
          }
          return;
        }
      }
      if (e.key === 'Escape') { setPopup(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const suggestions = useMemo(() => {
    const hour = new Date().getHours();
    if (pendingApprovalCount > 0) {
      return [
        "What's waiting for my approval?",
        "Review Penn's outreach drafts",
        "Show me Aria's latest shortlist",
      ];
    }
    if (hour < 11) {
      return [
        "What did my agents do yesterday?",
        "What's happening in our market today?",
        "Find engineers for our open roles",
      ];
    }
    return [
      "Screen the new applicants",
      "Follow up with cold leads",
      "Write a post about our latest win",
    ];
  }, [pendingApprovalCount]);

  const contextLabel =
    view.kind === 'channel' ? `# ${view.dept}` :
    view.kind === 'agent' ? `@ ${AGENT_PROFILES.find(p => p.id === view.slug)?.name ?? view.slug}` :
    null;

  const hasText = value.trim().length > 0;

  return (
    <div className="relative w-full">
      {/* Quick suggestions (plain text, middle dot) */}
      {showSuggestions && !value && (
        <div className="absolute bottom-full left-0 right-0 mb-3 px-1 pointer-events-auto">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-[#6e7681]">
            {suggestions.map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <button
                  onMouseDown={(e) => { e.preventDefault(); setValue(s); setShowSuggestions(false); taRef.current?.focus(); }}
                  className="hover:text-[#7D8590] transition-colors"
                >
                  {s}
                </button>
                {i < suggestions.length - 1 && <span aria-hidden>·</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Popups */}
      {popup === 'mention' && mentionCandidates.length > 0 && (
        <Popup>
          {mentionCandidates.map((a, i) => {
            const dbA = agents.find((db) => db.slug === a.id);
            const running = dbA?.status === 'running';
            return (
              <PopupRow
                key={a.id}
                active={i === activeIdx}
                onPick={() => replaceTrigger('@', `@${a.name}`)}
                onHover={() => setActiveIdx(i)}
              >
                <InitialCircle slug={a.id} name={a.name} size={20} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[#F0F6FC]">{a.name}</div>
                  <div className="text-[12px] text-[#7D8590] truncate">{a.role}</div>
                </div>
                {running && <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />}
              </PopupRow>
            );
          })}
        </Popup>
      )}
      {popup === 'channel' && channelCandidates.length > 0 && (
        <Popup>
          {channelCandidates.map((d, i) => (
            <PopupRow key={d.id} active={i === activeIdx}
              onPick={() => { replaceTrigger('#', ''); setView({ kind: 'channel', dept: d.id }); open(); }}
              onHover={() => setActiveIdx(i)}>
              <Hash className="h-3.5 w-3.5 text-[#7D8590]" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-[#F0F6FC]">#{d.label}</div>
                <div className="text-[12px] text-[#7D8590] truncate">{d.description}</div>
              </div>
            </PopupRow>
          ))}
        </Popup>
      )}
      {popup === 'command' && commandCandidates.length > 0 && (
        <Popup>
          {commandCandidates.map((c, i) => (
            <PopupRow key={c.id} active={i === activeIdx}
              onPick={() => { replaceTrigger('/', ''); runCommand(c.id); }}
              onHover={() => setActiveIdx(i)}>
              <Slash className="h-3.5 w-3.5 text-[#7D8590]" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-[#F0F6FC] font-mono">{c.label}</div>
                <div className="text-[12px] text-[#7D8590] truncate">{c.desc}</div>
              </div>
            </PopupRow>
          ))}
        </Popup>
      )}

      <div className={cn(
        'flex items-end gap-2.5 rounded-2xl bg-[#0f141a] border border-white/[0.07]',
        'px-4 py-3 transition-[border-color,box-shadow] duration-150',
        'focus-within:border-emerald-500/35 focus-within:shadow-[0_0_0_3px_rgba(16,185,129,0.10)]',
      )}>
        {contextLabel && (
          <div className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-white/[0.08] text-[12.5px] text-[#9aa4af]">
            <span>{contextLabel}</span>
            <button
              onClick={() => setView({ kind: 'empty' })}
              className="ml-0.5 text-[#7D8590] hover:text-[#F0F6FC]"
              aria-label="Clear context"
              type="button"
            ><X className="h-3 w-3" /></button>
          </div>
        )}

        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onFocus={() => {
            if (openOnFocus && mode === 'closed') open();
            setComposerFocused(true);
            if (!value) setShowSuggestions(true);
          }}
          onBlur={() => {
            setComposerFocused(false);
            setTimeout(() => setShowSuggestions(false), 100);
          }}
          placeholder={placeholder ?? (view.kind === 'channel' ? `Message #${view.dept}…` : 'Message your AI workforce…')}
          className="flex-1 resize-none bg-transparent outline-none text-[16px] leading-[1.55] text-[#F0F6FC] placeholder:text-[#6e7681] max-h-[240px] min-h-[28px] py-1 px-1"
        />


        <AnimatePresence initial={false}>
          {(hasText || submitting) && (
            <motion.button
              key="send"
              type="button"
              onClick={() => { void submit(); }}
              disabled={!hasText || submitting}
              initial={{ x: 8, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 8, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="h-9 w-9 shrink-0 rounded-full bg-[#10B981] text-white flex items-center justify-center hover:bg-[#0EA372] transition-colors shadow-[0_0_18px_rgba(16,185,129,0.35)]"
              aria-label="Send"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Popup({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
      <div className="rounded-lg bg-[#131920] border border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden">
        <ul className="max-h-72 overflow-auto py-1">{children}</ul>
      </div>
    </div>
  );
}

function PopupRow({ active, onPick, onHover, children }: {
  active: boolean; onPick: () => void; onHover: () => void; children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onPick(); }}
        onMouseEnter={onHover}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
          active ? 'bg-white/[0.04]' : 'hover:bg-white/[0.04]',
        )}
      >
        {children}
      </button>
    </li>
  );
}
