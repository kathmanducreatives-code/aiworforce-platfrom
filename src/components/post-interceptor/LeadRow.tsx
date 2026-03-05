import { useState } from 'react';
import { ExternalLink, Copy, CheckCheck, Clock, BadgeCheck, AlertTriangle, Building2 } from 'lucide-react';
import type { OutreachLead } from '@/types/outreach';
import { cn } from '@/lib/utils';

interface LeadRowProps {
    lead: OutreachLead;
    onMarkSent: (id: string) => Promise<void>;
}

// Patterns to highlight as buying signals
const SIGNAL_PATTERNS = [/€[\d,]+/g, /\$[\d,]+/g, /£[\d,]+/g, /cost/gi, /fee[s]?/gi, /expensive/gi, /price/gi, /budget/gi, /agency/gi, /recruiter/gi, /invoice/gi];

function highlightSignals(text: string): React.ReactNode[] {
    if (!text) return [text];
    let parts: { text: string; highlight: boolean }[] = [{ text, highlight: false }];

    SIGNAL_PATTERNS.forEach(pattern => {
        const next: typeof parts = [];
        parts.forEach(part => {
            if (part.highlight) { next.push(part); return; }
            const segments = part.text.split(pattern);
            const matches = part.text.match(pattern) || [];
            segments.forEach((seg, i) => {
                if (seg) next.push({ text: seg, highlight: false });
                if (matches[i]) next.push({ text: matches[i], highlight: true });
            });
        });
        parts = next;
    });

    return parts.map((p, i) =>
        p.highlight
            ? <mark key={i} className="bg-amber-400/20 text-amber-300 rounded px-0.5 not-italic">{p.text}</mark>
            : <span key={i}>{p.text}</span>
    );
}

const SIGNAL_COLORS: Record<string, string> = {
    'Decision Maker': 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    'Frustrated': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    'Agency Mention': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'Budget Mentioned': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    'Actively Hiring': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
};

const scoreColor = (score: number) => {
    if (score >= 4) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
    if (score >= 3) return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
    return 'text-muted-foreground bg-muted border-border';
};

const LeadRow = ({ lead, onMarkSent }: LeadRowProps) => {
    const [note, setNote] = useState(lead.generated_connection_note || '');
    const [copied, setCopied] = useState(false);
    const [marking, setMarking] = useState(false);
    const [sent, setSent] = useState(lead.dm_sent);

    const handleCopy = () => {
        navigator.clipboard.writeText(note).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
        if (lead.commenter_linkedin_url) {
            window.open(lead.commenter_linkedin_url, '_blank', 'noopener,noreferrer');
        }
    };

    const handleMarkSent = async () => {
        if (sent || marking) return;
        setMarking(true);
        try {
            await onMarkSent(lead.id);
            setSent(true);
        } finally {
            setMarking(false);
        }
    };

    const initials = lead.commenter_name
        ? lead.commenter_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
        : '?';

    return (
        <div className={cn(
            'group rounded-2xl border bg-card/60 backdrop-blur-sm p-5 transition-all duration-200',
            sent
                ? 'border-border/40 opacity-60'
                : 'border-border hover:border-primary/30 hover:shadow-[0_0_20px_-4px_hsl(var(--primary)/0.1)]'
        )}>
            <div className="flex flex-col lg:flex-row gap-5">

                {/* Left: Profile */}
                <div className="flex items-start gap-3 lg:w-56 lg:flex-shrink-0">
                    {lead.commenter_profile_picture_url ? (
                        <img
                            src={lead.commenter_profile_picture_url}
                            alt={lead.commenter_name}
                            className="w-11 h-11 rounded-full object-cover border border-border flex-shrink-0"
                        />
                    ) : (
                        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                            {initials}
                        </div>
                    )}
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-foreground text-sm truncate leading-tight">{lead.commenter_name}</p>
                            {lead.commenter_linkedin_url && (
                                <a
                                    href={lead.commenter_linkedin_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                        {lead.commenter_title && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{lead.commenter_title}</p>
                        )}
                        {lead.commenter_company && (
                            <div className="flex items-center gap-1 mt-0.5">
                                <Building2 className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
                                <p className="text-xs text-muted-foreground/80 truncate">{lead.commenter_company}</p>
                            </div>
                        )}

                        {/* Score badge */}
                        <div className={cn('inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full border text-xs font-semibold', scoreColor(lead.commenter_score))}>
                            <span>Score {lead.commenter_score}/5</span>
                        </div>

                        {/* Signal chips */}
                        <div className="flex flex-wrap gap-1 mt-2">
                            {(lead.score_signals || []).map(signal => (
                                <span
                                    key={signal}
                                    className={cn(
                                        'text-[10px] font-medium px-1.5 py-0.5 rounded border',
                                        SIGNAL_COLORS[signal] || 'bg-muted text-muted-foreground border-border'
                                    )}
                                >
                                    {signal}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Middle: Comment + DM note */}
                <div className="flex-1 flex flex-col gap-3 min-w-0">
                    {/* Comment */}
                    <div className="rounded-xl bg-muted/40 border border-border/50 p-3">
                        <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Their comment</p>
                        <p className="text-sm text-foreground/90 leading-relaxed">
                            {highlightSignals(lead.comment_text || '')}
                        </p>
                    </div>

                    {/* Editable DM note */}
                    <div>
                        <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Generated DM</p>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            rows={4}
                            className="w-full px-3 py-2.5 rounded-xl bg-background/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all resize-none leading-relaxed"
                            placeholder="AI-generated connection note will appear here..."
                        />
                    </div>
                </div>

                {/* Right: Actions */}
                <div className="flex flex-row lg:flex-col gap-2 lg:w-36 lg:flex-shrink-0 justify-end lg:justify-start">
                    <button
                        onClick={handleCopy}
                        disabled={!note}
                        className={cn(
                            'flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all flex-1 lg:flex-none',
                            copied
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-[0_0_12px_-2px_hsl(var(--primary)/0.4)] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed'
                        )}
                    >
                        {copied ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? 'Copied!' : 'Copy DM'}
                    </button>

                    <button
                        onClick={handleMarkSent}
                        disabled={sent || marking}
                        className={cn(
                            'flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all flex-1 lg:flex-none',
                            sent
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 cursor-not-allowed'
                                : marking
                                    ? 'border-border text-muted-foreground cursor-wait'
                                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 active:scale-95'
                        )}
                    >
                        {sent ? (
                            <><BadgeCheck className="h-3.5 w-3.5" /> Sent</>
                        ) : marking ? (
                            <><Clock className="h-3.5 w-3.5" /> Saving...</>
                        ) : (
                            <><CheckCheck className="h-3.5 w-3.5" /> Mark Sent</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LeadRow;
