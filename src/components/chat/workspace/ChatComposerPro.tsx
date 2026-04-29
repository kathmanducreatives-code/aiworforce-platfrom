import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, AtSign, Hash, Loader2, Slash, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AGENT_PROFILES, deptDot, deptText, type AgentProfile, type AgentDept } from '@/data/agentProfiles';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useApprovals } from '@/hooks/useApprovals';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { submitInstruction } from '@/lib/orchestration';
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

interface Props {
  /** restrict @ picker / outbound routing to a single department */
  restrictDepartment?: AgentDept;
  placeholder?: string;
  autoFocus?: boolean;
  /** open workspace on focus when collapsed */
  openOnFocus?: boolean;
}

export default function ChatComposerPro({ restrictDepartment, placeholder, autoFocus, openOnFocus }: Props) {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { count: pendingApprovalCount } = useApprovals(workspaceId);
  const { open, mode, view, setView } = useChatWorkspace();

  const [value, setValue] = useState('');
  const [popup, setPopup] = useState<null | 'mention' | 'channel' | 'command'>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Mention candidates
  const mentionCandidates = useMemo(() => {
    return AGENT_PROFILES
      .filter((a) => !restrictDepartment || a.department === restrictDepartment)
      .filter((a) => a.name.toLowerCase().startsWith(query.toLowerCase()));
  }, [query, restrictDepartment]);

  const channelCandidates = useMemo(() => DEPTS.filter((d) => d.id.startsWith(query.toLowerCase())), [query]);
  const commandCandidates = useMemo(() => COMMANDS.filter((c) => c.id.startsWith(query.toLowerCase())), [query]);

  // Auto-resize
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [value]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

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
    setShowSuggestions(false);
    detectPopup(v, e.target.selectionStart ?? v.length);
  };

  const replaceTrigger = (trigger: '@' | '#' | '/', insert: string) => {
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
    if (cmdId === 'history') { /* sidebar handles via search */ return; }
    if (cmdId === 'clear') { setView({ kind: 'empty' }); return; }
    if (cmdId === 'plan') {
      // Stays on current view; user can pick from sidebar
      return;
    }
  };

  const submit = async () => {
    const text = value.trim();
    if (!text || submitting || !workspaceId) return;

    // Mention?
    const mentionMatch = text.match(/@(\w+)/);
    let mentioned: AgentProfile | undefined;
    if (mentionMatch) {
      const name = mentionMatch[1].toLowerCase();
      mentioned = AGENT_PROFILES.find((a) => a.name.toLowerCase() === name);
    }

    // If channel context with no @, prefix instruction
    let outbound = text;
    if (!mentioned && view.kind === 'channel') {
      outbound = `[#${view.dept}] ${text}`;
    }

    open();
    setSubmitting(true);
    try {
      const result = await submitInstruction(workspaceId, outbound, mentioned ? { agentSlug: mentioned.id } : undefined);
      setValue('');
      setView({ kind: 'conversation', planId: result.plan_id });
    } catch (e) {
      toast.error('Could not dispatch', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
      submit();
    }
  };

  // Suggested prompts
  const suggestions = useMemo(() => {
    const hour = new Date().getHours();
    if (pendingApprovalCount > 0) {
      return [
        "What's waiting for my approval?",
        "Review @Penn's outreach drafts",
        "Show me Aria's latest shortlist",
      ];
    }
    if (hour < 11) {
      return [
        "What did my agents do yesterday?",
        "@Hawk what's happening in our market today?",
        "@Scout find engineers for our open roles",
      ];
    }
    return [
      "@Aria screen the new applicants",
      "@Penn follow up with cold leads",
      "@Scribe write a post about our latest win",
    ];
  }, [pendingApprovalCount]);

  // Context indicator
  const contextLabel =
    view.kind === 'channel' ? `#${view.dept}` :
    view.kind === 'agent' ? `@${AGENT_PROFILES.find(p => p.id === view.slug)?.name ?? view.slug}` :
    null;

  return (
    <div className="relative w-full">
      {/* Suggestions */}
      {showSuggestions && !value && (
        <div className="absolute bottom-full left-0 right-0 mb-3 flex flex-wrap gap-1.5 justify-center pointer-events-auto">
          {suggestions.map((s) => (
            <button
              key={s}
              onMouseDown={(e) => { e.preventDefault(); setValue(s); setShowSuggestions(false); taRef.current?.focus(); }}
              className="text-xs px-2.5 py-1 rounded-full border border-border/60 bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Popups */}
      {popup === 'mention' && mentionCandidates.length > 0 && (
        <Popup title={<><AtSign className="h-3 w-3" />Mention an agent</>}>
          {mentionCandidates.map((a, i) => (
            <PopupRow key={a.id} active={i === activeIdx}
              onPick={() => replaceTrigger('@', `@${a.name}`)}
              onHover={() => setActiveIdx(i)}>
              <img src={a.image} alt="" className="h-7 w-7 rounded-full object-cover ring-2 ring-border" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{a.name}</span>
                  <span className={cn('h-1.5 w-1.5 rounded-full', deptDot[a.department])} />
                  <span className={cn('text-[10px] uppercase tracking-wider', deptText[a.department])}>{a.department}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {agents.find((db) => db.slug === a.id)?.status === 'running'
                    ? `Running — ${agents.find((db) => db.slug === a.id)?.current_task ?? '...'}`
                    : a.role}
                </div>
              </div>
            </PopupRow>
          ))}
        </Popup>
      )}
      {popup === 'channel' && channelCandidates.length > 0 && (
        <Popup title={<><Hash className="h-3 w-3" />Switch channel</>}>
          {channelCandidates.map((d, i) => (
            <PopupRow key={d.id} active={i === activeIdx}
              onPick={() => { replaceTrigger('#', ''); setView({ kind: 'channel', dept: d.id }); open(); }}
              onHover={() => setActiveIdx(i)}>
              <Hash className={cn('h-4 w-4', deptText[d.id])} />
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground">#{d.label}</div>
                <div className="text-xs text-muted-foreground">{d.description}</div>
              </div>
            </PopupRow>
          ))}
        </Popup>
      )}
      {popup === 'command' && commandCandidates.length > 0 && (
        <Popup title={<><Slash className="h-3 w-3" />Commands</>}>
          {commandCandidates.map((c, i) => (
            <PopupRow key={c.id} active={i === activeIdx}
              onPick={() => { replaceTrigger('/', ''); runCommand(c.id); }}
              onHover={() => setActiveIdx(i)}>
              <span className="text-sm font-mono text-primary">{c.label}</span>
              <span className="text-xs text-muted-foreground">{c.desc}</span>
            </PopupRow>
          ))}
        </Popup>
      )}

      <div className={cn(
        'flex items-end gap-2 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl p-2.5 transition-all',
        'focus-within:border-primary/70 focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12),0_0_30px_hsl(var(--primary)/0.15)]',
      )}>
        {contextLabel && (
          <div className="shrink-0 inline-flex items-center gap-1 h-8 px-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-mono">
            {contextLabel}
            <button
              onClick={() => setView({ kind: 'empty' })}
              className="ml-0.5 hover:text-foreground"
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
          onFocus={() => {
            if (openOnFocus && mode === 'closed') open();
            if (!value) setShowSuggestions(true);
          }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 100)}
          onSelect={(e) => detectPopup(value, (e.target as HTMLTextAreaElement).selectionStart ?? value.length)}
          placeholder={placeholder ?? 'Message your AI workforce — type @ # or /'}
          className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed placeholder:text-muted-foreground/70 max-h-[240px] min-h-[24px] py-1.5 px-2"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || submitting}
          className={cn(
            'h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-all',
            value.trim() && !submitting
              ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
              : 'bg-muted text-muted-foreground/50 cursor-not-allowed',
          )}
          aria-label="Send"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Popup({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
      <div className="rounded-xl border border-border/80 bg-popover/95 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="px-3 py-1.5 border-b border-border/60 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          {title}
        </div>
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
        className={cn('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
          active ? 'bg-primary/10' : 'hover:bg-muted/50')}
      >
        {children}
      </button>
    </li>
  );
}
