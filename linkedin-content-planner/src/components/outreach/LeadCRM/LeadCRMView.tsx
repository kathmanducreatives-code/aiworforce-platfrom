import React, { useState, useMemo } from 'react';
import { Download, MoreVertical, MessageSquare, ExternalLink, Zap, Flame, CheckCircle2, Clock, Users } from 'lucide-react';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import type { OutreachLead } from '../../../types/outreach';
import { toast } from 'sonner';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { PageHeader } from '../../ui/PageHeader';
import { PageLoader } from '../../ui/Spinner';
import { EmptyState } from '../../ui/EmptyState';

type TabFilter = 'all' | 'hot' | 'warm' | 'intercepted' | 'sent';

const LeadCRMView: React.FC = () => {
    const { leads, loading } = useOutreachLeads();
    const [activeTab, setActiveTab] = useState<TabFilter>('all');

    const filteredLeads = useMemo(() => leads.filter(l => {
        if (activeTab === 'all')         return true;
        if (activeTab === 'hot')         return l.tier === 'tier_1';
        if (activeTab === 'warm')        return l.tier === 'tier_2';
        if (activeTab === 'intercepted') return l.discovery_source === 'competitor_post_intercept';
        if (activeTab === 'sent')        return l.status === 'in_sequence' || l.closely_connection_status === 'pending';
        return true;
    }), [leads, activeTab]);

    const handleExportCSV = () => {
        const headers = ['Name', 'Company', 'Title', 'LinkedIn', 'Tier', 'Status', 'Score', 'Source Post'];
        const rows = filteredLeads.map(l => [
            l.contact_name, l.company, l.title ?? '', l.linkedin_url ?? '',
            l.tier, l.status, l.commenter_score ?? '', l.source_post_url ?? '',
        ]);
        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        toast.success('CSV exported');
    };

    const scoreTier = (l: OutreachLead) => l.commenter_score ?? (l.tier === 'tier_1' ? 5 : l.tier === 'tier_2' ? 3 : 1);

    const tabs: { id: TabFilter; label: string }[] = [
        { id: 'all',         label: `All (${leads.length})` },
        { id: 'hot',         label: '🔥 Tier 1' },
        { id: 'warm',        label: '👋 Tier 2' },
        { id: 'intercepted', label: '🎯 Intercepted' },
        { id: 'sent',        label: '✉️ In Sequence' },
    ];

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <PageHeader
                title="Lead CRM"
                subtitle="All leads — pipeline, intercepted, and sequenced"
                actions={
                    <>
                        <Button variant="secondary" size="md" icon={<Download size={15} />} onClick={handleExportCSV}>
                            Export CSV
                        </Button>
                        <Button variant="primary" size="md" icon={<Zap size={15} fill="white" />}>
                            New Interception
                        </Button>
                    </>
                }
            />

            <div className="flex-1 flex flex-col overflow-hidden px-10 pb-10">
                {/* Tab bar */}
                <div className="flex border-b border-white/[0.08] mb-6 gap-6 shrink-0">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                'pb-3 text-sm font-semibold border-b-2 transition-all duration-150 cursor-pointer',
                                activeTab === tab.id
                                    ? 'border-blue-500 text-blue-400'
                                    : 'border-transparent text-slate-500 hover:text-slate-300',
                            ].join(' ')}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Table container */}
                <div className="flex-1 bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden flex flex-col">
                    {loading ? (
                        <PageLoader message="Loading leads from Supabase..." />
                    ) : filteredLeads.length === 0 ? (
                        <EmptyState
                            icon={<Users size={36} />}
                            title="No leads here yet"
                            description="Leads will appear here once added via the pipeline or interceptor."
                        />
                    ) : (
                        <div className="overflow-auto flex-1">
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 bg-[#141416] border-b border-white/[0.08] z-10">
                                    <tr>
                                        {['Lead', 'Source', 'Score', 'Status', 'Actions'].map(h => (
                                            <th key={h} className="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLeads.map((lead, i) => {
                                        const score = scoreTier(lead);
                                        const isIntercepted = lead.discovery_source === 'competitor_post_intercept';
                                        return (
                                            <tr
                                                key={lead.id}
                                                className={`border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors animate-fade-in delay-${Math.min(i + 1, 6)}`}
                                            >
                                                {/* Lead */}
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-xs shrink-0">
                                                            {lead.contact_name?.[0] ?? '?'}
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-semibold text-white">{lead.contact_name}</p>
                                                            <p className="text-xs text-slate-500">{lead.title ?? lead.company}</p>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Source */}
                                                <td className="px-6 py-4">
                                                    <Badge variant={isIntercepted ? 'violet' : 'blue'}>
                                                        {isIntercepted ? '🎯 Intercepted' : 'Pipeline'}
                                                    </Badge>
                                                </td>

                                                {/* Score */}
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-1.5">
                                                        <Flame size={13} className={score >= 4 ? 'text-red-400' : score >= 2 ? 'text-amber-400' : 'text-slate-600'} />
                                                        <span className="text-sm font-bold text-white tabular-nums">{score}</span>
                                                    </div>
                                                </td>

                                                {/* Status */}
                                                <td className="px-6 py-4">
                                                    {lead.status === 'in_sequence' ? (
                                                        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                                                            <CheckCircle2 size={13} /> In Sequence
                                                        </span>
                                                    ) : lead.closely_connection_status === 'pending' ? (
                                                        <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                                                            <Clock size={13} /> Pending
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-400">
                                                            <Clock size={13} /> New
                                                        </span>
                                                    )}
                                                </td>

                                                {/* Actions */}
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        {lead.generated_connection_note && (
                                                            <button
                                                                title="Copy DM"
                                                                onClick={() => { navigator.clipboard.writeText(lead.generated_connection_note!); toast.success('DM copied!'); }}
                                                                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                                                            >
                                                                <MessageSquare size={16} />
                                                            </button>
                                                        )}
                                                        {lead.linkedin_url && (
                                                            <a
                                                                href={lead.linkedin_url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-all flex items-center"
                                                            >
                                                                <ExternalLink size={16} />
                                                            </a>
                                                        )}
                                                        <button className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-all">
                                                            <MoreVertical size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LeadCRMView;
