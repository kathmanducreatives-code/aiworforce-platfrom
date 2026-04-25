import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { ArrowUp, AtSign, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_PROFILES, deptDot, deptText, type AgentProfile } from '@/data/agentProfiles';

export interface ComposerSubmit {
  text: string;
  mentioned?: AgentProfile;
}

interface Props {
  onSubmit: (payload: ComposerSubmit) => Promise<void> | void;
  /** Restrict @-mention dropdown to a single department (used in Department rooms). */
  restrictDepartment?: AgentProfile['department'];
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
  disabled?: boolean;
}

const MENTION_RE = /(?:^|\s)@(\w*)$/;

export default function ChatComposer({
  onSubmit, restrictDepartment, placeholder, autoFocus, compact, disabled,
}: Props) {
  const [value, setValue] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const candidates = AGENT_PROFILES.filter((a) =>
    (!restrictDepartment || a.department === restrictDepartment)
    && a.name.toLowerCase().startsWith(mentionQuery.toLowerCase()),
  );

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }, [value]);

  const detectMention = (text: string, caret: number) => {
    const upTo = text.slice(0, caret);
    const m = upTo.match(MENTION_RE);
    if (m) {
      setShowMentions(true);
      setMentionQuery(m[1] ?? '');
      setActiveIdx(0);
    } else {
      setShowMentions(false);
      setMentionQuery('');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    detectMention(v, e.target.selectionStart ?? v.length);
  };

  const insertMention = (agent: AgentProfile) => {
    const el = taRef.current;
    const caret = el?.selectionStart ?? value.length;
    const upTo = value.slice(0, caret);
    const after = value.slice(caret);
    const replaced = upTo.replace(MENTION_RE, (match) => {
      const lead = match.startsWith(' ') ? ' ' : (match.startsWith('@') ? '' : '');
      return `${lead}@${agent.name} `;
    });
    const next = replaced + after;
    setValue(next);
    setShowMentions(false);
    setMentionQuery('');
    requestAnimationFrame(() => {
      el?.focus();
      const pos = replaced.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const text = value.trim();
    if (!text || submitting || disabled) return;

    // Find first @Mention that matches a known agent
    const mentionMatch = text.match(/@(\w+)/);
    let mentioned: AgentProfile | undefined;
    if (mentionMatch) {
      const name = mentionMatch[1].toLowerCase();
      mentioned = AGENT_PROFILES.find((a) => a.name.toLowerCase() === name);
    }

    setSubmitting(true);
    try {
      await onSubmit({ text, mentioned });
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && candidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % candidates.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => (i - 1 + candidates.length) % candidates.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(candidates[activeIdx]);
        return;
      }
      if (e.key === 'Escape') { setShowMentions(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn('relative w-full', compact ? '' : 'max-w-3xl mx-auto')}>
      {/* Mention dropdown */}
      {showMentions && candidates.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 z-50">
          <div className="rounded-xl border border-border/80 bg-popover/95 backdrop-blur-xl shadow-2xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-border/60 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <AtSign className="h-3 w-3" /> Mention an agent
            </div>
            <ul className="max-h-64 overflow-auto py-1">
              {candidates.map((a, i) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                      i === activeIdx ? 'bg-primary/10' : 'hover:bg-muted/50',
                    )}
                  >
                    <img src={a.image} alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-border" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{a.name}</span>
                        <span className={cn('h-1.5 w-1.5 rounded-full', deptDot[a.department])} />
                        <span className={cn('text-[10px] uppercase tracking-wider', deptText[a.department])}>
                          {a.department}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{a.role}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className={cn(
        'flex items-end gap-2 rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl shadow-[0_10px_40px_-10px_hsl(var(--background)/0.6)] focus-within:border-primary/60 focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.08)] transition-all',
        compact ? 'p-2' : 'p-3',
      )}>
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={(e) => detectMention(value, (e.target as HTMLTextAreaElement).selectionStart ?? value.length)}
          placeholder={placeholder ?? 'Message your AI workforce — type @ to mention an agent'}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed placeholder:text-muted-foreground/70 max-h-[220px] min-h-[24px] py-1.5 px-2 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || submitting || disabled}
          className={cn(
            'h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-all',
            value.trim() && !submitting && !disabled
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
