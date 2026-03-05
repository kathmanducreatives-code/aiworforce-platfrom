import React, { useState } from 'react';
import { Copy, ExternalLink, Zap, Flame, MessageSquare, Linkedin } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import type { Lead } from '../../../services/interceptorService';

interface LeadCommandCenterProps { leads: Lead[]; }

const LeadCommandCenter: React.FC<LeadCommandCenterProps> = ({ leads: initialLeads }) => {
    const [activeTab, setActiveTab] = useState<'hot' | 'warm' | 'all'>('hot');
    const leads = initialLeads;

    const hotLeads  = leads.filter(l => l.score >= 4);
    const warmLeads = leads.filter(l => l.score >= 2 && l.score < 4);
    const allLeads  = leads;

    const currentLeads = activeTab === 'hot' ? hotLeads : activeTab === 'warm' ? warmLeads : allLeads;

    const tabs = [
        { id: 'hot',  label: '🔥 Hot',  count: hotLeads.length },
        { id: 'warm', label: '👋 Warm', count: warmLeads.length },
        { id: 'all',  label: 'All',     count: allLeads.length },
    ] as const;

    return (
        <div className="w-full max-w-5xl mx-auto px-6 py-10 animate-fade-in">
            {/* Header */}
            <div className="flex items-end justify-between mb-8">
                <div>
                    <div className="flex items-center gap-1.5 text-violet-400 text-xs font-bold mb-2">
                        <Zap size={12} fill="currentColor" /> Interception Complete
                    </div>
                    <h1 className="text-2xl font-bold text-white tracking-tight">Lead Command Center</h1>
                    <p className="text-slate-400 text-sm mt-1">{leads.length} leads extracted — review and copy your DMs</p>
                </div>

                {/* Tab switcher */}
                <div className="flex bg-white/5 rounded-xl p-1 gap-0.5">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                                activeTab === tab.id
                                    ? 'bg-blue-500/15 text-blue-400'
                                    : 'text-slate-500 hover:text-slate-300',
                            ].join(' ')}
                        >
                            {tab.label}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.id ? 'bg-blue-500 text-white' : 'bg-white/10 text-slate-400'}`}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Leads */}
            <div className="flex flex-col gap-3">
                {currentLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 border border-dashed border-white/[0.08] rounded-2xl text-slate-600 gap-3">
                        <MessageSquare size={28} className="opacity-30" />
                        <p className="text-sm">No leads in this category.</p>
                    </div>
                ) : (
                    currentLeads.map(lead => <LeadRow key={lead.id} lead={lead} />)
                )}
            </div>
        </div>
    );
};

const LeadRow = ({ lead }: { lead: Lead }) => {
    const [expanded, setExpanded] = useState(false);
    const [dmText, setDmText] = useState(lead.generatedDM);

    const keywords = ['frustrated','cost','expensive','bug','issue','problem','fees','agency','paying','waste','broken'];

    const highlightComment = (text: string) =>
        text.split(' ').map((word, i) => {
            const clean = word.toLowerCase().replace(/[^a-z]/g, '');
            return (
                <span key={i} className={keywords.includes(clean) ? 'text-amber-400 font-semibold' : ''}>
                    {word}{' '}
                </span>
            );
        });

    const isHot = lead.score >= 4;

    return (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden hover:border-white/[0.14] transition-all duration-200 animate-fade-in">
            <div className="flex gap-6 p-5">
                {/* Profile */}
                <div className="w-52 shrink-0">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-11 h-11 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-base shrink-0">
                            {lead.name?.[0] ?? '?'}
                        </div>
                        <div>
                            <p className="text-[14px] font-semibold text-white flex items-center gap-1.5">
                                {lead.name} <Linkedin size={12} className="text-[#0077b5]" />
                            </p>
                            <p className="text-xs text-slate-500 truncate max-w-[140px]">{lead.title}</p>
                        </div>
                    </div>
                    <p className="text-xs font-medium text-slate-400 mb-3">{lead.company}</p>
                    <div className="flex flex-wrap gap-1.5">
                        {lead.signals.map((sig, i) => (
                            <Badge key={i} variant="blue">{sig}</Badge>
                        ))}
                    </div>
                </div>

                {/* Comment */}
                <div className="flex-1 border-l border-r border-white/[0.06] px-6">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Comment</span>
                        <div className="flex items-center gap-1">
                            <Flame size={12} className={isHot ? 'text-red-400' : 'text-amber-400'} />
                            <span className={`text-xs font-bold ${isHot ? 'text-red-400' : 'text-amber-400'}`}>
                                {lead.score}/5
                            </span>
                        </div>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">
                        {highlightComment(lead.comment)}
                    </p>
                </div>

                {/* Actions */}
                <div className="w-44 shrink-0 flex flex-col gap-2 justify-center">
                    <Button
                        variant="primary"
                        size="md"
                        icon={<MessageSquare size={14} />}
                        onClick={() => setExpanded(!expanded)}
                        className="w-full"
                    >
                        {expanded ? 'Hide DM' : 'View DM'}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<ExternalLink size={13} />}
                        className="w-full"
                    >
                        Open Profile
                    </Button>
                </div>
            </div>

            {/* Expanded DM */}
            {expanded && (
                <div className="border-t border-white/[0.06] bg-black/20 p-5 animate-fade-in">
                    <div className="flex items-center gap-1.5 text-blue-400 text-[11px] font-bold uppercase tracking-wider mb-3">
                        <Sparkles size={11} /> Claude-Generated Connection Note
                    </div>
                    <div className="relative">
                        <textarea
                            value={dmText}
                            onChange={e => setDmText(e.target.value)}
                            className="w-full min-h-28 bg-[#0a0a0b] border border-white/[0.10] rounded-xl p-4 text-sm text-slate-200 leading-relaxed outline-none resize-none focus:border-blue-500/40 transition-colors"
                        />
                        <div className="absolute bottom-3 right-3 flex gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<Copy size={12} />}
                                onClick={() => { navigator.clipboard.writeText(dmText); toast.success('DM copied!'); }}
                            >
                                Copy
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Sparkles inline since not in lucide
const Sparkles = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
);

export default LeadCommandCenter;
